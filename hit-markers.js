import { isProjectileToken } from "./projectile-collision.js?v=2.6.13";
import { skillConnections } from "./skills.js?v=2.6.15";
import { validMeleeDamage } from "./melee-damage.js?v=2.7.19";
import { validSpellDamage } from "./spell-damage.js?v=2.8.3";

export const HIT_MARKERS = "chat.overhead.skills/hits.v1";
export const MELEE_HIT_CUE = "chat.overhead.skills/melee-hit-cue.v1";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setupHitMarkers(obr, buildLabel) {
  let sceneVersion = 0;
  const recent = new Map();
  const animationCues = new Map();
  const earlyCues = new Map();
  obr.scene.onReadyChange(() => {
    sceneVersion++;
    recent.clear();
    earlyCues.clear();
    for (const { finish } of animationCues.values()) finish();
  });

  obr.broadcast.onMessage(MELEE_HIT_CUE, ({ connectionId, data }) => {
    const pending = animationCues.get(data);
    if (pending) {
      if (pending.connectionId === connectionId) pending.finish();
      return;
    }
    // At the start of a swing the cue can beat the GM authorization lookup.
    if (typeof data !== "string" || !/^[a-f0-9-]{36}$/i.test(data) || recent.has(data)) return;
    if (earlyCues.size >= 64) earlyCues.delete(earlyCues.keys().next().value);
    earlyCues.set(JSON.stringify([connectionId, data]), Date.now() + 5000);
  });

  function waitForAnimationCue(requestId, connectionId, fallbackDelay) {
    const key = JSON.stringify([connectionId, requestId]);
    const expires = earlyCues.get(key);
    earlyCues.delete(key);
    if (expires > Date.now()) return Promise.resolve();

    return new Promise((resolve) => {
      const timeout = setTimeout(finish, fallbackDelay);
      animationCues.set(requestId, { connectionId, finish });

      function finish() {
        clearTimeout(timeout);
        animationCues.delete(requestId);
        resolve();
      }
    });
  }

  async function show(tokenIds, current, damage) {
    const [targets, scale] = await Promise.all([
      obr.scene.items.getItems(tokenIds), obr.viewport.getScale(),
    ]);
    if (!Number.isFinite(scale) || scale <= 0 || !current()) return;
    const maxRoll = damage?.maxRoll === true;
    const amount = damage?.amount ?? 1;
    const text = amount > 0 ? `-${amount}` : "0";
    const step = (maxRoll ? 6 : 4) / scale;
    const labels = (await Promise.all(targets.filter(isProjectileToken).map(async (target) => {
      // A target may be deleted between fetching the items and getting its bounds.
      const bounds = await obr.scene.items.getItemBounds([target.id]).catch(() => null);
      if (!Number.isFinite(bounds?.center?.x) || !Number.isFinite(bounds?.min?.y)) return null;
      const label = buildLabel().plainText(text).padding(0).backgroundOpacity(0)
        .pointerWidth(0).pointerHeight(0).textAlign("CENTER")
        .fontSize(maxRoll ? 32 : 21).fontWeight(maxRoll ? 900 : 700)
        .fillColor(maxRoll ? "#ffc278" : "#ff4d61")
        .strokeColor(maxRoll ? "#78142b" : "#26070d").strokeWidth(maxRoll ? 2 : 1).strokeOpacity(1)
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
        await wait(maxRoll && frame === 1 ? 65 : 130);
        if (!current()) return;
        const opacity = (6 - frame) / 6;
        await obr.scene.local.updateItems(ids, (items) => {
          for (const item of items) {
            item.position.y -= maxRoll && frame === 1 ? step * 2 : step;
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
        !Number.isFinite(data.delay) || data.delay < 0 || data.delay > 6000 ||
        (data.damage !== undefined && !validMeleeDamage(data.damage) && !validSpellDamage(data.damage))) return;
    const version = sceneVersion;
    const current = () => version === sceneVersion;
    try {
      const [{ gm, self }, ready] = await Promise.all([skillConnections(obr), obr.scene.isReady()]);
      if (!current() || !ready || gm?.connectionId !== connectionId) return;
      const now = Date.now();
      for (const [id, expiry] of recent) if (expiry <= now) recent.delete(id);
      if (recent.has(data.requestId)) return;
      recent.set(data.requestId, now + 10000);
      if (data.useAnimationCue === true) {
        await waitForAnimationCue(data.requestId, self.connectionId, data.delay);
      } else {
        await wait(data.delay);
      }
      if (current()) await show([...new Set(data.tokenIds)], current, data.damage);
    } catch (error) {
      console.error("Overhead Chat could not draw a hit marker", error);
    }
  });
}
