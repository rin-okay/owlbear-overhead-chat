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

export function playWeaponSound(obr, id, name, caster) {
  // No source means Motif plays the cue without a map ripple. One loop overrides cue defaults.
  return obr.broadcast.sendMessage(MOTIF_EFFECTS, {
    instructions: [{ type: "effect", id, loops: 1, effectProperties: {} }],
    spellData: { name, caster },
  }, { destination: "ALL" });
}
