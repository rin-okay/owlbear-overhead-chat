import OBR from "./obr.js";
import { normalizeAppearance } from "./appearance.js";
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
