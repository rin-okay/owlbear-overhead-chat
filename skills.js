import { CUSTOM_ID, customSkill } from "./combat-catalog.js?v=3.1.0";

export const SKILL_REQUEST = "chat.overhead.skills/request.v1";
export const SKILL_RESULT = "chat.overhead.skills/result.v1";
export const SKILL_CHANGED = "chat.overhead.skills/changed.v1";
export const EMBERS_EFFECTS = "eu.armindo.embers/effects";
export const MAX_CAST_LEVEL = 9;
export const DEFAULT_WEAPON = "generic_slash";
export const TEAMS = ["red", "blue", "green", "mob 1", "mob 2", "mob 3"];
export const FRIENDLY_FIRE_MODES = ["enabled", "disabled", "aoe"];

// These IDs match Embers' Melee Weapon Attack variants.
export const WEAPONS = {
  generic_slash: "generic slash",
  club: "club", dagger: "dagger", falchion: "falchion", generic_whirlwind: "generic whirlwind",
  glaive: "glaive", great_axe: "greataxe", great_club: "greatclub", great_sword: "greatsword",
  halberd: "halberd", hammer: "hammer", hand_axe: "handaxe", laser_sword: "laser sword",
  mace: "mace", maul: "maul", quarterstaff: "quarterstaff", rapier: "rapier",
  scimitar: "scimitar", shortsword: "shortsword", spear: "spear", sword: "sword",
  warhammer: "warhammer", wrench: "wrench",
};

// Keep these variants in the same order as Embers' Ranged Weapon Attack grant choices.
export const RANGED_WEAPONS = {
  "arrow.green": "green arrow",
  "arrow.white": "white arrow",
  "arrow.blue": "blue arrow",
  "bolt": "bolt",
  "boulder_toss": "boulder",
  "bullet.orange": "orange bullet",
  "bullet.large_orange": "large orange bullet",
  "bullet.blue": "blue bullet",
  "dagger.throw": "dagger",
  "laser_shot.blue": "blue laser",
  "laser_shot.green": "green laser",
  "laser_shot.orange": "orange laser",
  "laser_shot.red": "red laser",
  "laser_sword.blue": "blue laser sword",
  "laser_sword.red": "red laser sword",
  "cannon_ball": "cannon ball",
  "barrel_toss.metal": "metal barrel",
  "barrel_toss.wooden": "wooden barrel",
  "missile.blue": "blue missile",
  "missile.white": "white missile",
  "missile.wide_white": "wide white missile",
  "missile.purple_pink": "purple/pink missile",
  "shield.throw": "shield",
  "shield.complete": "shield (returning)",
  "snipe": "snipe",
  "snowball": "snowball",
  "throw.bomb": "thrown bomb",
  "throw.flask": "thrown flask",
};

// Embers effect_record.json, generic.weapon_attacks.melee.single.
// Melee uses the first clip of each weapon at the 600px resolution.
export const MELEE_DURATION_MS = {
  club: 2200,
  dagger: 1600,
  falchion: 2200,
  generic_slash: 900,
  generic_whirlwind: 900,
  glaive: 2200,
  great_axe: 2400,
  great_club: 2400,
  great_sword: 2400,
  halberd: 2200,
  hammer: 2200,
  hand_axe: 1870,
  laser_sword: 2330,
  mace: 2200,
  maul: 2830,
  quarterstaff: 2200,
  rapier: 2200,
  scimitar: 2200,
  shortsword: 2200,
  spear: 2200,
  sword: 2200,
  warhammer: 2200,
  wrench: 2200,
};

