import OBR from "./obr.js";

function storageKey() {
  return JSON.stringify(["chat.overhead.discord.v1", OBR.room.id, OBR.player.id]);
}

export function normalizeWebhook(value) {
  const match = /^https:\/\/discord\.com\/api\/(?:v\d+\/)?webhooks\/(\d{17,22})\/([A-Za-z0-9_-]{30,150})\/?$/iu.exec(value.trim());
  return match ? `https://discord.com/api/webhooks/${match[1]}/${match[2]}` : "";
}

export function discordSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()));
    const url = normalizeWebhook(saved?.url ?? "");
    return { url, enabled: Boolean(url && saved?.enabled) };
  } catch {
    return { url: "", enabled: false };
  }
}

export function saveDiscordSettings(settings) {
  if (settings.url) localStorage.setItem(storageKey(), JSON.stringify(settings));
  else localStorage.removeItem(storageKey());
}

const plainText = (value) => String(value).replace(/([\\*_~`|<>])/gu, "\\$1");

export async function sendDiscord(url, entry, stillEnabled = () => true) {
  const timestamp = Math.floor((entry.receivedAt ?? Date.now()) / 1000);
  const body = JSON.stringify({
    content: `**${plainText(entry.name).replace(/\s+/gu, " ")}** <t:${timestamp}:t>\n${plainText(entry.text)}`,
    allowed_mentions: { parse: [] },
    flags: 4,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!await stillEnabled()) return false;
    let response;
    try {
      response = await fetch(`${url}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Couldn't reach Discord. Check your connection and try again.");
    }

    if (response.ok) return true;
    if (response.status === 429 && attempt === 0) {
      const limit = await response.json().catch(() => ({}));
      const seconds = Number(limit.retry_after ?? response.headers.get("retry-after"));
      if (seconds > 0 && seconds <= 30) {
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 150));
        continue;
      }
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error("Discord rejected the webhook. Check the channel and copy a fresh webhook URL.");
    }
    if (response.status === 429) throw new Error("Discord is rate-limiting the relay.");
    throw new Error(`Discord returned HTTP ${response.status}.`);
  }
}

let relayQueue = Promise.resolve();
let queued = 0;

function claimRelay() {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request(storageKey(), { ifAvailable: true }, (lock) => {
      resolve(Boolean(lock));
      if (lock) return new Promise((release) => window.addEventListener("pagehide", release, { once: true }));
    }).catch(() => resolve(false));
  });
}

let relayClaim;
export function queueDiscord(entry, role, report) {
  if (role !== "GM") return;
  const { url, enabled } = discordSettings();
  if (!enabled) return;
  if (queued >= 60) {
    report("Discord is backed up. A message was skipped.");
    return;
  }

  queued++;
  relayQueue = relayQueue.then(async () => {
    const stillEnabled = async () => {
      if (await OBR.player.getRole() !== "GM") return false;
      const settings = discordSettings();
      return settings.enabled && settings.url === url;
    };
    if (!await stillEnabled()) return;
    const claim = relayClaim ??= claimRelay();
    if (!await claim) {
      if (relayClaim === claim) relayClaim = undefined;
      return;
    }
    if (await sendDiscord(url, entry, stillEnabled)) report("Mirroring new messages to Discord.");
  }).catch((error) => report(error.message)).finally(() => { queued--; });
}
