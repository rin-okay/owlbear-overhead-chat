import { readTokenStats } from "./stats.js?v=2.7.21";

export const MAGIC_MISSILE_INTERVAL = 200;
export const MAGIC_MISSILE_MAX_LEVEL = 9;
export const BLOCKED_MAGIC_MISSILE = { amount: 0, type: "force", maxRoll: false, blocked: true };

export function rollMagicMissileDart(random = Math.random) {
  const amount = 2 + Math.floor(random() * 4);
  return { amount, type: "force", maxRoll: amount === 5, dice: [amount - 1], sides: 4, modifier: 1 };
}

export function validMagicMissileDamage(damage) {
  if (damage?.blocked === true) {
    return damage.amount === 0 && damage.type === "force" && damage.maxRoll === false;
  }
  return validSpellDamage(damage) && damage.type === "force" && damage.amount >= 2 && damage.amount <= 5;
}

export function eldritchBeamCount(token) {
  const { level } = readTokenStats(token).details;
  return 1 + Number(level >= 5) + Number(level >= 11) + Number(level >= 17);
}

export function rollSpellDamage(skill, token, random = Math.random) {
  const eldritch = skill === "eldritch-blast";
  const count = eldritch ? eldritchBeamCount(token) : 3;
  const sides = eldritch ? 10 : 8;
  const dice = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const amount = dice.reduce((sum, value) => sum + value, 0);
  return { amount, type: eldritch ? "force" : "thunder", maxRoll: amount === count * sides, dice, sides };
}

export function validSpellDamage(damage) {
  const max = damage?.type === "force" ? 40 : damage?.type === "thunder" ? 24 : 0;
  return Number.isInteger(damage?.amount) && damage.amount >= 1 && damage.amount <= max &&
    typeof damage.maxRoll === "boolean";
}
