import OBR from "./obr.js";
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
