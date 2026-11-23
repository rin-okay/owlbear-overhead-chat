import { SKILLS, skillConnections } from "./skills.js?v=2.9.2";

export const COMBAT_POPOVER = "chat.overhead.combat-log.v1";
const COMBAT_EVENT = "chat.overhead.combat-event.v1";
const LOG_LIMIT = 100;
const name = (value) => String(value || "unnamed token").slice(0, 80);

export async function openCombatChannel(obr) {
  const connectionId = await obr.player.getConnectionId();
  return new BroadcastChannel(JSON.stringify([COMBAT_POPOVER, obr.room.id, connectionId]));
}

export async function openCombatLog(obr) {
  const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
  return obr.popover.open({
    id: COMBAT_POPOVER,
    url: new URL("./index.html?v=2.9.2&combat-log=1", import.meta.url).href,
    width: Math.max(1, Math.min(380, width - 24)), height: Math.max(1, Math.min(340, height - 64)),
    anchorReference: "POSITION",
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    anchorPosition: { left: width - 14, top: height - 14 },
    transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
    disableClickAway: true,
  });
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
  return damage.dice.length ? damage.dice.length + "d" + damage.sides + signed + " = " + terms + result + total : total;
}

export function setupCombatLog(obr) {
  const log = new Map();
  let channel;
  let sceneVersion = 0;
  const publish = () => channel?.postMessage({ type: "entries", entries: [...log.values()] });

  function receive(entry) {
    if (log.has(entry.id)) return;
    log.set(entry.id, entry);
    if (log.size > LOG_LIMIT) log.delete(log.keys().next().value);
    publish();
  }

  obr.scene.onReadyChange(() => {
    sceneVersion++;
    log.clear();
    publish();
  });
  void openCombatChannel(obr).then((result) => {
    channel = result;
    channel.onmessage = ({ data }) => { if (data?.type === "history") publish(); };
    publish();
  }).catch(console.error);

  obr.broadcast.onMessage(COMBAT_EVENT, async ({ connectionId, data }) => {
    const version = sceneVersion;
    if (typeof data?.id !== "string" || !/^[0-9a-f-]{36}(?:\.\d+)?$/i.test(data.id) ||
        !Object.hasOwn(SKILLS, data.skill) || !Array.isArray(data.hits) || data.hits.length > 20) return;
    try {
      const [{ gm }, ready] = await Promise.all([skillConnections(obr), obr.scene.isReady()]);
      if (version === sceneVersion && ready && gm?.connectionId === connectionId) receive(data);
    } catch (error) { console.error("Overhead Chat combat log", error); }
  });

  return async ({ requestId, caster, skill, level, selected, hits = [], damage, action, attack = false }) => {
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
          actor: name(caster.name), skill, action: action || SKILLS[skill].name, level, attack,
          selected: selected ? { id: selected.id, name: name(selected.name) } : undefined,
          hits: group,
          saveAbility: SKILLS[skill].saveAbility,
          damage,
        };
        receive(entry);
        await obr.broadcast.sendMessage(COMBAT_EVENT, entry, { destination: "REMOTE" });
      }
    } catch (error) { console.error("Overhead Chat combat log", error); }
  };
}
