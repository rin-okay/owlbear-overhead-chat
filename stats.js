import { canSpeak, isPublicToken } from "./rules.js?v=2.6.16";

export const TOKEN_STATS = "chat.overhead.token-stats.v1";
export const ABILITIES = {
  str: "strength", dex: "dexterity", con: "constitution",
  int: "intelligence", wis: "wisdom", cha: "charisma",
};

const keys = Object.keys(ABILITIES);
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
    editable: data?.editable === true,
  };
}

export async function writeTokenStats(obr, tokenId, scores, { gm, editable, expected, current }) {
  if (!keys.every((key) => validAbilityScore(scores?.[key]))) {
    throw Error("Enter whole scores from 1 to 30.");
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
      editable: gm ? editable === true : previous.editable,
    };
    applied = true;
  });
  if (!applied) throw Error("The selected token is unavailable.");
}
