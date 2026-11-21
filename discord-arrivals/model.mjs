export const CONFIG = "chat.overhead.discord-arrivals/config";
export const ARRIVAL = "chat.overhead.discord-arrivals/token";
export const AVATAR = "chat.overhead.avatar.v1";
export const CLAIM = "chat.overhead.discord-arrivals/claim";
export const RESULT = "chat.overhead.discord-arrivals/result";
export const MODAL = "chat.overhead.discord-arrivals/welcome";
export const linkKey = (player) => "chat.overhead.discord-arrivals/link/" + player;
export const dismissKey = (room, player) => CONFIG + "/" + room + "/" + player;
export const defaults = { enabled: false, vision: "smoke-manual", radius: 12, templateId: "" };

export function httpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.href === url.origin + "/") return url.origin;
  } catch {}
  return "";
}

export function workerOrigin(config, here) {
  return httpsOrigin(config?.worker) || (new URL(here).hostname.endsWith(".github.io") ? "" : here);
}

export function point(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y);
}
export function character(item) {
  return item?.type === "IMAGE" && item.layer === "CHARACTER";
}
export function smokeFields(item) {
  return Object.fromEntries(Object.entries(item?.metadata ?? {}).filter(([key]) =>
    /^com\.battle-system\.smoke(?:[./:-]|$)/i.test(key)));
}

export async function avatarTokenId(room, profile) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(room + ":" + profile)));
  hash[6] = (hash[6] & 15) | 80;
  hash[8] = (hash[8] & 63) | 128;
  const raw = [...hash.subarray(0,16)].map((n) => n.toString(16).padStart(2,"0")).join("");
  return raw.slice(0,8) + "-" + raw.slice(8,12) + "-" + raw.slice(12,16) + "-" + raw.slice(16,20) + "-" + raw.slice(20);
}
