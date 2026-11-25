import OBR from "./obr.js";
import { normalizeAppearance } from "./appearance.js?v=2.7.9";
import { parseEmote } from "./emotes.js?v=2.7.21";
import { AVATAR } from "./rules.js";

function avatarKey() {
  return JSON.stringify([AVATAR, OBR.room.id, OBR.player.id]);
}

export function savedAvatar() {
  try {
    return localStorage.getItem(avatarKey());
  } catch {
    return null;
  }
}

export function saveAvatar(tokenId) {
  try {
    localStorage.setItem(avatarKey(), tokenId);
  } catch {
    // Player metadata still shares the selection within this room session.
  }
}

let avatarSlots;
let avatarMode;
let quickbarSlots;

export function savedAvatarSlots() {
  if (avatarSlots) return avatarSlots;
  let stored;
  try { stored = JSON.parse(localStorage.getItem(avatarKey() + ":slots")); } catch {}
  avatarSlots = Array.from({ length: 9 }, (_, index) =>
    typeof stored?.[index] === "string" ? stored[index] : "");
  return avatarSlots;
}

export function saveAvatarSlot(index, tokenId) {
  const slots = savedAvatarSlots();
  slots[index] = tokenId;
  try { localStorage.setItem(avatarKey() + ":slots", JSON.stringify(slots)); } catch {}
}

export function savedAvatarMode() {
  if (avatarMode) return avatarMode;
  try {
    if (localStorage.getItem(avatarKey() + ":mode") === "change") avatarMode = "change";
  } catch {}
  return avatarMode ??= "talk";
}

export function saveAvatarMode(mode) {
  avatarMode = mode === "change" ? "change" : "talk";
  try { localStorage.setItem(avatarKey() + ":mode", avatarMode); } catch {}
}

function normalizeAvatarArt(asset) {
  const { name, image, grid } = asset ?? {};
  if (!image || !grid ||
      typeof image.url !== "string" || !image.url ||
      typeof image.mime !== "string" || !image.mime ||
      ![image.width, image.height, grid.dpi].every((value) => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(grid.offset?.x) || !Number.isFinite(grid.offset?.y)) return null;
  return {
    name: typeof name === "string" && name.trim() ? name : "Character art",
    image: { url: image.url, mime: image.mime, width: image.width, height: image.height },
    grid: { dpi: grid.dpi, offset: { x: grid.offset.x, y: grid.offset.y } },
  };
}

function normalizeQuickbar(slot) {
  if (slot?.kind === "avatar") {
    const artwork = normalizeAvatarArt(slot.artwork);
    if (artwork) return { kind: "avatar", artwork };
  }
  if (slot?.kind === "emote") {
    const emote = parseEmote(slot.emote);
    if (emote) return { kind: "emote", emote, name: typeof slot.name === "string" ? slot.name.slice(0, 100) : "" };
  }
  if (slot?.kind === "spell" && typeof slot.skill === "string") return { kind: "spell", skill: slot.skill };
  return null;
}

export function savedQuickbarSlots() {
  if (quickbarSlots) return quickbarSlots;
  let stored;
  let legacy;
  try {
    stored = JSON.parse(localStorage.getItem(avatarKey() + ":quickbar"));
    if (!Array.isArray(stored)) legacy = JSON.parse(localStorage.getItem(avatarKey() + ":art"));
  } catch {}
  quickbarSlots = Array.from({ length: 10 }, (_, index) => {
    if (index === 9 && stored?.[index] === undefined) return { kind: "spell", skill: "sleep" };
    return normalizeQuickbar(legacy ? { kind: "avatar", artwork: legacy[index] } : stored?.[index]);
  });
  return quickbarSlots;
}

export function saveQuickbarSlot(index, value) {
  const slot = normalizeQuickbar(value);
  if (value && !slot) return null;
  const slots = savedQuickbarSlots();
  slots[index] = slot;
  try { localStorage.setItem(avatarKey() + ":quickbar", JSON.stringify(slots)); } catch {}
  return slot;
}

export async function openSessionChannel() {
  const connectionId = await OBR.player.getConnectionId();
  return new BroadcastChannel(JSON.stringify(["chat.overhead.transcript", OBR.room.id, connectionId]));
}

function appearanceKey() {
  return JSON.stringify(["chat.overhead.appearance.v1", OBR.player.id]);
}

let currentAppearance;

export function savedAppearance() {
  try {
    return currentAppearance ?? normalizeAppearance(JSON.parse(localStorage.getItem(appearanceKey())));
  } catch {
    return currentAppearance ?? normalizeAppearance();
  }
}

export function saveAppearance(value) {
  currentAppearance = normalizeAppearance(value);
  try {
    localStorage.setItem(appearanceKey(), JSON.stringify(currentAppearance));
  } catch {
    // The open panel can still use the settings for outgoing messages.
  }
  return currentAppearance;
}
