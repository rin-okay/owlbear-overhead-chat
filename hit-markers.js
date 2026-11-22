import { isProjectileToken } from "./projectile-collision.js?v=2.6.10";
import { skillConnections } from "./skills.js?v=2.6.10";

export const HIT_MARKERS = "chat.overhead.skills/hits.v1";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setupHitMarkers(obr, buildLabel) {
  let sceneVersion = 0;
  const recent = new Map();
  obr.scene.onReadyChange(() => { sceneVersion++; recent.clear(); });

  async function show(tokenIds, current) {
    const [targets, scale] = await Promise.all([
      obr.scene.items.getItems(tokenIds), obr.viewport.getScale(),
    ]);
    if (!Number.isFinite(scale) || scale <= 0 || !current()) return;
    const step = 4 / scale;
    const labels = (await Promise.all(targets.filter(isProjectileToken).map(async (target) => {
      // A target may be deleted between fetching the items and getting its bounds.
      const bounds = await obr.scene.items.getItemBounds([target.id]).catch(() => null);
      if (!Number.isFinite(bounds?.center?.x) || !Number.isFinite(bounds?.min?.y)) return null;
      const label = buildLabel().plainText("-1").padding(0).backgroundOpacity(0)
        .pointerWidth(0).pointerHeight(0).textAlign("CENTER")
        .fontSize(21).fontWeight(700).fillColor("#ff4d61")
        .strokeColor("#26070d").strokeWidth(1).strokeOpacity(1)
        .position({ x: bounds.center.x, y: bounds.min.y - 12 / scale })
        .layer("ATTACHMENT").locked(true).attachedTo(target.id).build();
      label.disableHit = true;
      label.disableAttachmentBehavior = ["COPY", "LOCKED", "ROTATION", "SCALE"];
      return label;
    }))).filter(Boolean);
    if (!labels.length || !current()) return;
    const ids = labels.map(({ id }) => id);
    try {
      await obr.scene.local.addItems(labels);
      for (let frame = 1; frame <= 6; frame++) {
        await wait(130);
        if (!current()) return;
        const opacity = (6 - frame) / 6;
        await obr.scene.local.updateItems(ids, (items) => {
          for (const item of items) {
            item.position.y -= step;
            item.text.style.fillOpacity = opacity;
            item.text.style.strokeOpacity = opacity;
          }
        }, true);
      }
    } finally {
      if (current()) await obr.scene.local.deleteItems(ids);
    }
  }

  obr.broadcast.onMessage(HIT_MARKERS, async ({ connectionId, data }) => {
    if (typeof data?.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(data.requestId) ||
        !Array.isArray(data.tokenIds) || !data.tokenIds.length ||
        !data.tokenIds.every((id) => typeof id === "string" && id.length && id.length <= 128) ||
        !Number.isFinite(data.delay) || data.delay < 0 || data.delay > 6000) return;
    const version = sceneVersion;
    const current = () => version === sceneVersion;
    try {
      const [{ gm }, ready] = await Promise.all([skillConnections(obr), obr.scene.isReady()]);
      if (!current() || !ready || gm?.connectionId !== connectionId) return;
      const now = Date.now();
      for (const [id, expiry] of recent) if (expiry <= now) recent.delete(id);
      if (recent.has(data.requestId)) return;
      recent.set(data.requestId, now + 10000);
      await wait(data.delay);
      if (current()) await show([...new Set(data.tokenIds)], current);
    } catch (error) {
      console.error("Overhead Chat could not draw a hit marker", error);
    }
  });
}
