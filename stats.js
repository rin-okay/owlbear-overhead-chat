import { canSpeak, isPublicToken } from "./rules.js?v=2.6.16";

export const TOKEN_STATS = "chat.overhead.token-stats.v1";
export const ABILITIES = {
  str: "strength", dex: "dexterity", con: "constitution",
  int: "intelligence", wis: "wisdom", cha: "charisma",
};

export const COMBAT_STATS = {
  ac: { label: "armor class", minimum: 0, initial: 10 },
  level: { label: "level", minimum: 1, maximum: 20, initial: 1 },
  proficiency: { label: "proficiency bonus", minimum: 0, initial: 2 },
};
const keys = Object.keys(ABILITIES);
const validDetail = (key, value) => {
  const { minimum, maximum = Number.MAX_SAFE_INTEGER } = COMBAT_STATS[key];
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
};
export const validAbilityScore = (score) => Number.isInteger(score) && score >= 1 && score <= 30;
export const abilityModifier = (score) => Math.floor((score - 10) / 2);

export function readTokenStats(token) {
  const data = token?.metadata?.[TOKEN_STATS];
  const scores = Object.fromEntries(keys.map((key) => {
    const score = data?.scores?.[key];
    return [key, validAbilityScore(score) ? score : 10];
  }));
  return {
    scores,
    modifiers: Object.fromEntries(keys.map((key) => [key, abilityModifier(scores[key])])),
    details: Object.fromEntries(Object.entries(COMBAT_STATS).map(([key, { initial }]) =>
      [key, validDetail(key, data?.details?.[key]) ? data.details[key] : initial])),
    editable: data?.editable === true,
  };
}

export async function writeTokenStats(obr, tokenId, scores, { gm, editable, expected, current, details }) {
  if (!keys.every((key) => validAbilityScore(scores?.[key]))) {
    throw Error("Enter whole scores from 1 to 30.");
  }
  if (details && !Object.keys(COMBAT_STATS).every((key) => validDetail(key, details[key]))) {
    throw Error("Enter valid whole numbers for AC, level, and proficiency bonus.");
  }
  const [role, permissions, ready] = await Promise.all([
    obr.player.getRole(), obr.room.getPermissions(), obr.scene.isReady(),
  ]);
  if (!ready || !current()) throw Error("The selected token changed.");
  let applied = false;
  await obr.scene.items.updateItems([tokenId], ([item]) => {
    if (!current() || !isPublicToken(item)) throw Error("The selected token changed.");
    const previous = readTokenStats(item);
    const allowed = gm ? role === "GM" : previous.editable && canSpeak({ role, id: obr.player.id }, item, permissions);
    if (!allowed) throw Error("You can’t edit stats for this token.");
    if (JSON.stringify(previous) !== expected) throw Error("The stats changed. Review the latest scores and try again.");
    item.metadata[TOKEN_STATS] = {
      scores: Object.fromEntries(keys.map((key) => [key, scores[key]])),
      details: Object.fromEntries(Object.keys(COMBAT_STATS).map((key) => [key, (details ?? previous.details)[key]])),
      editable: gm ? editable === true : previous.editable,
    };
    applied = true;
  });
  if (!applied) throw Error("The selected token is unavailable.");
}
