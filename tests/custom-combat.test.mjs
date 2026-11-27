import assert from "node:assert/strict";
import test from "node:test";
import { customSkill, parseDamageDice, rollAttackDamage } from "../combat-catalog.js?v=3.1.0";
import { combatDamage, damageNotation, formatCombatDamage } from "../combat-log.js?v=3.1.0";
import { attackDamageFormula, weaponDefinition } from "../melee-damage.js?v=3.1.0";
import { availableSkills, availableWeapons, configuredSkill } from "../skills.js?v=3.1.0";
import { TOKEN_STATS } from "../stats.js?v=3.1.0";

const actor = { metadata: { [TOKEN_STATS]: { scores: { str: 16, dex: 18 } } } };
const trip = { kind: "skill", name: "Trip Attack", uses: "weapon", dice: parseDamageDice("d8"),
  damageType: "slashing", saveAbility: "dex" };

test("Trip Attack combines like dice with the equipped weapon’s bonus and ability modifier", () => {
  const sword = { ...weaponDefinition({}, "weapon", "sword"), damageBonus: 1 };
  const formula = attackDamageFormula(sword, customSkill(trip), actor);
  assert.equal(damageNotation(formula), "2d8+4");
  const roll = rollAttackDamage(formula, () => .999);
  assert.equal(roll.amount, 20);
  assert.equal(roll.maxRoll, true);
  assert.equal(customSkill(trip).saveAbility, "dex");
});

test("mixed weapon and skill dice retain separate groups in the combat log", () => {
  const dagger = { ...weaponDefinition({}, "weapon", "dagger"), damageBonus: 2, modifier: "dex" };
  const formula = attackDamageFormula(dagger, customSkill(trip), actor);
  assert.equal(damageNotation(formula), "1d4+1d8+6");
  const roll = rollAttackDamage(formula, () => .999);
  assert.equal(formatCombatDamage(combatDamage([roll])), "1d4+1d8+6 = 4 + 8 + 6 = 18 piercing damage");
});

test("only a grant on the active token makes a custom skill or weapon available", () => {
  const id = "custom-00000000-0000-4000-8000-000000000001";
  const weapon = "custom-00000000-0000-4000-8000-000000000002";
  const config = {
    enabled: true, catalog: { [id]: trip, [weapon]: { ...weaponDefinition({}, "weapon", "dagger"), name: "Dagger +2" } },
    customSkillsByToken: { actor: [id] }, weaponsByToken: { actor: [weapon] },
  };
  assert.equal(configuredSkill(config, id).name, "Trip Attack");
  assert.ok(availableSkills(config, "actor").includes(id));
  assert.ok(!availableSkills(config, "other").includes(id));
  assert.ok(!availableSkills({ ...config, enabled: false }, "actor").includes(id));
  assert.ok(availableWeapons(config.weaponsByToken.actor, config).includes(weapon));
  assert.ok(!availableWeapons(undefined, config).includes(weapon));
});
