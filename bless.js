import { isProjectileToken } from "./projectile-collision.js?v=2.7.3";
import { spellParameter, tokenTeams } from "./skills.js?v=2.7.7";

const BLESS_CASTER = "chat.overhead.bless.caster.v1";
// The JB2A loop used by Embers' Bless. Overhead Chat owns the attachment lifecycle.
const BLESS_IMAGE = {
  url: "https://jb2a-free.s3.eu-west-3.amazonaws.com/1st_Level/Bless/Bless_01_Regular_Yellow_Loop_400x400.webm",
  width: 400,
  height: 400,
  mime: "video/webm",
};

export function setupBless(obr, buildImage) {
  const casting = new Set();

  return async (caster, selectedIds, config, current) => {
    if (casting.has(caster.id)) return "Bless is still updating.";
    casting.add(caster.id);
    try {
      const isActiveGraphic = (item) => item.type === "IMAGE" && item.layer === "ATTACHMENT" &&
        item.image?.url === BLESS_IMAGE.url && item.metadata?.[BLESS_CASTER] === caster.id;
      const sceneItems = await obr.scene.items.getItems((item) => isActiveGraphic(item) || isProjectileToken(item));
      if (!current()) return;
      const active = sceneItems.filter(isActiveGraphic);
      if (active.length) {
        await obr.scene.items.deleteItems(active.map(({ id }) => id));
        return "";
      }

      const dpi = await obr.scene.grid.getDpi();
      if (!Number.isFinite(dpi) || dpi <= 0) return "Couldn’t read the scene grid for Bless.";
      const range = spellParameter(config, caster.id, "bless") * dpi;
      const limit = spellParameter(config, caster.id, "bless", "targetLimit");
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

      const graphics = await Promise.all(targets.map(async (target) => {
        const bounds = await obr.scene.items.getItemBounds([target.id]).catch(() => null);
        if (!Number.isFinite(bounds?.center?.x) || !Number.isFinite(bounds?.center?.y)) return null;
        const size = Math.max(bounds.max?.x - bounds.min?.x, bounds.max?.y - bounds.min?.y);
        const scale = Number.isFinite(size) && size > 0 ? size / (dpi * 2) : 0.5;
        const image = buildImage(BLESS_IMAGE, { dpi: 200, offset: { x: 200, y: 200 } })
          .position(bounds.center).scale({ x: scale, y: scale }).layer("ATTACHMENT")
          .attachedTo(target.id).disableHit(true).locked(true)
          .metadata({ [BLESS_CASTER]: caster.id }).build();
        image.disableAttachmentBehavior = ["COPY", "ROTATION"];
        return image;
      }));
      if (!current()) return;
      const items = graphics.filter(Boolean);
      if (!items.length) return "Couldn’t attach Bless to the selected tokens.";
      await obr.scene.items.addItems(items);
      return "";
    } finally {
      casting.delete(caster.id);
    }
  };
}
