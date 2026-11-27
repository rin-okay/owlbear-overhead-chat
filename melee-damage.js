import { DAMAGE_TYPES, combineDamage, rollAttackDamage } from "./combat-catalog.js?v=3.1.0";
import { RANGED_WEAPONS, WEAPONS } from "./skills.js?v=3.1.0";
import { readTokenStats } from "./stats.js?v=3.1.0";

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
export function weaponDefinition(config, kind, id) {
  const stock = kind === "weapon" ? WEAPONS : RANGED_WEAPONS;
  const edited = config.catalog?.[id];
  if (edited?.kind === kind) return edited;
  if (!Object.hasOwn(stock, id)) return;
  const damage = kind === "weapon" ? MELEE_WEAPON_DAMAGE[id] : { count: 1, sides: 8, type: piercing };
  return {
    kind, name: stock[id], animation: id, dice: { count: damage.count, sides: damage.sides },
    damageType: damage.type, damageBonus: 0, hitBonus: 0,
    modifier: kind === "ranged-weapon" ? "dex" : damage.finesse ? "finesse" : "str",
    sound: "",
  };
}

export function attackDamageFormula(weapon, skill, token) {
  if (!weapon) return skill.dice ? { ...skill.dice, type: skill.damageType, modifier: 0 } : undefined;
  const { str, dex } = readTokenStats(token).modifiers;
  const stat = { str, dex, finesse: Math.max(str, dex), none: 0 }[weapon.modifier];
  const formula = { ...weapon.dice, type: weapon.damageType, modifier: stat + weapon.damageBonus };
  return combineDamage(formula, skill.dice);
}

export function meleeDamageFormula(weapon, token) {
  const { count, sides, type, finesse } = MELEE_WEAPON_DAMAGE[weapon];
  const { str, dex } = readTokenStats(token).modifiers;
  const modifier = finesse ? Math.max(str, dex) : str;
  return { count, sides, type, modifier };
}

export function rangedDamageFormula(token) {
  return { count: 1, sides: 8, type: piercing, modifier: readTokenStats(token).modifiers.dex };
}

export function rollMeleeDamage(weapon, token, random = Math.random) {
  return rollAttackDamage(meleeDamageFormula(weapon, token), random);
}

export function rollRangedDamage(token, random = Math.random) {
  return rollAttackDamage(rangedDamageFormula(token), random);
}

export function validMeleeDamage(damage) {
  return Number.isSafeInteger(damage?.amount) && damage.amount >= 0 &&
    damage.amount <= 5000 && DAMAGE_TYPES.includes(damage.type) && typeof damage.maxRoll === "boolean";
}
