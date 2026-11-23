const SHIELD = "chat.overhead.shield.v1";
const SHIELD_IMAGE = {
  url: "https://jb2a-free.s3.eu-west-3.amazonaws.com/1st_Level/Shield/Shield_01_Regular_Blue_Loop_400x400.webm",
  width: 400,
  height: 400,
  mime: "video/webm",
};

export function isShieldGraphic(item) {
  return item.type === "IMAGE" && item.layer === "ATTACHMENT" &&
    item.metadata?.[SHIELD] === true && item.image?.url === SHIELD_IMAGE.url;
}

export function readShieldGraphics(obr, tokenId) {
  return obr.scene.items.getItems((item) => isShieldGraphic(item) && item.attachedTo === tokenId);
}

export function setupShield(obr, buildImage) {
  const updating = new Set();

  return async (caster, canActivate, current) => {
    if (updating.has(caster.id)) return "Shield is still updating.";
    updating.add(caster.id);
    try {
      const active = await readShieldGraphics(obr, caster.id);
      if (!current()) return;
      if (active.length) {
        await obr.scene.items.deleteItems(active.map(({ id }) => id));
        return;
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
      const effect = buildImage(SHIELD_IMAGE, { dpi: 200, offset: { x: 200, y: 200 } })
        .position(bounds.center).scale({ x: scale, y: scale }).layer("ATTACHMENT")
        .attachedTo(caster.id).disableHit(true).locked(true).metadata({ [SHIELD]: true }).build();
      effect.disableAttachmentBehavior = ["COPY", "ROTATION"];
      await obr.scene.items.addItems([effect]);
    } finally {
      updating.delete(caster.id);
    }
  };
}