export const SKILLS = {
  bless: {
    name: "bless", key: "b", spellLevel: 1, upcast: true,
    parameter: { label: "range (in cells)", min: 1, defaultValue: 6 },
    targetLimit: { label: "maximum targets", min: 1, defaultValue: 3, integer: true },
  },
  shield: { name: "shield", key: "l", spellLevel: 1 },
  sleep: { name: "sleep (afk)", key: "", spellLevel: 0 },
  heart: { name: "heart", key: "p", effect: "generic.marker.heart.3" },
  "heart-shot": {
    name: "heart shot", key: "", spellLevel: 1, maxCastLevel: 3, upcast: true, heartMarker: true,
    effect: "generic.ui.icon.heart", range: 8,
  },
  "heart-fireball": {
    name: "heart fireball", key: "", spellLevel: 3, heartMarker: true,
    effect: "generic.ui.icon.heart", range: 30,
    impact: { effect: "generic.template.circle.heart", visibleRadiusFraction: 0.5 },
    parameter: { label: "radius (in cells)", min: 1, defaultValue: 4 },
  },
  // Keep the original skill ID so existing bindings and clients still work.
  spear: { name: "melee weapon attack", key: "f", meleeReach: 1 },
  ranged: { name: "ranged weapon attack", key: "n", range: 30, hitDelay: 800 },
  missile: { name: "magic missile", key: "g", spellLevel: 1, upcast: true, effect: "magic_missile", range: 8, hitDelay: 1000 },
  "burning-hands": {
    name: "burning hands", key: "h", spellLevel: 1, upcast: true, damage: { dice: 3, sides: 6, type: "fire" }, saveAbility: "dex", effect: "burning_hands", cone: true, hitDelay: 1000,
    parameter: { label: "length (in cells)", min: 1, defaultValue: 3 },
  },
  "fire-bolt": {
    name: "fire bolt", key: "j", spellLevel: 0, damage: { dice: 1, sides: 10, type: "fire" },
    effect: "fire_bolt", range: 24, hitDelay: 800,
  },
  "eldritch-blast": {
    name: "eldritch blast", key: "u", spellLevel: 0, damage: { dice: 1, sides: 10, type: "force" },
    effect: "eldritch_blast", range: 24, hitDelay: 1000,
  },
  "misty-step": {
    name: "misty step", key: "i", spellLevel: 2, effect: "misty_step.out", location: "teleport", range: 6,
  },
  shatter: {
    name: "shatter", key: "o", spellLevel: 2, upcast: true, damage: { dice: 3, sides: 8, type: "thunder" },
    saveAbility: "con", effect: "shatter", location: "area", range: 12, hitDelay: 650,
    parameter: { label: "radius (in cells)", min: 1, defaultValue: 2 },
  },
  fireball: {
    name: "fireball", key: "k", spellLevel: 3, upcast: true, damage: { dice: 8, sides: 6, type: "fire" }, saveAbility: "dex", effect: "fireball.beam", range: 30,
    // The visible blast has a radius of roughly 320 px in the 800 px Embers frame.
    impact: { effect: "fireball.explosion", delay: 3000, visibleRadiusFraction: 0.4 },
    parameter: { label: "radius (in cells)", min: 1, defaultValue: 4 },
  },
};
export const SPELLS = Object.keys(SKILLS).filter((id) => id !== "spear" && id !== "ranged");
export function configuredSkill(config, id) {
  if (CUSTOM_ID.test(id)) return customSkill(config.catalog?.[id]);
  return Object.hasOwn(SKILLS, id) ? SKILLS[id] : undefined;
}

export const skillCacheKey = (obr) => storageKey(obr, "known-custom-skills");
let clientCacheRoom;
let clientCacheRaw;
let clientSkillGeneration = 0;
const clientSkillIds = new Set();

export function syncClientSkills(obr) {
  const key = skillCacheKey(obr);
  let raw;
  try { raw = localStorage.getItem(key); } catch {}
  if (key === clientCacheRoom && raw === clientCacheRaw) return clientSkillGeneration;
  clientCacheRoom = key;
  clientCacheRaw = raw;
  for (const id of clientSkillIds) delete SKILLS[id];
  clientSkillIds.clear();
  for (const [id, definition] of Object.entries(readSkills(obr, "known-custom-skills"))) {
    const skill = CUSTOM_ID.test(id) && customSkill(definition);
    if (!skill) continue;
    SKILLS[id] = skill;
    clientSkillIds.add(id);
  }
  return ++clientSkillGeneration;
}

