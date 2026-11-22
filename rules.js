export const RUMBLE_DICE = "chat.overhead.rumble-dice.v1";
export const AVATAR = "chat.overhead.avatar.v1";
export const ABOVE_FOG = "chat.overhead.above-fog.v1";
export const HABBO_MODE = "chat.overhead.habbo-mode.v1";
export const HABBO_SCALE = "chat.overhead.habbo-scale.v1";
export const DEFAULT_HABBO_SCALE = 2;
export const SPEECH = "chat.overhead.speech.v1";
export const MAX_LENGTH = 180;
export const BUBBLE_MS = 6000;
export const GENERAL_CHAT_ROOM = "general";
const CHAT_ROOMS = new Set([GENERAL_CHAT_ROOM, "rin", "kim"]);

export function normalizeHabboScale(value) {
  return Number.isFinite(value) ? Math.min(5, Math.max(0.5, value)) : DEFAULT_HABBO_SCALE;
}

export function isChatRoom(roomId) {
  return CHAT_ROOMS.has(roomId);
}

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
  const { tokenId, text, roomId = GENERAL_CHAT_ROOM } = data;
  if (typeof tokenId !== "string" || !tokenId || tokenId.length > 128 ||
      typeof text !== "string" || text.length > MAX_LENGTH || !isChatRoom(roomId)) return null;
  const line = text.replace(/\r\n?/gu, "\n").trim().split("\n")
    .map((part) => part.trim().replace(/[^\S\n]+/gu, " ")).join("\n");
  return line ? { tokenId, text: line, roomId } : null;
}
