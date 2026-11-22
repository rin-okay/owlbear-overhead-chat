import { AVATAR, isPublicToken } from "./rules.js";
import { savedAvatar } from "./session.js";

export async function centerAvatar(obr) {
  if (!await obr.scene.isReady()) return;
  const metadata = await obr.player.getMetadata();
  const id = metadata[AVATAR]?.tokenId ?? savedAvatar();
  if (!id) return;
  const [token] = await obr.scene.items.getItems([id]);
  if (!isPublicToken(token)) return;
  const [{ center }, width, height, scale] = await Promise.all([
    obr.scene.items.getItemBounds([id]), obr.viewport.getWidth(), obr.viewport.getHeight(), obr.viewport.getScale(),
  ]);
  if (![center?.x, center?.y, width, height, scale].every(Number.isFinite) || scale <= 0) return;
  await obr.viewport.setPosition({ x: width / 2 - center.x * scale, y: height / 2 - center.y * scale });
}
