export const KEY = "io.github.rin-okay.motif";
export const REQUEST = KEY + "/request";
export const PLAY = KEY + "/play";
export const REPLY = KEY + "/reply";
export const LOCAL = KEY + "/local";
export const EMPTY = { cues: [], active: [] };

const samples = [
  ["lantern-room", "Lantern Room", "music", "ambient, synth", 0.55, 16],
  ["threshold", "Threshold", "sfx", "door, creak", 0.8, 1.5],
  ["spell-chime", "Spell Chime", "sfx", "magic, shimmer", 0.85, 1.8],
  ["low-impact", "Low Impact", "sfx", "hit, percussion", 0.8, 1.2],
];

export const BUILT_INS = samples.map(([id, name, kind, tags, volume, duration]) => ({
  id, name, kind, tags, volume, end: duration, start: 0,
  loop: kind === "music", allowPlayers: false,
  url: new URL("./audio/" + id + ".mp3", import.meta.url).href,
}));

export function byId(state, id) {
  return BUILT_INS.find(cue => cue.id === id) ?? state.cues.find(cue => cue.id === id);
}

export function audioUrl(value) {
  if (typeof value !== "string" || value.length > 1500) throw Error("Enter a public HTTPS audio URL.");
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password) throw Error("Enter a public HTTPS audio URL.");
  if (["www.dropbox.com", "dropbox.com"].includes(url.hostname)) {
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");
  }
  url.hash = "";
  return url.href;
}

export function playbackSettings(data) {
  const { start, end, volume, loop } = data ?? {};
  if (!Number.isFinite(volume) || volume < 0 || volume > 1 ||
      !Number.isFinite(start) || start < 0 || start > 86400 ||
      (end !== null && (!Number.isFinite(end) || end <= start || end > 86400))) {
    throw Error("Set a valid volume and a clip end later than its start.");
  }
  return { start, end, volume, loop: loop === true };
}

function cleanCue(id, data) {
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  if (!name || name.length > 80 || !["music", "sfx"].includes(data.kind)) throw Error("Enter a cue name and type.");
  return {
    id, name, kind: data.kind, url: audioUrl(data.url),
    tags: typeof data.tags === "string" ? data.tags.trim().slice(0, 120) : "",
    allowPlayers: data.kind === "sfx" && data.allowPlayers === true,
    ...playbackSettings(data),
  };
}

export function elapsed(entry, now) {
  return entry.offset + (entry.since === null ? 0 : Math.max(0, now - entry.since) / 1000);
}

// Let the media's end event remove the entry first, with a cleanup deadline
// for clients that never load the file or cannot report its end.
export function shouldPrune(entry, now) {
  return !entry.loop && entry.since !== null && entry.end !== null &&
    elapsed(entry, now) >= entry.end - entry.start + 4;
}

export function applyRequest(state, request, { gm, now, id, owner }) {
  const { type } = request;
  if (!gm && type !== "play") throw Error("Only the GM can control room playback.");
  const active = state.active.filter(entry => !shouldPrune(entry, now));
  if (type === "play") {
    const cue = byId(state, request.cueId);
    if (!cue || (!gm && !cue.allowPlayers)) throw Error("This cue is unavailable to you.");
    const keep = cue.kind === "music" ? active.filter(entry => entry.kind !== "music") : active;
    if (keep.length >= 16) throw Error("Stop an active cue before starting another.");
    const { name, url, kind, start, end, loop, volume } = cue;
    return { ...state, active: [...keep, { id, owner, name, url, kind, start, end, loop, volume, hidden: false, offset: 0, since: now }] };
  }
  if (type === "save") {
    if (request.cueId && !state.cues.some(cue => cue.id === request.cueId)) throw Error("That custom cue was removed.");
    if (!request.cueId && state.cues.length >= 32) throw Error("This room has 32 custom cues.");
    const cue = cleanCue(request.cueId ?? id, request.cue);
    return { ...state, cues: [...state.cues.filter(item => item.id !== cue.id), cue], active };
  }
  if (type === "delete") return { ...state, cues: state.cues.filter(cue => cue.id !== request.cueId), active };
  if (type === "stop-all") return { ...state, active: [] };
  if (type === "prune") return active.length === state.active.length ? state : { ...state, active };

  const entry = active.find(item => item.id === request.entryId);
  if (!entry) return active.length === state.active.length ? state : { ...state, active };
  let next;
  switch (type) {
    case "finish":
      if (entry.loop || entry.since === null || request.since !== entry.since || request.start !== entry.start || request.end !== entry.end) return state;
      // The current playback instance reached the end of the media.
      return { ...state, active: active.filter(item => item.id !== entry.id) };
    case "stop":
      return { ...state, active: active.filter(item => item.id !== entry.id) };
    case "pause":
      next = { ...entry, since: null, offset: elapsed(entry, now) };
      break;
    case "resume":
      if (entry.since !== null) return state;
      next = { ...entry, since: now };
      break;
    case "hide":
      next = { ...entry, hidden: !entry.hidden };
      break;
    case "edit": {
      const settings = playbackSettings(request.settings);
      const restart = settings.start !== entry.start || settings.end !== entry.end || settings.loop !== entry.loop;
      next = { ...entry, ...settings, ...(restart ? { offset: 0, since: entry.since === null ? null : now } : {}) };
      break;
    }
    default:
      throw Error("Unknown Motif action.");
  }
  return { ...state, active: active.map(item => item.id === entry.id ? next : item) };
}
