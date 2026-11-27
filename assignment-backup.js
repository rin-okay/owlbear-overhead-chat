import { CUSTOM_ID, DAMAGE_MODIFIERS, DAMAGE_TYPES, customSkill, isWeapon, validDice } from "./combat-catalog.js?v=3.1.0";
import {
  DEFAULT_WEAPON, FRIENDLY_FIRE_MODES, RANGED_WEAPONS, SPELLS, TEAMS, WEAPONS,
  availableCustomSkills, availableRangedWeapons, availableSpells, availableWeapons,
  friendlyFireMode, tokenTeams, validSpellParameter,
} from "./skills.js?v=3.1.0";
import { ABILITIES, COMBAT_STATS, readTokenStats, validAbilityScore } from "./stats.js?v=3.1.0";
import { weaponDefinition } from "./melee-damage.js?v=3.1.0";
import { validWeaponDelay } from "./weapon-timing.js?v=3.2.2";

export const CATALOG_BACKUP = "overhead-chat-catalog";
export const TOKEN_BACKUP = "overhead-chat-token";
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const sound = (value) => typeof value === "string" && (value === "" || /^(?:\$\.)?[\w-]{1,80}$/.test(value));
const requireValid = (valid, message) => { if (!valid) throw Error(message); };
const grantFields = ["weaponsByToken", "rangedWeaponsByToken", "spellsByToken", "customSkillsByToken", "teamsByToken"];

export function saveBackup(type, data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ type, version: 1, data }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function readBackup(file, type) {
  requireValid(file.size <= 2 * 1024 * 1024, "The backup file is larger than 2 MB.");
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { throw Error("Choose a valid JSON backup."); }
  requireValid(backup?.type === type && backup.version === 1 && record(backup.data),
    type === TOKEN_BACKUP ? "Choose an Overhead Chat token backup." : "Choose an Overhead Chat catalog backup.");
  return backup.data;
}

function checkCatalog(catalog) {
  requireValid(record(catalog) && Object.keys(catalog).length <= 1000, "The catalog contains invalid definitions.");
  for (const [id, definition] of Object.entries(catalog)) {
    const name = definition?.name;
    requireValid(typeof name === "string" && name.trim() && name.length <= 80, "A definition has an invalid name.");
    if (isWeapon(definition.kind)) {
      const stock = definition.kind === "weapon" ? WEAPONS : RANGED_WEAPONS;
      requireValid((CUSTOM_ID.test(id) || Object.hasOwn(stock, id)) &&
        Object.hasOwn(stock, definition.animation) && validDice(definition.dice) &&
        DAMAGE_TYPES.includes(definition.damageType) && Object.hasOwn(DAMAGE_MODIFIERS, definition.modifier) &&
        bounded(definition.damageBonus, -99, 99) && bounded(definition.hitBonus, -99, 99) &&
        ["sound", "swingSound", "hitSound"].every(key => definition[key] === undefined || sound(definition[key])) &&
        ["hitDelay", "soundDelay", "swingDelay", "hitSoundDelay"].every(key =>
          definition[key] === undefined || validWeaponDelay(definition[key])),
        "Invalid weapon definition: " + name);
    } else {
      requireValid(CUSTOM_ID.test(id) && customSkill(definition) &&
        (definition.dice == null || validDice(definition.dice)), "Invalid skill definition: " + name);
    }
  }
  return catalog;
}

export function catalogSnapshot(config) {
  return { catalog: config.catalog ?? {}, spellSounds: config.spellSounds ?? {},
    enabled: config.enabled === true, friendlyFire: friendlyFireMode(config) };
}

export function importCatalog(config, data) {
  const catalog = checkCatalog(data.catalog);
  requireValid(record(data.spellSounds) && typeof data.enabled === "boolean" && FRIENDLY_FIRE_MODES.includes(data.friendlyFire),
    "The file contains invalid spell or combat settings.");
  for (const [id, cue] of Object.entries(data.spellSounds)) {
    requireValid(SPELLS.includes(id) && record(cue) &&
      ["castSound", "hitSound", "loopSound"].every(key => sound(cue[key])) &&
      ["castDelay", "hitDelay"].every(key => bounded(cue[key], 0, 10000)), "Invalid spell sounds: " + id);
  }
  config.catalog = { ...config.catalog, ...catalog };
  config.spellSounds = { ...config.spellSounds, ...data.spellSounds };
  config.enabled = data.enabled;
  config.friendlyFire = data.friendlyFire;
}

