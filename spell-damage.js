import { readTokenStats } from "./stats.js?v=2.7.21";

export const MAGIC_MISSILE_INTERVAL = 200;
export const MAGIC_MISSILE_MAX_LEVEL = 9;

export function rollMagicMissileDart(random = Math.random) {
  const amount = 2 + Math.floor(random() * 4);
  return { amount, type: "force", maxRoll: amount === 5 };
}

export function validMagicMissileDamage(damage) {
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
  let amount = 0;
  for (let i = 0; i < count; i++) amount += 1 + Math.floor(random() * sides);
  return { amount, type: eldritch ? "force" : "thunder", maxRoll: amount === count * sides };
}

export function validSpellDamage(damage) {
  const max = damage?.type === "force" ? 40 : damage?.type === "thunder" ? 24 : 0;
  return Number.isInteger(damage?.amount) && damage.amount >= 1 && damage.amount <= max &&
    typeof damage.maxRoll === "boolean";
}
