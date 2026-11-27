import { CUSTOM_ID, diceGroups } from "./combat-catalog.js?v=3.1.0";
import { SKILLS, skillConnections } from "./skills.js?v=3.1.0";

export const COMBAT_POPOVER = "chat.overhead.combat-log.v1";
const COMBAT_EVENT = "chat.overhead.combat-event.v1";
const LOG_LIMIT = 100;
const ROLL_TIMEOUT = 70_000;
const combatId = (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const name = (value) => String(value || "unnamed token").slice(0, 80);

export async function openCombatChannel(obr) {
  const connectionId = await obr.player.getConnectionId();
  return new BroadcastChannel(JSON.stringify([COMBAT_POPOVER, obr.room.id, connectionId]));
}

function combatPopoverKey(obr) {
  return JSON.stringify([COMBAT_POPOVER, obr.room.id, obr.player.id, "open"]);
}

let combatPopoverOpen = false;

function isCombatLogOpen(obr) {
  try { return sessionStorage.getItem(combatPopoverKey(obr)) === "1"; }
  catch { return combatPopoverOpen; }
}

function setCombatLogOpen(obr, open) {
  combatPopoverOpen = open;
  try {
    if (open) sessionStorage.setItem(combatPopoverKey(obr), "1");
    else sessionStorage.removeItem(combatPopoverKey(obr));
  } catch {}
}

export function resetCombatLogPopover(obr) {
  setCombatLogOpen(obr, false);
}

export async function closeCombatLog(obr) {
  setCombatLogOpen(obr, false);
  try {
    await obr.popover.close(COMBAT_POPOVER);
  } catch (error) {
    setCombatLogOpen(obr, true);
    throw error;
  }
}

export async function toggleCombatLog(obr, open = () => openCombatLog(obr)) {
  if (isCombatLogOpen(obr)) return closeCombatLog(obr);
  return open();
}

export async function openCombatLog(obr) {
  const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
  await obr.popover.open({
    id: COMBAT_POPOVER,
    url: new URL("./index.html?v=3.2.4&combat-log=1", import.meta.url).href,
    width: Math.max(1, Math.min(380, width - 24)), height: Math.max(1, Math.min(340, height - 64)),
    anchorReference: "POSITION",
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    anchorPosition: { left: width - 14, top: height - 14 },
    transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
    disableClickAway: true,
  });
  setCombatLogOpen(obr, true);
}

export function combatDamage(rolls) {
  if (!rolls?.length) return;
  const first = rolls[0];
  if (first.blocked) return { amount: 0, type: first.type, blocked: true };
  return {
    amount: rolls.reduce((sum, roll) => sum + roll.amount, 0),
    type: first.type,
    dice: rolls.flatMap((roll) => roll.dice ?? []),
    sides: first.sides,
    groups: first.groups,
    modifier: rolls.reduce((sum, roll) => sum + (roll.modifier ?? 0), 0),
  };
}

export function formatCombatDamage(damage) {
  if (damage.blocked) return "blocked by shield · 0 " + damage.type + " damage";
  const signed = damage.modifier > 0 ? "+" + damage.modifier
    : damage.modifier < 0 ? String(damage.modifier) : "";
  const terms = damage.dice.join(" + ") + (signed ? " " + signed[0] + " " + Math.abs(damage.modifier) : "");
  const total = damage.amount + " " + damage.type + " damage";
  const rolled = damage.dice.reduce((sum, die) => sum + die, damage.modifier);
  const result = rolled < 0 ? " → " : " = ";
  return damage.dice.length
    ? damageNotation({ ...damage, count: damage.dice.length }) + " = " + terms + result + total : total;
}

export function damageNotation(formula, spaced = false) {
  const plus = spaced ? " + " : "+";
  const minus = spaced ? " - " : "-";
  const { modifier } = formula;
  return diceGroups(formula).map(({ count, sides }) => count + "d" + sides).join(plus) +
    (modifier ? (modifier < 0 ? minus : plus) + Math.abs(modifier) : "");
}

export function saveNotation(modifier, mode) {
  const dice = mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
  return dice + (modifier < 0 ? "" : "+") + modifier;
}

function damageFromRoll(formula, roll) {
  if (roll?.notation !== damageNotation(formula) || !Array.isArray(roll.breakdown)) return;
  const { sides, type, groups, modifier = 0 } = formula;
  let count = 0;
  for (const group of diceGroups(formula)) {
    for (let i = 0; i < group.count; i++) {
      const die = roll.breakdown[count++];
      if (!Number.isInteger(die) || die < 1 || die > group.sides) return;
    }
  }
  const dice = roll.breakdown.slice(0, count);
  if (roll.breakdown.length !== count + Number(modifier !== 0) ||
      (modifier !== 0 && roll.breakdown[count] !== modifier) ||
      dice.reduce((sum, die) => sum + die, modifier) !== roll.total) return;
  return { amount: Math.max(0, roll.total), type, dice, sides, groups, modifier };
}

export function setupCombatLog(obr) {
  const log = new Map();
  const damageClaims = new Map();
  let channel;
  let sceneVersion = 0;
  let incoming = Promise.resolve();
  const publish = () => channel?.postMessage({ type: "entries", entries: [...log.values()] });

  function receive(entry) {
    if (log.has(entry.id)) return;
    if (entry.damageFormula && !entry.damage) {
      const previous = entriesForCast(entry.id.split(".")[0]).find(({ damage }) => damage);
      if (previous) entry = { ...entry, damage: previous.damage };
    }
    log.set(entry.id, entry);
    if (log.size > LOG_LIMIT) {
      const oldest = log.keys().next().value;
      log.delete(oldest);
      if (!entriesForCast(oldest.split(".")[0]).length) damageClaims.delete(oldest.split(".")[0]);
    }
    publish();
  }

  function entriesForCast(id) {
    return [...log.values()].filter((entry) => entry.id.split(".")[0] === id);
  }

  function receiveResult({ id, damage, save }) {
    let changed = false;
    for (const entry of entriesForCast(id)) {
      if (damage && entry.damageFormula && !entry.damage) {
        log.set(entry.id, { ...entry, damage });
        changed = true;
      }
      if (save && entry.saveAbility && entry.hits.some((hit) => hit.id === save.tokenId)) {
        log.set(entry.id, { ...entry, saves: { ...entry.saves, [save.tokenId]: save.total } });
        changed = true;
      }
    }
    if (changed) publish();
  }

  obr.scene.onReadyChange(() => {
    sceneVersion++;
    log.clear();
    damageClaims.clear();
    publish();
  });
  void openCombatChannel(obr).then((result) => {
    channel = result;
    channel.onmessage = ({ data }) => { if (data?.type === "history") publish(); };
    publish();
  }).catch(console.error);

  obr.broadcast.onMessage(COMBAT_EVENT, ({ connectionId, data }) => {
    const version = sceneVersion;
    const update = data?.type === "roll";
    const entry = typeof data?.id === "string" && /^[0-9a-f-]{36}(?:\.\d+)?$/i.test(data.id) &&
      (Object.hasOwn(SKILLS, data.skill) || typeof data.skill === "string" && CUSTOM_ID.test(data.skill)) && Array.isArray(data.hits) && data.hits.length <= 20;
    if (update ? !combatId(data.id) : !entry) return;
    incoming = incoming.then(async () => {
      const [{ gm }, ready] = await Promise.all([skillConnections(obr), obr.scene.isReady()]);
      if (version !== sceneVersion || !ready || gm?.connectionId !== connectionId) return;
      if (update) receiveResult(data);
      else receive(data);
    }).catch((error) => console.error("Overhead Chat combat log", error));
    return incoming;
  });

  async function record({ requestId, caster, skill, level, selected, hits = [], damage, damageFormula, action, attack = false, definition = SKILLS[skill] }) {
    const version = sceneVersion;
    const targets = [...new Map(hits.map((token) => [token.id, { id: token.id, name: name(token.name) }])).values()];
    const groups = [];
    for (let i = 0; i < targets.length; i += 20) groups.push(targets.slice(i, i + 20));
    if (!groups.length) groups.push([]);
    try {
      for (const [index, group] of groups.entries()) {
        if (version !== sceneVersion) break;
        const entry = {
          id: index ? requestId + "." + index : requestId,
          actor: name(caster.name), casterId: caster.id, skill, action: action || definition.name, level, attack,
          selected: selected ? { id: selected.id, name: name(selected.name) } : undefined,
          hits: group,
          saveAbility: definition.saveAbility,
          damage, damageFormula,
        };
        receive(entry);
        await obr.broadcast.sendMessage(COMBAT_EVENT, entry, { destination: "REMOTE" });
      }
    } catch (error) { console.error("Overhead Chat combat log", error); }
  }

  async function acceptRoll({ id, kind, tokenId, notation, roll, phase, chatId, saveAbility, modifier, mode }) {
    if (!combatId(id) || (kind !== "damage" && kind !== "save")) return;
    const version = sceneVersion;
    const { gm, self } = await skillConnections(obr);
    if (version !== sceneVersion || gm?.connectionId !== self.connectionId) return;
    const entries = entriesForCast(id);
    const result = { id, type: "roll" };
    if (kind === "damage") {
      const entry = entries[0];
      if (!entry?.damageFormula || entry.damage || tokenId !== entry.casterId ||
          notation !== damageNotation(entry.damageFormula)) return;
      const claim = damageClaims.get(id);
      const now = Date.now();
      if (phase === "pending") {
        if (!claim || claim.expires <= now) damageClaims.set(id, { chatId, expires: now + ROLL_TIMEOUT });
        return;
      }
      if (claim?.chatId !== chatId || claim.expires <= now) return;
      damageClaims.delete(id);
      if (phase !== "resolved") return;
      result.damage = damageFromRoll(entry.damageFormula, roll);
      if (!result.damage) return;
    } else {
      if (phase !== "resolved" || !["normal", "advantage", "disadvantage"].includes(mode) ||
          !Number.isInteger(modifier) || !entries.some((entry) => entry.saveAbility === saveAbility &&
          entry.hits.some((hit) => hit.id === tokenId)) ||
          notation !== saveNotation(modifier, mode) ||
          !Number.isInteger(roll?.total) || roll.total < modifier + 1 || roll.total > modifier + 20) return;
      result.save = { tokenId, total: roll.total };
    }
    receiveResult(result);
    await obr.broadcast.sendMessage(COMBAT_EVENT, result, { destination: "REMOTE" });
  }

  return { record, acceptRoll };
}
