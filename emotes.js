export const EMOTE = "chat.overhead.emote.v1";
export const BUILTIN_EMOTES = { heart: "❤️", star: "⭐" };

export function emoteImage(image) {
  if (typeof image?.url !== "string" || image.url.length > 2048 ||
      !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "video/webm"].includes(image.mime) ||
      ![image.width, image.height].every((value) => Number.isFinite(value) && value > 0 && value <= 16384)) return;
  try {
    const url = new URL(image.url);
    if (url.protocol !== "https:" || url.username || url.password ||
        !["images.owlbear.rodeo", "assets.owlbear.rodeo"].includes(url.host)) return;
    return { url: image.url, mime: image.mime, width: image.width, height: image.height };
  } catch {}
}

export function parseEmote(value) {
  if (typeof value?.id === "string" && Object.hasOwn(BUILTIN_EMOTES, value.id)) return { id: value.id };
  const image = emoteImage(value?.image);
  if (image) return { image };
}

export async function floatEmote(obr, buildImage, buildLabel, tokenId, emote, current) {
  const [bounds, scale, dpi] = await Promise.all([
    obr.scene.items.getItemBounds([tokenId]), obr.viewport.getScale(), obr.scene.grid.getDpi(),
  ]);
  if (!current() || ![bounds?.center?.x, bounds?.min?.y, scale, dpi].every(Number.isFinite) || scale <= 0 || dpi <= 0) return;
  const image = emote.image;
  const position = { x: bounds.center.x, y: bounds.min.y - 16 / scale };
  const factor = 42 / (dpi * scale);
  const builder = image
    ? buildImage(image, { dpi: Math.max(image.width, image.height), offset: { x: image.width / 2, y: image.height / 2 } })
      .scale({ x: factor, y: factor })
    : buildLabel().plainText(BUILTIN_EMOTES[emote.id]).fontSize(24).padding(0)
      .backgroundOpacity(0).pointerWidth(0).pointerHeight(0).textAlign("CENTER");
  const item = builder.position(position).layer("ATTACHMENT").locked(true).attachedTo(tokenId).build();
  item.disableHit = true;
  item.disableAttachmentBehavior = ["COPY", "LOCKED", "ROTATION", "SCALE"];
  const ids = [item.id];
  try {
    await obr.scene.local.addItems([item]);
    for (let frame = 1; frame <= 8; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 125));
      if (!current()) return;
      await obr.scene.local.updateItems(ids, ([marker]) => {
        if (!marker) return;
        marker.position.y -= 4 / scale;
        const fade = Math.min(1, (9 - frame) / 5);
        if (image) marker.scale = { x: factor * fade, y: factor * fade };
        else marker.text.style.fillOpacity = fade;
      }, true);
    }
  } finally {
    if (current()) await obr.scene.local.deleteItems(ids);
  }
}
