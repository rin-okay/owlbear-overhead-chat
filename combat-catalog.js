import { ABILITIES } from "./stats.js?v=3.1.0";

export const CUSTOM_ID = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DAMAGE_TYPES = [
  "bludgeoning", "piercing", "slashing", "acid", "cold", "fire", "force", "lightning",
  "necrotic", "poison", "psychic", "radiant", "thunder",
];
export const DAMAGE_MODIFIERS = { str: "Strength", dex: "Dexterity", finesse: "Higher of STR or DEX", none: "None" };
export const isWeapon = (kind) => kind === "weapon" || kind === "ranged-weapon";
export const isAbility = (kind) => kind === "skill" || kind === "ability";

export function parseDamageDice(text, optional = false) {
  if (!text.trim() && optional) return null;
  const match = /^(\d{0,2})d(\d{1,2})$/i.exec(text.trim());
  const count = match && Number(match[1] || 1);
  const sides = match && Number(match[2]);
  if (!match || count < 1 || count > 20 || sides < 2 || sides > 99) {
    throw Error("Enter damage dice like 1d8 (up to 20 dice with 2–99 sides).");
  }
  return { count, sides };
}

export function validDice(dice) {
  return Number.isInteger(dice?.count) && dice.count >= 1 && dice.count <= 20 &&
    Number.isInteger(dice.sides) && dice.sides >= 2 && dice.sides <= 99;
}

export function customSkill(definition) {
  if (!isAbility(definition?.kind) || typeof definition.name !== "string" || !definition.name.trim() ||
      definition.name.length > 80 || !["weapon", "ranged-weapon", "none"].includes(definition.uses) ||
      (definition.dice && !validDice(definition.dice)) ||
      (definition.saveAbility && !Object.hasOwn(ABILITIES, definition.saveAbility)) ||
      !DAMAGE_TYPES.includes(definition.damageType)) return;
  if (definition.uses === "none" &&
      (!Number.isInteger(definition.range) || definition.range < 1 || definition.range > 120 ||
       (!definition.dice && !definition.saveAbility && definition.kind !== "ability"))) return;
  const { name, uses, dice, saveAbility, damageType } = definition;
  return {
    name, uses, dice, saveAbility, damageType, custom: true, key: "",
    ...(uses === "weapon" ? { meleeReach: 1 } : { range: uses === "ranged-weapon" ? 30 : definition.range, hitDelay: 800 }),
  };
}

export function diceGroups({ count, sides, groups }) {
  return groups ?? [{ count, sides }];
}

export function combineDamage(base, dice) {
  if (!dice) return base;
  const { count, sides, ...formula } = base;
  if (dice.sides === sides) return { ...formula, count: count + dice.count, sides };
  return { ...formula, groups: [{ count, sides }, dice] };
}

export function rollAttackDamage(formula, random = Math.random) {
  const groups = diceGroups(formula);
  const dice = groups.flatMap(({ count, sides }) =>
    Array.from({ length: count }, () => 1 + Math.floor(random() * sides)));
  const sum = dice.reduce((total, value) => total + value, 0);
  const modifier = formula.modifier ?? 0;
  return {
    amount: Math.max(0, sum + modifier), type: formula.type,
    maxRoll: sum === groups.reduce((total, { count, sides }) => total + count * sides, 0),
    dice, modifier, ...(formula.groups ? { groups } : { sides: formula.sides }),
  };
}
