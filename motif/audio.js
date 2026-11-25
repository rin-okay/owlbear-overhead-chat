import { BUILT_INS, elapsed, KEY } from "./model.js?v=0.1.1";

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
  if (warming.size >= BUILT_INS.length) return Promise.resolve(false);
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

const builtInUrls = new Set(BUILT_INS.map(cue => cue.url));

export function warmSamples() {
  for (const url of builtInUrls) void warm(url);
}

export function createEngine({ onBlocked, onFinish, onError, enabled = true }) {
  const players = new Map();
  let mix = loadMix();
  let entries = [];
  let suspended = false;

  function remove(id, cacheAfterPlayback = false) {
    const channel = players.get(id);
    if (!channel) return;
    players.delete(id);
    channel.audio.pause();
    channel.audio.removeAttribute("src");
    channel.audio.load();
    if (channel.blob) URL.revokeObjectURL(channel.blob);
    if (cacheAfterPlayback && channel.streamed && channel.didPlay && !channel.error) {
      void warm(channel.entry.url);
    }
  }

  function finish(channel) {
    channel.audio.pause();
    if (channel.finished) return;
    channel.finished = true;
    onFinish(channel.entry);
  }

  function checkBoundary(channel) {
    const { audio, entry } = channel;
    if (audio.seeking || channel.align || channel.finished || entry.since === null) return;
    const trimReached = entry.end !== null && audio.currentTime >= entry.end;
    if (!audio.ended && !trimReached) return;
    if (!entry.loop) {
      finish(channel);
    } else if (!audio.loop) {
      // Only trimmed loops need a manual seek. Full-file loops are native.
      audio.currentTime = entry.start;
      start(channel);
    }
  }

  function start(channel) {
    const { audio, entry } = channel;
    if (players.get(entry.id) !== channel || !enabled || suspended || entry.since === null || channel.error || channel.finished ||
        channel.blocked || channel.starting || !audio.paused || audio.readyState < 3 || audio.seeking) return;

    // Synchronize when joining, resuming or editing the clip. Once playback starts,
    // the media clock owns the playhead, including across a network stall.
    if (channel.align) {
      const position = clipPosition(entry, audio.duration, Date.now());
      if (position === null) {
        finish(channel);
        return;
      }
      channel.align = false;
      if (Math.abs(audio.currentTime - position) >= 0.035) audio.currentTime = position;
      if (audio.seeking) return;
    }

    const startingEntry = channel.entry;
    channel.starting = true;
    void audio.play().then(() => {
      channel.didPlay = true;
    }).catch(error => {
      if (players.get(entry.id) !== channel) return;
      if (error.name === "NotAllowedError") {
        channel.blocked = true;
        onBlocked();
      }
    }).finally(() => {
      channel.starting = false;
      if (channel.align && channel.entry !== startingEntry) start(channel);
    });
  }

  function updateOptions(channel) {
    const { audio, entry } = channel;
    audio.loop = entry.loop && entry.start === 0 &&
      (entry.end === null || (Number.isFinite(audio.duration) && entry.end >= audio.duration));
    audio.muted = entry.hidden;
    audio.volume = entry.volume * mix[entry.kind];
  }

  function add(entry) {
    const audio = new Audio();
    audio.preload = "auto";
    const channel = { entry, audio, align: true };
    players.set(entry.id, channel);
    audio.addEventListener("loadedmetadata", () => updateOptions(channel));
    audio.addEventListener("durationchange", () => updateOptions(channel));
    audio.addEventListener("canplay", () => start(channel));
    audio.addEventListener("seeked", () => start(channel));
    audio.addEventListener("timeupdate", () => checkBoundary(channel));
    audio.addEventListener("ended", () => checkBoundary(channel));
    audio.addEventListener("error", () => {
      if (players.get(entry.id) !== channel) return;
      channel.error = true;
      onError(channel.entry);
    });
    void (async () => {
      let response = await cached(entry.url);
      if (!response && builtInUrls.has(entry.url)) {
        // The bundled cues are small. Complete the cache request before playing,
        // rather than downloading the same file twice during its first playback.
        if (await warm(entry.url)) response = await cached(entry.url);
      }
      const blob = response && await response.blob();
      if (players.get(entry.id) !== channel) return;
      if (blob) channel.blob = URL.createObjectURL(blob);
      channel.streamed = !channel.blob && !builtInUrls.has(entry.url);
      audio.src = channel.blob ?? entry.url;
    })().catch(() => {
      if (players.get(entry.id) === channel) audio.src = entry.url;
    });
    return channel;
  }

  function render(next = entries) {
    entries = next;
    const live = new Set(next.map(entry => entry.id));
    for (const id of players.keys()) {
      if (!live.has(id) || suspended) remove(id, !suspended);
    }
    if (suspended) return;
    for (const entry of next) {
      if (entry.hidden && !players.has(entry.id)) continue;
      const channel = players.get(entry.id) ?? add(entry);
      const previous = channel.entry;
      channel.entry = entry;
      if (entry.since !== previous.since || entry.offset !== previous.offset ||
          entry.start !== previous.start || entry.end !== previous.end || entry.loop !== previous.loop) {
        channel.align = true;
        channel.finished = false;
        channel.audio.pause();
      }
      updateOptions(channel);
      if (entry.since === null) channel.audio.pause();
      else start(channel);
    }
  }

  const timer = setInterval(() => {
    for (const channel of players.values()) {
      if (channel.entry.end !== null && !channel.audio.loop && !channel.audio.paused) checkBoundary(channel);
    }
  }, 50);
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
        start(channel);
      }
    },
  };
}