function spellParameters(values, spells) {
  requireValid(record(values), "The spell options are invalid.");
  return Object.fromEntries(Object.entries(values).filter(([id]) => spells.includes(id)).map(([id, saved]) => {
    const fields = typeof saved === "number" ? { parameter: saved } : saved;
    requireValid(record(fields) && Object.entries(fields).every(([field, value]) =>
      ["parameter", "targetLimit"].includes(field) && validSpellParameter(id, value, field)), "Invalid spell options: " + id);
    return [id, fields];
  }));
}

export function tokenSnapshot(config, token) {
  const id = token.id;
  const grants = {
    weaponsByToken: availableWeapons(config.weaponsByToken?.[id], config),
    rangedWeaponsByToken: availableRangedWeapons(config.rangedWeaponsByToken?.[id], config),
    spellsByToken: availableSpells(config, id),
    customSkillsByToken: availableCustomSkills(config, id),
    teamsByToken: tokenTeams(config, id),
  };
  const { scores, details, editable } = readTokenStats(token);
  const catalog = Object.fromEntries([
    ...grants.weaponsByToken.map(id => [id, weaponDefinition(config, "weapon", id)]),
    ...grants.rangedWeaponsByToken.map(id => [id, weaponDefinition(config, "ranged-weapon", id)]),
    ...grants.customSkillsByToken.map(id => [id, config.catalog[id]]),
  ]);
  return { name: token.name || "Character", stats: { scores, details, editable }, grants, catalog,
    spellParameters: spellParameters(config.spellParametersByToken?.[id] ?? {}, grants.spellsByToken) };
}

export function importToken(config, tokenId, data) {
  const catalog = checkCatalog(data.catalog);
  const { stats, grants } = data;
  requireValid(record(stats?.scores) && record(stats?.details) && typeof stats.editable === "boolean" &&
    Object.keys(ABILITIES).every(key => validAbilityScore(stats.scores[key])) &&
    Object.entries(COMBAT_STATS).every(([key, { minimum, maximum }]) =>
      bounded(stats.details[key], minimum, maximum ?? Number.MAX_SAFE_INTEGER)), "This token backup has invalid stats.");
  requireValid(record(grants) && grantFields.every(key => Array.isArray(grants[key]) &&
    grants[key].length <= 1000 && grants[key].every(id => typeof id === "string")), "This token backup has invalid assignments.");

  const { weaponsByToken: weapons, rangedWeaponsByToken: ranged, spellsByToken: spells, customSkillsByToken: skills, teamsByToken: teams } = grants;
  requireValid(weapons.every(id => catalog[id]?.kind === "weapon" || Object.hasOwn(WEAPONS, id)) &&
    ranged.every(id => catalog[id]?.kind === "ranged-weapon" || Object.hasOwn(RANGED_WEAPONS, id)) &&
    skills.every(id => CUSTOM_ID.test(id) && customSkill(catalog[id])) && spells.every(id => SPELLS.includes(id) && id !== "sleep") &&
    teams.every(team => TEAMS.includes(team)), "This token backup references an unknown assignment.");

  const params = spellParameters(data.spellParameters, spells);
  const definitions = { ...config.catalog };
  const remap = new Map();
  const used = new Set([...weapons, ...ranged, ...skills]);
  const sameDefinition = (a, b) => a && Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(([key, value]) => JSON.stringify(value) === JSON.stringify(a[key]));
  for (const [id, definition] of Object.entries(catalog)) {
    if (!used.has(id)) continue;
    const previous = isWeapon(definition.kind) ? weaponDefinition({ catalog: definitions }, definition.kind, id) : definitions[id];
    // Keep existing stock overrides and custom definitions in use by other characters.
    if (sameDefinition(previous, definition)) continue;
    const equivalent = previous && Object.entries(definitions).find(([other, entry]) =>
      CUSTOM_ID.test(other) && sameDefinition(entry, definition))?.[0];
    const target = !previous ? id : equivalent ?? "custom-" + crypto.randomUUID();
    definitions[target] = definition;
    remap.set(id, target);
  }
  config.catalog = definitions;
  for (const key of grantFields) {
    const ids = [...new Set(grants[key].map(id => remap.get(id) ?? id))];
    config[key] = { ...config[key], [tokenId]: key === "weaponsByToken" ? ids.filter(id => id !== DEFAULT_WEAPON) : ids };
  }
  config.spellParametersByToken = { ...config.spellParametersByToken, [tokenId]: params };
  return {
    scores: Object.fromEntries(Object.keys(ABILITIES).map(key => [key, stats.scores[key]])),
    details: Object.fromEntries(Object.keys(COMBAT_STATS).map(key => [key, stats.details[key]])),
    editable: stats.editable,
  };
}
