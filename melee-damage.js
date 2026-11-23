import { readTokenStats } from "./stats.js?v=2.7.18";

const bludgeoning = "bludgeoning";
const piercing = "piercing";
const slashing = "slashing";
const radiant = "radiant";
const improvisedSlash = { count: 1, sides: 4, type: slashing };
const improvisedBlunt = { count: 1, sides: 4, type: bludgeoning };
const longsword = { count: 1, sides: 8, type: slashing };

// Versatile weapons use their one-handed dice. Embers-only skins use the closest profile.
export const MELEE_WEAPON_DAMAGE = {
  generic_slash: improvisedSlash,
  club: { count: 1, sides: 4, type: bludgeoning },
  dagger: { count: 1, sides: 4, type: piercing, finesse: true },
  falchion: longsword,
  generic_whirlwind: improvisedSlash,
  glaive: { count: 1, sides: 10, type: slashing },
  great_axe: { count: 1, sides: 12, type: slashing },
  great_club: { count: 1, sides: 8, type: bludgeoning },
  great_sword: { count: 2, sides: 6, type: slashing },
  halberd: { count: 1, sides: 10, type: slashing },
  hammer: { count: 1, sides: 4, type: bludgeoning },
  hand_axe: { count: 1, sides: 6, type: slashing },
  laser_sword: { ...longsword, type: radiant, finesse: true },
  mace: { count: 1, sides: 6, type: bludgeoning },
  maul: { count: 2, sides: 6, type: bludgeoning },
  quarterstaff: { count: 1, sides: 6, type: bludgeoning },
  rapier: { count: 1, sides: 8, type: piercing, finesse: true },
  scimitar: { count: 1, sides: 6, type: slashing, finesse: true },
  shortsword: { count: 1, sides: 6, type: piercing, finesse: true },
  spear: { count: 1, sides: 6, type: piercing },
  sword: longsword,
  warhammer: { count: 1, sides: 8, type: bludgeoning },
  wrench: improvisedBlunt,
};
const types = new Set(Object.values(MELEE_WEAPON_DAMAGE).map(({ type }) => type));

export function rollMeleeDamage(weapon, token, random = Math.random) {
  const { count, sides, type, finesse } = MELEE_WEAPON_DAMAGE[weapon];
  const { str, dex } = readTokenStats(token).modifiers;
  const modifier = finesse ? Math.max(str, dex) : str;
  const dice = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const sum = dice.reduce((total, value) => total + value, 0);
  return { amount: Math.max(0, sum + modifier), type, maxRoll: sum === count * sides, dice, sides, modifier };
}

export function validMeleeDamage(damage) {
  return Number.isSafeInteger(damage?.amount) && damage.amount >= 0 &&
    types.has(damage.type) && typeof damage.maxRoll === "boolean";
}
