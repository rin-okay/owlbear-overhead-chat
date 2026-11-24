import { isProjectileToken } from "./projectile-collision.js?v=2.7.3";
import { skillConnections, spellParameter, tokenTeams } from "./skills.js?v=2.7.7";

const BLESS_CASTER = "chat.overhead.bless.caster.v1";
const BLESS_INTRO_END = "chat.overhead.bless.intro-end.v1";
const BLESS_LOOP_SCALE = "chat.overhead.bless.loop-scale.v1";
const BLESS_TARGETS = "chat.overhead.bless.targets.v1";
const BLESS_CAST = "chat.overhead.bless.cast.v1";
const BLESS_INTRO_MS = 5000;
// These are the paired 400 × 400 Bless clips from the Embers catalog.
const BLESS_IMAGE = {
  url: "https://jb2a-free.s3.eu-west-3.amazonaws.com/1st_Level/Bless/Bless_01_Regular_Yellow_Loop_400x400.webm",
  width: 400,
  height: 400,
  mime: "video/webm",
};

const BLESS_INTRO = {
  ...BLESS_IMAGE,
  url: BLESS_IMAGE.url.replace("_Loop_", "_Intro_"),
};

function blessGraphic(item) {
  return item.type === "IMAGE" && item.layer === "ATTACHMENT" &&
    (item.image?.url === BLESS_INTRO.url || item.image?.url === BLESS_IMAGE.url);
}

