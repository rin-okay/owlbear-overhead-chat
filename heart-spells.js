const HEART_FLIGHT = "chat.overhead.heart-flight.v1";

const point = (value) => [value?.x, value?.y].every(Number.isFinite);

export async function addHeartEffects(obr, instructions, skill, level, hitTokens, dpi) {
  const projectile = instructions[0];
  const { source, destination } = projectile.effectProperties;
  const distance = Math.hypot(destination.x - source.x, destination.y - source.y);
  const duration = Math.min(900, Math.max(250, Math.round(distance / dpi * 55)));
  projectile.duration = duration + 60;
  projectile.effectProperties = { source, size: 1, disableHit: true };
  projectile.metadata = { [HEART_FLIGHT]: { destination, duration } };
  if (skill.impact) instructions[1].delay = duration;

  const marker = skill.upcast ? 4 - level : 3;
  const markers = await Promise.all(hitTokens.map(async (target) => {
    const bounds = await obr.scene.items.getItemBounds([target.id]).catch(() => null);
    const center = bounds?.center ?? target.position;
    if (!point(center)) return;
    return {
      type: "effect", id: "generic.marker.heart." + marker,
      delay: duration, loops: 1, layer: "ATTACHMENT",
      effectProperties: { source: center, size: 2, disableHit: true, attachedTo: target.id },
    };
  }));
  const visibleMarkers = markers.filter(Boolean);
  instructions.push(...visibleMarkers);
  return { duration, markerCount: visibleMarkers.length };
}

export function setupHeartProjectiles(obr) {
  const active = new Map();
  obr.scene.onReadyChange(() => active.clear());
  obr.scene.local.onChange((items) => {
    const present = new Set();
    for (const item of items) {
      const path = item.metadata?.[HEART_FLIGHT];
      if (item.type !== "IMAGE" || !point(path?.destination) || !point(item.position) ||
          !Number.isFinite(path.duration) || path.duration < 250 || path.duration > 900) continue;
      present.add(item.id);
      if (active.has(item.id)) continue;
      const animation = {};
      active.set(item.id, animation);
      const source = item.position;
      const started = performance.now();
      async function advance() {
        if (active.get(item.id) !== animation) return;
        const progress = Math.min(1, (performance.now() - started) / path.duration);
        try {
          await obr.scene.local.updateItems([item.id], ([projectile]) => {
            if (!projectile || active.get(item.id) !== animation) return;
            projectile.position = {
              x: source.x + (path.destination.x - source.x) * progress,
              y: source.y + (path.destination.y - source.y) * progress,
            };
          }, true);
        } catch {
          return; // The effect can expire while an update is in flight.
        }
        if (progress < 1 && active.get(item.id) === animation) setTimeout(advance, 25);
      }
      setTimeout(advance, 0);
    }
    for (const id of active.keys()) {
      if (!present.has(id)) active.delete(id);
    }
  });
}
