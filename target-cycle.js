import {
  clearSpellPath, coneHits, isProjectileToken, isProjectileWall, projectileImpact, projectileTokenContainsPoint, tokenCircle,
} from "./projectile-collision.js?v=2.11.15";
import { SKILLS, SKILL_REQUEST, SKILL_RESULT, friendlyFireMode, skillConnections, spellParameter, tokenTeams } from "./skills.js?v=2.11.12";

export async function targetGeometry(obr, tokenId) {
  const [bounds, dpi, shared, local] = await Promise.all([
    obr.scene.items.getItemBounds([tokenId]),
    obr.scene.grid.getDpi(),
    obr.scene.items.getItems((item) => isProjectileToken(item) || isProjectileWall(item)),
    obr.scene.local.getItems(isProjectileWall),
  ]);
  return { source: bounds?.center, dpi, items: [...shared, ...local] };
}

export function reachableTargets({ source, dpi, items }, tokenId, skillId, config = {}) {
  const skill = SKILLS[skillId];
  if (![source?.x, source?.y, dpi].every(Number.isFinite) || dpi <= 0 || skill?.location === "teleport") return [];

  const mode = friendlyFireMode(config);
  const teams = tokenTeams(config, tokenId);
  const affectedByArea = skill?.impact || skill?.cone || skill?.location === "area";
  const targets = items.filter((item) => !skill || mode === "enabled" || mode === "aoe" && affectedByArea ||
    !isProjectileToken(item) || !tokenTeams(config, item.id).some((team) => teams.includes(team)));
  const range = skill?.range ?? skill?.meleeReach ?? (skill?.cone ? spellParameter(config, tokenId, skillId) : Infinity);

  return targets.flatMap((item) => {
    if (item.id === tokenId || !isProjectileToken(item)) return [];
    const center = tokenCircle(item, dpi)?.center;
    if (!center) return [];
    const dx = center.x - source.x;
    const dy = center.y - source.y;
    if (Math.hypot(dx, dy) > range * dpi + 1e-7 || !clearSpellPath(source, center, items)) return [];

    if (skill?.cone) {
      const heading = Math.atan2(dy, dx) * 180 / Math.PI;
      if (!coneHits(source, heading, range * dpi, targets, tokenId, dpi).includes(item.id)) return [];
    } else if (skill?.meleeReach || (skill?.range && !skill.impact && !skill.location)) {
      const reachesPoint = skill.meleeReach ? undefined : (other) => projectileTokenContainsPoint(other, center, dpi);
      const angle = Math.atan2(dy, dx);
      const destination = skill.meleeReach
        ? { x: source.x + Math.cos(angle) * range * dpi, y: source.y + Math.sin(angle) * range * dpi }
        : center;
      if (!projectileImpact(source, destination, targets, tokenId, dpi, 0, reachesPoint).hitTokenIds.includes(item.id)) return [];
    }
    return [{ id: item.id, center }];
  });
}

export async function fetchSpellTargets(obr, tokenId, { skill, spellLevel }) {
  const { gm, self } = await skillConnections(obr);
  if (!gm) throw Error("Connect a GM to cycle spell targets.");
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const unsubscribe = obr.broadcast.onMessage(SKILL_RESULT, ({ connectionId, data }) => {
      if (connectionId !== gm.connectionId || data?.connectionId !== self.connectionId ||
          data.requestId !== requestId || data.tokenId !== tokenId) return;
      if (Array.isArray(data.reachableIds)) finish(null, new Set(data.reachableIds));
      else finish(Error(data.error || "Couldn’t check spell targets."));
    });
    const timeout = setTimeout(() => finish(Error("No reply from the GM. Check that their Overhead Chat is updated.")), 2500);
    function finish(error, targets) {
      clearTimeout(timeout);
      unsubscribe();
      if (error) reject(error);
      else resolve(targets);
    }
    void obr.broadcast.sendMessage(SKILL_REQUEST, {
      type: "targets", requestId, tokenId, skill,
      ...(spellLevel !== undefined ? { spellLevel } : {}),
    }, { destination: "ALL" })
      .catch(finish);
  });
}

export function nextTarget(candidates, origin, previous, direction) {
  const distance = ({ center }) => Math.hypot(center.x - origin.x, center.y - origin.y);
  const ordered = [...candidates].sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id));
  const index = ordered.findIndex(({ id }) => id === previous);
  return ordered[index < 0 ? 0 : (index + direction + ordered.length) % ordered.length];
}