export function rememberCustomSkills(obr, definitions) {
  syncClientSkills(obr);
  let changed = false;
  const known = readSkills(obr, "known-custom-skills");
  for (const [id, definition] of Object.entries(definitions ?? {})) {
    const skill = CUSTOM_ID.test(id) && customSkill(definition);
    if (!skill || JSON.stringify(known[id]) === JSON.stringify(definition)) continue;
    known[id] = definition;
    SKILLS[id] = skill;
    clientSkillIds.add(id);
    changed = true;
  }
  if (!changed) return;
  clientSkillGeneration++;
  try {
    writeSkills(obr, "known-custom-skills", known);
    clientCacheRaw = localStorage.getItem(skillCacheKey(obr));
  } catch { /* The current loadout still works when local storage is unavailable. */ }
}

export const FACINGS = [
  [0, "right"], [45, "down-right"], [90, "down"], [135, "down-left"],
  [180, "left"], [225, "up-left"], [270, "up"], [315, "up-right"],
];

function storageKey(obr, type) {
  return JSON.stringify(["chat.overhead.skills.v1", obr.room.id, obr.player.id, type]);
}

export function readSkills(obr, type) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(obr, type))) ?? {};
  } catch {
    return {};
  }
}

export function writeSkills(obr, type, settings) {
  localStorage.setItem(storageKey(obr, type), JSON.stringify(settings));
}

export function availableSkills(config, tokenId) {
  if (config.enabled !== true) return ["sleep"];
  const ranged = availableRangedWeapons(config.rangedWeaponsByToken?.[tokenId], config);
  return ["spear", "sleep", ...(ranged.length ? ["ranged"] : []), ...availableSpells(config, tokenId), ...availableCustomSkills(config, tokenId)];
}

export function availableSpells(config, tokenId) {
  const spells = config.spellsByToken?.[tokenId];
  if (Array.isArray(spells)) return SPELLS.filter((id) => id !== "sleep" && spells.includes(id));
  return Array.isArray(config.missileTokens) && config.missileTokens.includes(tokenId) ? ["missile"] : [];
}

export function tokenTeams(config, tokenId) {
  const assigned = config.teamsByToken?.[tokenId];
  return Array.isArray(assigned) ? TEAMS.filter((team) => assigned.includes(team)) : [];
}

export function friendlyFireMode(config) {
  return FRIENDLY_FIRE_MODES.includes(config.friendlyFire) ? config.friendlyFire : "enabled";
}

export function validSpellParameter(skillId, value, field = "parameter") {
  const skill = SKILLS[skillId];
  const parameter = skill?.[field];
  const radiusFraction = skill?.impact?.visibleRadiusFraction ?? 0.5;
  return Boolean(parameter && Number.isFinite(value) && value >= parameter.min &&
    Number.isFinite(value / radiusFraction) && (!parameter.integer || Number.isSafeInteger(value)));
}

export function spellParameter(config, tokenId, skillId, field = "parameter") {
  const saved = config.spellParametersByToken?.[tokenId]?.[skillId];
  const value = typeof saved === "number" && field === "parameter" ? saved : saved?.[field];
  return validSpellParameter(skillId, value, field) ? value : SKILLS[skillId]?.[field]?.defaultValue;
}

export function availableCustomSkills(config, tokenId) {
  const ids = config.customSkillsByToken?.[tokenId];
  return Array.isArray(ids) ? ids.filter((id) => CUSTOM_ID.test(id) && configuredSkill(config, id)) : [];
}

export function weaponNames(config, kind) {
  const stock = kind === "weapon" ? WEAPONS : RANGED_WEAPONS;
  const names = { ...stock };
  for (const [id, definition] of Object.entries(config.catalog ?? {})) {
    if (definition?.kind === kind && typeof definition.name === "string" &&
        (CUSTOM_ID.test(id) || Object.hasOwn(stock, id))) names[id] = definition.name;
  }
  return names;
}

export function availableWeapons(grants, config = {}) {
  return Object.keys(weaponNames(config, "weapon")).filter((id) => id === DEFAULT_WEAPON || (Array.isArray(grants) && grants.includes(id)));
}

export function availableRangedWeapons(grants, config = {}) {
  return Array.isArray(grants) ? Object.keys(weaponNames(config, "ranged-weapon")).filter((id) => grants.includes(id)) : [];
}

