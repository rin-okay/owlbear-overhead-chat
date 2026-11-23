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

function damageReceipt(token, entryId) {
  const stored = token?.metadata?.[APPLICATIONS]?.[entryId];
  const amount = typeof stored === "number" ? stored : stored?.amount;
  if (!Number.isSafeInteger(amount) || amount < 0) return;
  const key = stored?.hpKey;
  const hpKey = typeof key === "string" && key.startsWith(FORGE) && /^[\w-]{1,32}$/.test(key.slice(FORGE.length))
    ? key : undefined;
  return { amount, hpKey };
}

export function appliedCombatDamage(token, entryId) {
  return damageReceipt(token, entryId)?.amount;
}

export function applyForgeDamage(obr, tokenId, entryId, amount, current) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw Error("Enter a whole damage amount of 0 or more.");
  return changeDamage(obr, tokenId, entryId, current, amount);
}

export function undoForgeDamage(obr, tokenId, entryId, current) {
  return changeDamage(obr, tokenId, entryId, current);
}

async function changeDamage(obr, tokenId, entryId, current, amount) {
  const undo = amount === undefined;
  const [role, room, ready] = await Promise.all([
    obr.player.getRole(), obr.room.getMetadata(), obr.scene.isReady(),
  ]);
  if (role !== "GM") throw Error("Only the GM can change damage.");
  if (!ready || !current()) throw Error("This combat entry belongs to another scene.");
  let found = false;
  let applied;
  await obr.scene.items.updateItems([tokenId], ([token]) => {
    if (!current() || !isPublicToken(token)) throw Error("This target is unavailable.");
    found = true;
    const receipt = damageReceipt(token, entryId);
    if (undo && !receipt) return;
    if (!undo && receipt) {
      applied = receipt.amount;
      return;
    }
    const hpKey = receipt?.hpKey ?? forgeHpKey(room);
    if (!hasForgeHp(token, hpKey)) throw Error("Set current HP for this token in Forge! first.");
    const raw = token.metadata[hpKey];
    const delta = undo ? receipt.amount : -amount;
    const hp = currentValue(raw) + delta;
    if (!Number.isFinite(hp) || Math.abs(hp) > Number.MAX_SAFE_INTEGER) throw Error("That damage amount is too large.");
    if (typeof raw === "object") {
      token.metadata[hpKey] = { ...raw, current: typeof raw.current === "string" ? String(hp) : hp };
    } else {
      token.metadata[hpKey] = typeof raw === "string" ? String(hp) : hp;
    }

    const receipts = { ...token.metadata[APPLICATIONS] };
    if (undo) {
      delete receipts[entryId];
      token.metadata[APPLICATIONS] = receipts;
    } else {
      const recent = Object.entries(receipts).slice(-199);
      token.metadata[APPLICATIONS] = Object.fromEntries([...recent, [entryId, { amount, hpKey }]]);
      applied = amount;
    }
  });
  if (!found) throw Error("This target is unavailable.");
  return applied;
}