export function setupBless(obr, buildImage) {
  const casting = new Set();
  let sceneVersion = 0;

  function finishLegacyIntro(ids, deadline, current) {
    setTimeout(async () => {
      if (!current()) return;
      try {
        await obr.scene.items.updateItems(ids, (items) => {
          if (!current()) return;
          for (const item of items) {
            if (!blessGraphic(item) || item.image.url !== BLESS_INTRO.url ||
                item.metadata?.[BLESS_INTRO_END] !== deadline) continue;
            item.image.url = BLESS_IMAGE.url;
            const scale = item.metadata[BLESS_LOOP_SCALE];
            if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) {
              item.scale = { x: scale, y: scale };
            }
            delete item.metadata[BLESS_INTRO_END];
            delete item.metadata[BLESS_LOOP_SCALE];
          }
        });
      } catch (error) {
        console.error("Overhead Chat could not finish the Bless intro", error);
      }
    }, Math.max(0, deadline - Date.now()));
  }

  async function buildLoop(target, dpi, casterId, introId) {
    const bounds = await obr.scene.items.getItemBounds([target.id]).catch(() => null);
    if (![bounds?.center?.x, bounds?.center?.y].every(Number.isFinite)) return;
    const size = Math.max(bounds.max?.x - bounds.min?.x, bounds.max?.y - bounds.min?.y);
    const scale = Number.isFinite(size) && size > 0 ? size / (dpi * 2) : 0.5;
    const image = buildImage(BLESS_IMAGE, { dpi: 200, offset: { x: 200, y: 200 } })
      .position(bounds.center).scale({ x: scale, y: scale }).layer("ATTACHMENT")
      .attachedTo(target.id).disableHit(true).locked(true)
      .metadata({ [BLESS_CASTER]: casterId, [BLESS_CAST]: introId }).build();
    image.disableAttachmentBehavior = ["COPY", "ROTATION"];
    return image;
  }

  function finishIntro(introId, casterId, deadline, current, delay = Math.max(0, deadline - Date.now())) {
    setTimeout(async () => {
      if (!current()) return;
      if (casting.has(casterId)) {
        finishIntro(introId, casterId, deadline, current, 100);
        return;
      }
      casting.add(casterId);
      try {
        const { self, gm } = await skillConnections(obr);
        if (!current() || gm?.connectionId !== self.connectionId) return;
        const [intro] = await obr.scene.items.getItems([introId]);
        const targetIds = intro?.metadata?.[BLESS_TARGETS];
        if (!current() || !intro || !blessGraphic(intro) || intro.image.url !== BLESS_INTRO.url ||
            intro.metadata[BLESS_CASTER] !== casterId || intro.metadata[BLESS_INTRO_END] !== deadline ||
            !Array.isArray(targetIds)) return;

        const targets = new Set(targetIds);
        const [dpi, items] = await Promise.all([
          obr.scene.grid.getDpi(),
          obr.scene.items.getItems((item) => (targets.has(item.id) && isProjectileToken(item)) ||
            (blessGraphic(item) && item.metadata?.[BLESS_CAST] === introId)),
        ]);
        if (!current()) return;
        if (!Number.isFinite(dpi) || dpi <= 0) throw Error("Couldn’t read the scene grid for Bless.");
        // If the intro survived a failed cleanup, keep the loops already added for this cast.
        const attached = new Set(items.filter(blessGraphic).map((item) => item.attachedTo));
        const loops = (await Promise.all(
          items.filter((item) => targets.has(item.id) && !attached.has(item.id))
            .map((item) => buildLoop(item, dpi, casterId, introId)),
        )).filter(Boolean);
        if (!current()) return;
        if (loops.length) await obr.scene.items.addItems(loops);
        if (current()) await obr.scene.items.deleteItems([introId]);
      } catch (error) {
        console.error("Overhead Chat could not finish the Bless intro", error);
      } finally {
        casting.delete(casterId);
      }
    }, delay);
  }

  async function resumeIntros() {
    const version = sceneVersion;
    const current = () => version === sceneVersion;
    try {
      if (!await obr.scene.isReady() || await obr.player.getRole() !== "GM") return;
      const { self, gm } = await skillConnections(obr);
      if (!current() || self.connectionId !== gm?.connectionId) return;
      const items = await obr.scene.items.getItems((item) => blessGraphic(item) &&
        item.image.url === BLESS_INTRO.url && Number.isFinite(item.metadata?.[BLESS_INTRO_END]));
      if (!current()) return;
      const groups = new Map();
      for (const item of items) {
        const deadline = item.metadata[BLESS_INTRO_END];
        const casterId = item.metadata[BLESS_CASTER];
        if (typeof casterId === "string" && Array.isArray(item.metadata[BLESS_TARGETS])) {
          finishIntro(item.id, casterId, deadline, current);
          continue;
        }
        if (!groups.has(deadline)) groups.set(deadline, []);
        groups.get(deadline).push(item.id);
      }
      for (const [deadline, ids] of groups) finishLegacyIntro(ids, deadline, current);
    } catch (error) {
      console.error("Overhead Chat could not resume Bless intros", error);
    }
  }

  obr.scene.onReadyChange((ready) => {
    sceneVersion++;
    if (ready) void resumeIntros();
  });
  void resumeIntros();

  return async (caster, selectedIds, config, extraTargets, hostCurrent) => {
    const version = sceneVersion;
    const current = () => version === sceneVersion && hostCurrent();
    if (casting.has(caster.id)) return "Bless is still updating.";
    casting.add(caster.id);
    try {
      const isActiveGraphic = (item) => blessGraphic(item) && item.metadata?.[BLESS_CASTER] === caster.id;
      const sceneItems = await obr.scene.items.getItems((item) => isActiveGraphic(item) || isProjectileToken(item));
      if (!current()) return;
      const active = sceneItems.filter(isActiveGraphic);
      if (active.length) {
        await obr.scene.items.deleteItems(active.map(({ id }) => id));
        return "";
      }

      const dpi = await obr.scene.grid.getDpi();
      if (!Number.isFinite(dpi) || dpi <= 0) return "Couldn’t read the scene grid for Bless.";
      // At 200 DPI the 400 px intro spans two cells, or one cell of radius.
      const radius = spellParameter(config, caster.id, "bless");
      const range = radius * dpi;
      const limit = spellParameter(config, caster.id, "bless", "targetLimit") + extraTargets;
      const teams = tokenTeams(config, caster.id);
      const allies = sceneItems.filter((item) => item.id !== caster.id && isProjectileToken(item) &&
        tokenTeams(config, item.id).some((team) => teams.includes(team)) &&
        Math.hypot(item.position.x - caster.position.x, item.position.y - caster.position.y) <= range);
      const targets = selectedIds.length ? [] : [caster];

      if (selectedIds.length) {
        if (selectedIds.includes(caster.id)) targets.push(caster);
        const byId = new Map(allies.map((item) => [item.id, item]));
        for (const id of new Set(selectedIds)) {
          if (targets.length >= limit) break;
          const ally = byId.get(id);
          if (ally) targets.push(ally);
        }
      } else {
        for (let i = allies.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [allies[i], allies[j]] = [allies[j], allies[i]];
        }
        targets.push(...allies.slice(0, limit - 1));
      }
      if (!targets.length) return "Select an ally within Bless range.";

      const bounds = await obr.scene.items.getItemBounds([caster.id]).catch(() => null);
      if (!current()) return;
      if (![bounds?.center?.x, bounds?.center?.y].every(Number.isFinite)) return "Couldn’t find the Bless caster.";
      const deadline = Date.now() + BLESS_INTRO_MS;
      const intro = buildImage(BLESS_INTRO, { dpi: 200, offset: { x: 200, y: 200 } })
        .position(bounds.center).scale({ x: radius, y: radius }).layer("ATTACHMENT")
        .attachedTo(caster.id).disableHit(true).locked(true)
        .metadata({
          [BLESS_CASTER]: caster.id, [BLESS_INTRO_END]: deadline, [BLESS_TARGETS]: targets.map(({ id }) => id),
        }).build();
      intro.disableAttachmentBehavior = ["COPY", "ROTATION"];
      await obr.scene.items.addItems([intro]);
      if (current()) finishIntro(intro.id, caster.id, deadline, current);
      return "";
    } finally {
      casting.delete(caster.id);
    }
  };
}
