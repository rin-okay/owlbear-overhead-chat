import { isPublicToken } from "./rules.js?v=2.6.16";

const FORGE = "com.battle-system.forge/";
const APPLICATIONS = "chat.overhead.combat-applied.v1";

export function forgeHpKey(roomMetadata) {
  const bid = roomMetadata?.[FORGE + "hpcurrbid"];
  if (bid == null || bid === "") return FORGE + "Z005";
  if (typeof bid !== "string" || !/^[\w-]{1,32}$/.test(bid.trim())) return;
  return FORGE + bid.trim();
}

function currentValue(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.current : raw;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()) && Number.isFinite(Number(value))) return Number(value);
}

export function hasForgeHp(token, key) {
  return Boolean(key && Number.isFinite(currentValue(token?.metadata?.[key])));
}

export function appliedCombatDamage(token, entryId) {
  const amount = token?.metadata?.[APPLICATIONS]?.[entryId];
  if (Number.isSafeInteger(amount) && amount >= 0) return amount;
}

export async function applyForgeDamage(obr, tokenId, entryId, amount, current) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw Error("Enter a whole damage amount of 0 or more.");
  const [role, room, ready] = await Promise.all([
    obr.player.getRole(), obr.room.getMetadata(), obr.scene.isReady(),
  ]);
  if (role !== "GM") throw Error("Only the GM can apply damage.");
  if (!ready || !current()) throw Error("This combat entry belongs to another scene.");
  const hpKey = forgeHpKey(room);
  let applied;
  await obr.scene.items.updateItems([tokenId], ([token]) => {
    if (!current() || !isPublicToken(token)) throw Error("This target is unavailable.");
    const previous = appliedCombatDamage(token, entryId);
    if (previous !== undefined) {
      applied = previous;
      return;
    }
    if (!hasForgeHp(token, hpKey)) throw Error("Set current HP for this token in Forge! first.");
    const raw = token.metadata[hpKey];
    const hp = currentValue(raw) - amount;
    if (!Number.isFinite(hp) || Math.abs(hp) > Number.MAX_SAFE_INTEGER) throw Error("That damage amount is too large.");
    if (typeof raw === "object") {
      token.metadata[hpKey] = { ...raw, current: typeof raw.current === "string" ? String(hp) : hp };
    } else {
      token.metadata[hpKey] = typeof raw === "string" ? String(hp) : hp;
    }
    const previousApplications = Object.entries(token.metadata[APPLICATIONS] ?? {}).slice(-199);
    token.metadata[APPLICATIONS] = Object.fromEntries([...previousApplications, [entryId, amount]]);
    applied = amount;
  });
  if (applied === undefined) throw Error("This target is unavailable.");
  return applied;
}
