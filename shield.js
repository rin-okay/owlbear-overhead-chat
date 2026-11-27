import { skillConnections } from "./skills.js?v=3.1.0";

const SHIELD = "chat.overhead.shield.v1";
const SHIELD_INTRO_END = "chat.overhead.shield.intro-end.v1";
const SHIELD_INTRO_MS = 1530;
const SHIELD_IMAGE = {
  url: "https://jb2a-free.s3.eu-west-3.amazonaws.com/1st_Level/Shield/Shield_01_Regular_Blue_Loop_400x400.webm",
  width: 400,
  height: 400,
  mime: "video/webm",
};

const SHIELD_INTRO = { ...SHIELD_IMAGE, url: SHIELD_IMAGE.url.replace("_Loop_", "_Intro_") };

export function isShieldGraphic(item) {
  return item.type === "IMAGE" && item.layer === "ATTACHMENT" &&
    item.metadata?.[SHIELD] === true &&
    (item.image?.url === SHIELD_IMAGE.url || item.image?.url === SHIELD_INTRO.url);
}

export function readShieldGraphics(obr, tokenId) {
  return obr.scene.items.getItems((item) => isShieldGraphic(item) && item.attachedTo === tokenId);
}

export function setupShield(obr, buildImage) {
  const updating = new Set();
  let sceneVersion = 0;

  function finishIntro(id, deadline, current) {
    setTimeout(async () => {
      if (!current()) return;
      try {
        const { self, gm } = await skillConnections(obr);
        if (!current() || self.connectionId !== gm?.connectionId) return;
        await obr.scene.items.updateItems([id], ([item]) => {
          if (!current() || !item || !isShieldGraphic(item) || item.image.url !== SHIELD_INTRO.url ||
              item.metadata[SHIELD_INTRO_END] !== deadline) return;
          item.image.url = SHIELD_IMAGE.url;
          delete item.metadata[SHIELD_INTRO_END];
        });
      } catch (error) {
        console.error("Overhead Chat could not finish the Shield intro", error);
      }
    }, Math.max(0, deadline - Date.now()));
  }

  async function resumeIntros() {
    const version = sceneVersion;
    const current = () => version === sceneVersion;
    try {
      if (!await obr.scene.isReady() || await obr.player.getRole() !== "GM") return;
      const { self, gm } = await skillConnections(obr);
      if (!current() || self.connectionId !== gm?.connectionId) return;
      const items = await obr.scene.items.getItems((item) => isShieldGraphic(item) &&
        item.image.url === SHIELD_INTRO.url && Number.isFinite(item.metadata[SHIELD_INTRO_END]));
      if (!current()) return;
      for (const item of items) finishIntro(item.id, item.metadata[SHIELD_INTRO_END], current);
    } catch (error) {
      console.error("Overhead Chat could not resume Shield intros", error);
    }
  }

  obr.scene.onReadyChange((ready) => {
    sceneVersion++;
    if (ready) void resumeIntros();
  });
  void resumeIntros();

  return async (caster, canActivate, current) => {
    if (updating.has(caster.id)) return "Shield is still updating.";
    updating.add(caster.id);
    try {
      const active = await readShieldGraphics(obr, caster.id);
      if (!current()) return;
      if (active.length) {
        await obr.scene.items.deleteItems(active.map(({ id }) => id));
        return { active: false };
      }
      if (!canActivate) return "This avatar can’t cast Shield.";

      const [bounds, dpi] = await Promise.all([
        obr.scene.items.getItemBounds([caster.id]), obr.scene.grid.getDpi(),
      ]);
      if (!current()) return;
      if (![bounds?.center?.x, bounds?.center?.y, dpi].every(Number.isFinite) || dpi <= 0) {
        return "Couldn’t attach Shield to your avatar.";
      }
      const size = Math.max(bounds.max?.x - bounds.min?.x, bounds.max?.y - bounds.min?.y);
      const scale = Number.isFinite(size) && size > 0 ? 0.75 * size / dpi : 0.75;
      const deadline = Date.now() + SHIELD_INTRO_MS;
      const effect = buildImage(SHIELD_INTRO, { dpi: 200, offset: { x: 200, y: 200 } })
        .position(bounds.center).scale({ x: scale, y: scale }).layer("ATTACHMENT")
        .attachedTo(caster.id).disableHit(true).locked(true)
        .metadata({ [SHIELD]: true, [SHIELD_INTRO_END]: deadline }).build();
      effect.disableAttachmentBehavior = ["COPY", "ROTATION"];
      await obr.scene.items.addItems([effect]);
      if (current()) finishIntro(effect.id, deadline, current);
      return { active: true };
    } finally {
      updating.delete(caster.id);
    }
  };
}
