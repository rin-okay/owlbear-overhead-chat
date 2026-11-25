import { isProjectileToken } from "./projectile-collision.js?v=2.6.13";
import { skillConnections } from "./skills.js?v=2.6.15";
import { validMeleeDamage } from "./melee-damage.js?v=2.7.19";
import { MAGIC_MISSILE_INTERVAL, MAGIC_MISSILE_MAX_LEVEL, validMagicMissileDamage, validSpellDamage } from "./spell-damage.js?v=2.9.13";

export const HIT_MARKERS = "chat.overhead.skills/hits.v1";
export const MELEE_HIT_CUE = "chat.overhead.skills/melee-hit-cue.v1";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setupHitMarkers(obr, buildLabel, buildPath, command) {
  const corners = [
    [-13, -3], [-6, -5], [-9, -12], [-2, -8], [2, -14], [5, -6], [12, -9],
    [8, -2], [15, 1], [7, 4], [9, 11], [2, 7], [-4, 12], [-5, 5], [-13, 7], [-9, 1],
  ];
  const splatPath = corners.map(([x, y], index) => [index ? command.LINE : command.MOVE, x, y]);
  splatPath.push([command.CLOSE]);
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

  async function show(tokenIds, current, damage, { x = 0, y = 0, splat = false } = {}) {
    const [targets, scale] = await Promise.all([
      obr.scene.items.getItems(tokenIds), obr.viewport.getScale(),
    ]);
    if (!Number.isFinite(scale) || scale <= 0 || !current()) return;
    const maxRoll = damage?.maxRoll === true;
    const amount = damage?.amount ?? 1;
    const blocked = damage?.blocked === true;
    const text = blocked ? "blocked" : amount > 0 ? `-${amount}` : "0";
    const step = (maxRoll ? 6 : 4) / scale;
    const labels = (await Promise.all(targets.filter(isProjectileToken).map(async (target) => {
      // A target may be deleted between fetching the items and getting its bounds.
      const bounds = await obr.scene.items.getItemBounds([target.id]).catch(() => null);
      if (!Number.isFinite(bounds?.center?.x) || !Number.isFinite(bounds?.min?.y)) return null;
      const graphic = splat
        ? buildPath().commands(splatPath).fillColor("#f02f49").strokeColor("#78142b").strokeWidth(1.5)
          .scale({ x: 0.5 / scale, y: 0.5 / scale })
        : buildLabel().plainText(text).padding(0).backgroundOpacity(0)
        .pointerWidth(0).pointerHeight(0).textAlign("CENTER")
        .fontSize(blocked ? 15 : maxRoll ? 32 : 21).fontWeight(maxRoll ? 900 : 700)
        .fillColor(blocked ? "#b3e7ff" : maxRoll ? "#ffc278" : "#ff4d61")
        .strokeColor(blocked ? "#183149" : maxRoll ? "#78142b" : "#26070d").strokeWidth(maxRoll ? 2 : 1).strokeOpacity(1);
      const label = graphic
        .position({ x: bounds.center.x + x / scale, y: bounds.min.y - (12 + y) / scale })
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
            const style = splat ? item.style : item.text.style;
            style.fillOpacity = opacity;
            style.strokeOpacity = opacity;
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
    const followUps = data.missileFollowUps;
    const { dartCount, splat } = data;
    if ((splat === true && (data.damage !== undefined || followUps !== undefined)) ||
        (dartCount !== undefined && (splat !== true || data.useAnimationCue === true ||
          !Number.isInteger(dartCount) || dartCount < 1 || dartCount > MAGIC_MISSILE_MAX_LEVEL + 2 ||
          data.delay + (dartCount - 1) * MAGIC_MISSILE_INTERVAL > 6000))) return;
    if (followUps !== undefined &&
        (!Array.isArray(followUps) || followUps.length < 1 || followUps.length > MAGIC_MISSILE_MAX_LEVEL + 1 ||
          data.useAnimationCue === true || data.delay + followUps.length * MAGIC_MISSILE_INTERVAL > 6000 ||
          !validMagicMissileDamage(data.damage) || !followUps.every(validMagicMissileDamage))) return;
    if (followUps === undefined && data.damage !== undefined &&
        (data.damage.blocked === true ? !validMagicMissileDamage(data.damage)
          : !validMeleeDamage(data.damage) && !validSpellDamage(data.damage))) return;
    const version = sceneVersion;
    const current = () => version === sceneVersion;
    try {
      const [{ gm, self }, ready] = await Promise.all([skillConnections(obr), obr.scene.isReady()]);
      if (!current() || !ready || gm?.connectionId !== connectionId) return;
      const now = Date.now();
      for (const [id, expiry] of recent) if (expiry <= now) recent.delete(id);
      if (recent.has(data.requestId)) return;
      recent.set(data.requestId, now + 10000);
      const tokenIds = [...new Set(data.tokenIds)];
      if (followUps || dartCount) {
        // Separate splats that are still on screen when the next dart hits.
        const lanes = [0, -1, 1, -2, 2];
        // A blocked splat fades before its row is reused by the fourth following dart.
        const blockedJitter = [0, -4, 5, -3];
        const darts = dartCount ? Array(dartCount).fill(undefined) : [data.damage, ...followUps];
        await Promise.all(darts.map(async (damage, index) => {
          await wait(data.delay + index * MAGIC_MISSILE_INTERVAL);
          if (!current()) return;
          const row = index % blockedJitter.length;
          const offset = damage?.blocked
            ? { x: blockedJitter[row], y: row * 23 }
            : { x: lanes[index % lanes.length] * 22 };
          await show(tokenIds, current, damage, { ...offset, splat });
        }));
        return;
      }
      if (data.useAnimationCue === true) {
        await waitForAnimationCue(data.requestId, self.connectionId, data.delay);
      } else {
        await wait(data.delay);
      }
      if (current()) await show(tokenIds, current, data.damage, { splat });
    } catch (error) {
      console.error("Overhead Chat could not draw a hit marker", error);
    }
  });
}
