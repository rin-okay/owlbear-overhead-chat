const SLEEP = "chat.overhead.sleep-afk.v1";
const SLEEP_IMAGE = {
  url: "https://jb2a-free.s3.eu-west-3.amazonaws.com/1st_Level/Sleep/SleepSymbol01_01_Dark_Pink_400x400.webm",
  width: 400,
  height: 400,
  mime: "video/webm",
};

export function setupSleep(obr, buildImage) {
  const updating = new Set();

  return async (caster, current) => {
    if (updating.has(caster.id)) return "Sleep (AFK) is still updating.";
    updating.add(caster.id);
    try {
      const active = await obr.scene.items.getItems((item) => item.attachedTo === caster.id &&
        item.type === "IMAGE" && item.layer === "ATTACHMENT" &&
        item.metadata?.[SLEEP] === true && item.image?.url === SLEEP_IMAGE.url);
      if (!current()) return;
      if (active.length) {
        await obr.scene.items.deleteItems(active.map(({ id }) => id));
        return;
      }

      const [bounds, dpi] = await Promise.all([
        obr.scene.items.getItemBounds([caster.id]), obr.scene.grid.getDpi(),
      ]);
      if (!current()) return;
      if (![bounds?.center?.x, bounds?.center?.y, dpi].every(Number.isFinite) || dpi <= 0) {
        return "Couldn’t attach Sleep (AFK) to your avatar.";
      }
      const size = Math.max(bounds.max?.x - bounds.min?.x, bounds.max?.y - bounds.min?.y);
      const scale = Number.isFinite(size) && size > 0 ? size / (dpi * 4) : 0.25;
      const effect = buildImage(SLEEP_IMAGE, { dpi: 100, offset: { x: 200, y: 200 } })
        .position(bounds.center).scale({ x: scale, y: scale }).layer("ATTACHMENT")
        .attachedTo(caster.id).disableHit(true).locked(true).metadata({ [SLEEP]: true }).build();
      effect.disableAttachmentBehavior = ["COPY", "ROTATION"];
      await obr.scene.items.addItems([effect]);
    } finally {
      updating.delete(caster.id);
    }
  };
}
