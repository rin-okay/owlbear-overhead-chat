export const SKILL_REQUEST = "chat.overhead.skills/request.v1";
export const SKILL_RESULT = "chat.overhead.skills/result.v1";
export const SKILL_CHANGED = "chat.overhead.skills/changed.v1";
export const EMBERS_EFFECTS = "eu.armindo.embers/effects";
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
    name: "bless", key: "b",
    parameter: { label: "range (in cells)", min: 1, defaultValue: 6 },
    targetLimit: { label: "maximum targets", min: 1, defaultValue: 3, integer: true },
  },
  heart: { name: "heart", key: "p", effect: "generic.marker.heart.3" },
  // Keep the original skill ID so existing bindings and clients still work.
  spear: { name: "melee weapon attack", key: "f", meleeReach: 1 },
  missile: { name: "magic missile", key: "g", effect: "magic_missile", range: 8, hitDelay: 1000 },
  "burning-hands": {
    name: "burning hands", key: "h", effect: "burning_hands", cone: true, hitDelay: 1000,
    parameter: { label: "length (in cells)", min: 1, defaultValue: 3 },
  },
  "fire-bolt": { name: "fire bolt", key: "j", effect: "fire_bolt", range: 24, hitDelay: 800 },
  fireball: {
    name: "fireball", key: "k", effect: "fireball.beam", range: 30,
    impact: { effect: "fireball.explosion", delay: 3000 },
    parameter: { label: "radius (in cells)", min: 1, defaultValue: 4 },
  },
};
export const SPELLS = Object.keys(SKILLS).filter((id) => id !== "spear");
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
  if (config.enabled !== true) return [];
  return ["spear", ...availableSpells(config, tokenId)];
}

export function availableSpells(config, tokenId) {
  const spells = config.spellsByToken?.[tokenId];
  if (Array.isArray(spells)) return SPELLS.filter((id) => spells.includes(id));
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
  const parameter = SKILLS[skillId]?.[field];
  return Boolean(parameter && Number.isFinite(value) && value >= parameter.min &&
    Number.isFinite(value * 2) && (!parameter.integer || Number.isSafeInteger(value)));
}

export function spellParameter(config, tokenId, skillId, field = "parameter") {
  const saved = config.spellParametersByToken?.[tokenId]?.[skillId];
  const value = typeof saved === "number" && field === "parameter" ? saved : saved?.[field];
  return validSpellParameter(skillId, value, field) ? value : SKILLS[skillId]?.[field]?.defaultValue;
}

export function availableWeapons(grants) {
  return Object.keys(WEAPONS).filter((id) => id === DEFAULT_WEAPON || (Array.isArray(grants) && grants.includes(id)));
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
  parameter = SKILLS[skillId]?.parameter?.defaultValue) {
  if (!Object.hasOwn(SKILLS, skillId) || !FACINGS.some(([angle]) => angle === facing) ||
      ![center?.x, center?.y, token.rotation, dpi].every(Number.isFinite) || dpi <= 0) return;
  const skill = SKILLS[skillId];
  const effect = skill.effect ?? (Object.hasOwn(WEAPONS, weapon) && "generic.weapon_attacks.melee.single." + weapon);
  if (!effect) return;
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
  if (skill.range) {
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