export function skillGrantLabel(kind, variant, label) {
  if (typeof variant !== "string") return;
  if (typeof label === "string" && label.trim() && ["weapon", "ranged-weapon", "skill", "ability"].includes(kind)) {
    return ({ weapon: "melee attack", "ranged-weapon": "ranged attack", skill: "skill", ability: "special ability" })[kind] +
      ": " + label.slice(0, 80);
  }
  if (kind === "ranged-weapon" && Object.hasOwn(RANGED_WEAPONS, variant)) {
    return "ranged attack: " + RANGED_WEAPONS[variant];
  }
  if (kind === "weapon" && variant !== DEFAULT_WEAPON && Object.hasOwn(WEAPONS, variant)) {
    return "melee attack: " + WEAPONS[variant];
  }
  if (kind === "spell" && SPELLS.includes(variant)) return "spell: " + SKILLS[variant].name;
}

export async function skillConnections(obr) {
  const [connectionId, role, party] = await Promise.all([
    obr.player.getConnectionId(), obr.player.getRole(), obr.party.getPlayers(),
  ]);
  const self = { id: obr.player.id, role, connectionId };
  const players = [self, ...party.filter((player) => player.connectionId !== connectionId)];
  // All clients select the same GM so a cast only plays once.
  const gm = players.filter((p) => p.role === "GM").sort((a, b) =>
    a.id.localeCompare(b.id) || a.connectionId.localeCompare(b.connectionId))[0];
  return { self, players, gm };
}

export function artworkFacingAngle(token, facing) {
  const base = facing * Math.PI / 180;
  const x = Math.cos(base) * (token.scale?.x < 0 ? -1 : 1);
  const y = Math.sin(base) * (token.scale?.y < 0 ? -1 : 1);
  return Math.atan2(y, x) * 180 / Math.PI;
}

export function aimsAtLocation(skillId) {
  const skill = Object.hasOwn(SKILLS, skillId) ? SKILLS[skillId] : undefined;
  return Boolean(skill?.range || skill?.meleeReach || skill?.cone);
}

export function turnToHeading(token, facing, heading) {
  const horizontal = (angle) => {
    const x = Math.cos(angle * Math.PI / 180);
    return Math.abs(x) < 1e-7 ? 0 : Math.sign(x);
  };
  const current = token.rotation + artworkFacingAngle(token, facing);
  if (horizontal(current) * horizontal(heading) === -1) token.scale.x = -token.scale.x;
  const angle = heading - artworkFacingAngle(token, facing);
  token.rotation = ((angle % 360) + 360) % 360;
}

export function skillEffect(skillId, token, center, dpi, facing, weapon = DEFAULT_WEAPON,
  parameter = SKILLS[skillId]?.parameter?.defaultValue, skill = SKILLS[skillId]) {
  if (!skill || !FACINGS.some(([angle]) => angle === facing) ||
      ![center?.x, center?.y, token.rotation, dpi].every(Number.isFinite) || dpi <= 0) return;
  let effect = skill.effect;
  if (skill.meleeReach && Object.hasOwn(WEAPONS, weapon)) effect = "generic.weapon_attacks.melee.single." + weapon;
  if ((skillId === "ranged" || skill.uses === "ranged-weapon") && Object.hasOwn(RANGED_WEAPONS, weapon)) effect = "generic.weapon_attacks.ranged." + weapon;
  if (!effect && !skill.custom) return;
  if (skillId === "heart") {
    // The heart travels vertically around the center of the clip over one loop.
    return {
      type: "effect", id: effect, layer: "ATTACHMENT", loops: 1,
      effectProperties: { source: { x: center.x, y: center.y }, size: 2, disableHit: true, attachedTo: token.id },
    };
  }
  const rotation = token.rotation + artworkFacingAngle(token, facing);
  const radians = rotation * Math.PI / 180;
  const source = { x: center.x, y: center.y };
  const effectProperties = { source, disableHit: true };
  if (skill.location) {
    effectProperties.size = skill.location === "area" ? parameter * 2 : 2;
  } else if (skill.range) {
    effectProperties.destination = {
      x: source.x + dpi * skill.range * Math.cos(radians),
      y: source.y + dpi * skill.range * Math.sin(radians),
    };
    effectProperties.copies = 1;
  } else {
    effectProperties.rotation = rotation;
    effectProperties.size = skill.cone ? parameter : 2;
  }
  return { type: "effect", id: effect, layer: "ATTACHMENT", effectProperties };
}
