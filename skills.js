export const SKILL_REQUEST = "chat.overhead.skills/request.v1";
export const SKILL_RESULT = "chat.overhead.skills/result.v1";
export const SKILL_CHANGED = "chat.overhead.skills/changed.v1";
export const EMBERS_EFFECTS = "eu.armindo.embers/effects";
export const DEFAULT_WEAPON = "generic_slash";

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

export const SKILLS = {
  // Keep the original skill ID so existing bindings and clients still work.
  spear: { name: "melee weapon attack", key: "f" },
  missile: { name: "magic missile", key: "g", effect: "magic_missile", range: 8, hitDelay: 1000 },
  "burning-hands": { name: "burning hands", key: "h", effect: "burning_hands", cone: 3 },
  "fire-bolt": { name: "fire bolt", key: "j", effect: "fire_bolt", range: 24, hitDelay: 800 },
  fireball: {
    name: "fireball", key: "k", effect: "fireball.beam", range: 30,
    impact: { effect: "fireball.explosion", size: 8, delay: 3000 },
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

export function skillEffect(skillId, token, center, dpi, facing, weapon = DEFAULT_WEAPON) {
  if (!Object.hasOwn(SKILLS, skillId) || !FACINGS.some(([angle]) => angle === facing) ||
      ![center?.x, center?.y, token.rotation, dpi].every(Number.isFinite) || dpi <= 0) return;
  const skill = SKILLS[skillId];
  const effect = skill.effect ?? (Object.hasOwn(WEAPONS, weapon) && "generic.weapon_attacks.melee.single." + weapon);
  if (!effect) return;
  const base = facing * Math.PI / 180;
  const x = Math.cos(base) * (token.scale?.x < 0 ? -1 : 1);
  const y = Math.sin(base) * (token.scale?.y < 0 ? -1 : 1);
  const rotation = token.rotation + Math.atan2(y, x) * 180 / Math.PI;
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
    effectProperties.size = skill.cone ?? 2;
  }
  return { type: "effect", id: effect, layer: "ATTACHMENT", effectProperties };
}
