export const SKILL_REQUEST = "chat.overhead.skills/request.v1";
export const SKILL_RESULT = "chat.overhead.skills/result.v1";
export const SKILL_CHANGED = "chat.overhead.skills/changed.v1";
export const EMBERS_EFFECTS = "eu.armindo.embers/effects";

export const SKILLS = {
  spear: { name: "spear attack", key: "f", effect: "generic.weapon_attacks.melee.single.spear" },
  missile: { name: "magic missile", key: "g", effect: "magic_missile", range: 8 },
};
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
  return Array.isArray(config.missileTokens) && config.missileTokens.includes(tokenId)
    ? ["spear", "missile"] : ["spear"];
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

export function skillEffect(skillId, token, center, dpi, facing) {
  if (!Object.hasOwn(SKILLS, skillId) || !FACINGS.some(([angle]) => angle === facing) ||
      ![center?.x, center?.y, token.rotation, dpi].every(Number.isFinite) || dpi <= 0) return;
  const skill = SKILLS[skillId];
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
    effectProperties.size = 2;
  }
  return { type: "effect", id: skill.effect, layer: "ATTACHMENT", effectProperties };
}
