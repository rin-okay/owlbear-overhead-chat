export const AVATAR = "chat.overhead.avatar.v1";
export const SPEECH = "chat.overhead.speech.v1";
export const MAX_LENGTH = 180;
export const BUBBLE_MS = 6000;

export function isPublicToken(token) {
  return token?.type === "IMAGE" && token.layer === "CHARACTER" && token.visible === true;
}

export function canSpeak(player, token, permissions) {
  if (!player || !isPublicToken(token)) return false;
  if (player.role === "GM") return true;

  return player.role === "PLAYER" &&
    !token.locked &&
    permissions.includes("CHARACTER_UPDATE") &&
    (!permissions.includes("CHARACTER_OWNER_ONLY") || token.createdUserId === player.id);
}

export function parseSpeech(data) {
  if (!data || typeof data !== "object") return null;
  const { tokenId, text } = data;
  if (typeof tokenId !== "string" || !tokenId || tokenId.length > 128 ||
      typeof text !== "string" || text.length > MAX_LENGTH) return null;
  const line = text.trim().replace(/\s+/gu, " ");
  return line ? { tokenId, text: line } : null;
}
