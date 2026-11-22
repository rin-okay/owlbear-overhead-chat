import OBR from "./obr.js";
import { GENERAL_CHAT_ROOM } from "./rules.js";

function storageKey() {
  return JSON.stringify(["chat.overhead.discord.v1", OBR.room.id, OBR.player.id]);
}

export function normalizeWebhook(value) {
  if (typeof value !== "string") return "";
  const input = value.trim().replace(/^<([^<>]+)>$/u, "$1");
  const match = /^https:\/\/(?:(?:www|ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{17,22})\/([A-Za-z0-9_-]{30,150})\/?(\?[^#\s]*)?$/iu.exec(input);
  if (!match) return "";
  const [, id, token, query] = match;
  const params = new URLSearchParams(query);
  const thread = params.get("thread_id");
  if ([...params.keys()].some((key) => key !== "wait" && key !== "thread_id")) return "";
  if (thread !== null && (!/^\d{17,22}$/u.test(thread) || params.getAll("thread_id").length !== 1)) return "";
  const url = `https://discord.com/api/webhooks/${id}/${token}`;
  return thread ? `${url}?thread_id=${thread}` : url;
}

export function discordSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()));
    const url = normalizeWebhook(saved?.url ?? "");
    return { url, enabled: Boolean(url && saved?.enabled), otherTabs: saved?.otherTabs === true };
  } catch {
    return { url: "", enabled: false, otherTabs: false };
  }
}

export function saveDiscordSettings(settings) {
  if (settings.url) localStorage.setItem(storageKey(), JSON.stringify(settings));
  else localStorage.removeItem(storageKey());
}

const plainText = (value) => String(value).replace(/([\\*_~`|<>])/gu, "\\$1");

export async function sendDiscord(url, entry, stillEnabled = () => true) {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("wait", "true");
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
      response = await fetch(requestUrl, {
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
const canMirror = (entry, settings) => settings.enabled &&
  (entry.roomId === GENERAL_CHAT_ROOM || settings.otherTabs);

export function queueDiscord(entry, role, report) {
  if (role !== "GM") return;
  const settings = discordSettings();
  if (!canMirror(entry, settings)) return;
  const { url } = settings;
  if (queued >= 60) {
    report("Discord is backed up. A message was skipped.");
    return;
  }

  queued++;
  relayQueue = relayQueue.then(async () => {
    const stillEnabled = async () => {
      if (await OBR.player.getRole() !== "GM") return false;
      const settings = discordSettings();
      return settings.url === url && canMirror(entry, settings);
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
