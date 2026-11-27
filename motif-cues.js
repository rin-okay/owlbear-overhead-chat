// Motif and Overhead Chat share the published site origin, including access to the GM's library.
const ROOT = "io.github.rin-okay.motif-v2";
export const MOTIF_EFFECTS = ROOT + "/effects";
const BUILTIN = [["silver-bell", "Silver Bell"], ["low-knock", "Low Knock"], ["soft-sweep", "Soft Sweep"]];

export function motifSoundEffects(storage = globalThis.localStorage) {
  const cues = new Map(BUILTIN);
  try {
    const ids = JSON.parse(storage.getItem(ROOT + "/spell-list") ?? "[]");
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id)) continue;
      try {
        const cue = JSON.parse(storage.getItem(ROOT + "/spells/" + id));
        if (cue?.audio?.category === "effect" && typeof cue.name === "string") cues.set("$." + id, cue.name);
      } catch { /* Ignore damaged library entries. */ }
    }
  } catch { /* Built-in effects remain available. */ }
  return cues;
}

export function playCombatSounds(obr, cues, name, caster) {
  const instructions = cues.filter(({ id }) => id).map(({ id, delay }) => ({
    type: "effect", id, loops: 1, delay, effectProperties: {},
  }));
  for (let offset = 0; offset < instructions.length; offset += 16) {
    void obr.broadcast.sendMessage(MOTIF_EFFECTS, { instructions: instructions.slice(offset, offset + 16), spellData: { name, caster } },
      { destination: "ALL" }).catch(console.warn);
  }
}

export function updateSpellLoop(obr, key, sound, stopAfter) {
  void obr.broadcast.sendMessage(ROOT + "/overhead-loop", { key, sound, stopAfter },
    { destination: "ALL" }).catch(console.warn);
}

export const areaSound = (skill) => Boolean(skill?.impact || skill?.cone || skill?.location === "area");
export const soundDelayMs = (value) => Number.isInteger(value) && value >= 0 && value <= 10000 ? value : 0;

export function hitSoundCues(id, count, delay = 0) {
  return id ? Array.from({ length: count }, (_, index) => ({ id, delay: delay + index % 8 * 5 })) : [];
}
