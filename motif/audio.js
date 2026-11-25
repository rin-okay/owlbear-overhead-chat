import { elapsed, KEY } from "./model.js";

const CACHE = "motif-audio-v1";
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 12;
const warming = new Map();
let cacheWrites = Promise.resolve();

async function cached(url) {
  try { return await (await caches.open(CACHE)).match(url); }
  catch { return undefined; }
}

export function warm(url) {
  if (warming.has(url)) return warming.get(url);
  if (warming.size >= 3) return Promise.resolve(false);
  const work = (async () => {
    if (await cached(url)) return true;
    const response = await fetch(url, {
      credentials: "omit", cache: "force-cache", signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200 || !response.body ||
        !/^(audio\/|application\/octet-stream|application\/ogg|video\/)/i.test(response.headers.get("content-type") ?? "") ||
        Number(response.headers.get("content-length")) > MAX_BYTES) return false;
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return false;
      }
      chunks.push(value);
    }
    const write = cacheWrites.then(async () => {
      const cache = await caches.open(CACHE);
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_FILES + 1))) await cache.delete(key);
      const blob = new Blob(chunks, { type: response.headers.get("content-type") });
      await cache.put(url, new Response(blob, { headers: { "Content-Type": blob.type } }));
    });
    cacheWrites = write.catch(() => {});
    await write;
    return true;
  })().catch(() => false).finally(() => warming.delete(url));
  warming.set(url, work);
  return work;
}

export function clipPosition(entry, duration, now) {
  const end = Math.min(entry.end ?? Infinity, Number.isFinite(duration) ? duration : Infinity);
  const length = end - entry.start;
  const time = elapsed(entry, now);
  if (length <= 0 || (!entry.loop && time >= length)) return null;
  return entry.start + (entry.loop && Number.isFinite(length) ? time % length : time);
}

export function loadMix() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY + "/mix"));
    return {
      music: Number.isFinite(stored?.music) ? Math.max(0, Math.min(1, stored.music)) : 0.7,
      sfx: Number.isFinite(stored?.sfx) ? Math.max(0, Math.min(1, stored.sfx)) : 0.85,
    };
  } catch { return { music: 0.7, sfx: 0.85 }; }
}

export function createEngine({ onBlocked, onFinish, onError, enabled = true }) {
  const players = new Map();
  let mix = loadMix();
  let entries = [];
  let suspended = false;

  function remove(id) {
    const channel = players.get(id);
    if (!channel) return;
    players.delete(id);
    channel.audio.pause();
    channel.audio.removeAttribute("src");
    channel.audio.load();
    if (channel.blob) URL.revokeObjectURL(channel.blob);
  }

  function sync(channel, force = false) {
    const { audio, entry } = channel;
    if (suspended || entry.since === null) {
      audio.pause();
      return;
    }
    if (audio.readyState < 1 || channel.error) return;
    const position = clipPosition(entry, audio.duration, Date.now());
    if (position === null) {
      audio.pause();
      if (!channel.finished) {
        channel.finished = true;
        onFinish(entry);
      }
      return;
    }
    channel.finished = false;
    if (entry.hidden || !enabled) {
      audio.pause();
      return;
    }
    if (force || audio.ended || Math.abs(audio.currentTime - position) > 0.18) audio.currentTime = position;
    if (audio.paused && !channel.playing && !channel.blocked) {
      channel.playing = true;
      void audio.play().catch(error => {
        if (players.get(entry.id) !== channel) return;
        if (error.name === "NotAllowedError") {
          channel.blocked = true;
          onBlocked();
        }
      }).finally(() => { channel.playing = false; });
    }
  }

  function add(entry) {
    const audio = new Audio();
    audio.preload = "auto";
    const channel = { entry, audio };
    players.set(entry.id, channel);
    audio.addEventListener("loadedmetadata", () => sync(channel, true));
    audio.addEventListener("timeupdate", () => sync(channel));
    audio.addEventListener("ended", () => sync(channel, true));
    audio.addEventListener("error", () => {
      if (players.get(entry.id) !== channel) return;
      channel.error = true;
      onError(entry);
    });
    void cached(entry.url).then(async response => {
      if (response) channel.blob = URL.createObjectURL(await response.blob());
      if (players.get(entry.id) !== channel) {
        if (channel.blob) URL.revokeObjectURL(channel.blob);
        return;
      }
      audio.src = channel.blob ?? entry.url;
      if (!response) void warm(entry.url);
    }).catch(() => {
      if (players.get(entry.id) === channel) audio.src = entry.url;
    });
    return channel;
  }

  function render(next = entries) {
    entries = next;
    const live = new Set(next.map(entry => entry.id));
    for (const id of players.keys()) if (!live.has(id) || suspended) remove(id);
    if (suspended) return;
    for (const entry of next) {
      if (entry.hidden && !players.has(entry.id)) continue;
      const channel = players.get(entry.id) ?? add(entry);
      channel.entry = entry;
      channel.audio.volume = entry.volume * mix[entry.kind];
      sync(channel);
    }
  }

  const timer = setInterval(() => {
    for (const channel of players.values()) sync(channel);
  }, 150);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    for (const id of players.keys()) remove(id);
  }, { once: true });

  return {
    render,
    setMix(value) { mix = value; render(); },
    suspend(value) { suspended = value; render(); },
    retry() {
      enabled = true;
      for (const channel of players.values()) {
        channel.blocked = false;
        sync(channel, true);
      }
    },
  };
}
