import OBR from "./obr.js";
import { parseDice } from "./dice.js";

const ACTIVE = "com.battle-system.rumble/rumble_active";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCompleted = 0;

const DICE_WINDOW = "com.battle-system.dicewindow";
let graphicTimer;

async function showOwnDice(roll) {
  const dice = [];
  const values = [];
  for (const set of roll.sets ?? []) {
    if (!/^d(?:\d+|f)$/i.test(set.type)) continue;
    for (const die of set.rolls ?? []) {
      if (!Number.isFinite(die.value)) continue;
      dice.push(set.type);
      values.push(die.value);
    }
  }
  if (!dice.length) return;

  const url = new URL("https://rumble.battle-system.com/dicewindow.html");
  url.search = new URLSearchParams({
    preroll: `${dice.join("_")}@${values.join(",")}`,
    player: roll.dPlayer || "Overhead Chat",
    playercolor: (roll.dPColor || "#c7b6f8").replace("#", ""),
    color: (roll.dColor || "#8b75b5").replace("#", ""),
    numbercolor: (roll.dNumber || "#ffffff").replace("#", ""),
    texture: roll.dTexture || "none",
  }).toString();
  const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
  await OBR.popover.open({
    id: DICE_WINDOW, url: url.href, width: 300, height: 300,
    anchorPosition: { top: height - 20, left: width - 20 }, anchorReference: "POSITION",
    anchorOrigin: { vertical: "BOTTOM", horizontal: "RIGHT" },
    transformOrigin: { vertical: "BOTTOM", horizontal: "RIGHT" },
    disableClickAway: true, hidePaper: true,
  });
  clearTimeout(graphicTimer);
  graphicTimer = setTimeout(() => OBR.popover.close(DICE_WINDOW).catch(() => {}), 6500);
}

function damageBreakdown(notation, roll, total) {
  const [diceTerm, modifierTerm] = parseDice(notation);
  const dice = (roll.sets ?? []).filter((set) => set.type === "d" + diceTerm.sides)
    .flatMap((set) => (set.rolls ?? []).map((die) => die.value));
  const modifier = modifierTerm?.constant ?? 0;
  if (dice.length !== diceTerm.count ||
      !dice.every((die) => Number.isInteger(die) && die >= 1 && die <= diceTerm.sides) ||
      dice.reduce((sum, die) => sum + die, modifier) !== total) {
    throw Error("Rumble! did not return the individual damage dice.");
  }
  return modifier ? [...dice, modifier] : dice;
}

export async function rollWithRumble(notation, requireBreakdown = false) {
  const [metadata, connectionId] = await Promise.all([OBR.player.getMetadata(), OBR.player.getConnectionId()]);
  if (!metadata[ACTIVE]) throw new Error("Open Rumble! in this Owlbear room first.");

  // Rumble keeps its dice tray busy for two seconds after announcing the result.
  const cooldown = lastCompleted + 2150 - Date.now();
  if (cooldown > 0) await wait(cooldown);

  const sender = `Overhead Chat (${crypto.randomUUID().slice(0, 8)})`;
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      clearTimeout(timeout);
      unsubscribe();
      if (error) reject(error);
      else resolve(result);
    };
    const unsubscribe = OBR.broadcast.onMessage("RUMBLECHAT", ({ connectionId: origin, data: event }) => {
      const data = event?.data;
      if (origin !== connectionId || event?.channel !== "RUMBLEROLLS" ||
          data?.sender !== sender || !data.rollResult || typeof data.chatlog !== "string") return;

      lastCompleted = Date.now();
      const detail = data.chatlog.slice(data.chatlog.indexOf(" rolled ") + 8).trim();
      const match = detail.match(/\bfor\s+(-?\d+(?:\.\d+)?)(?:!| successes?!?)?\s*$/i);
      const total = match ? Number(match[1]) : /\bno success/i.test(detail) ? 0 : NaN;
      if (!Number.isFinite(total)) finish(new Error("Rumble! returned a roll without a numeric total. Check its log."));
      else {
        showOwnDice(data.rollResult).catch((error) => console.warn("Rumble! dice window couldn’t open", error));
        try {
          const breakdown = requireBreakdown ? damageBreakdown(notation, data.rollResult, total) : undefined;
          finish(null, { total, detail: detail.slice(0, 1200), ...(breakdown ? { breakdown } : {}) });
        } catch (error) {
          finish(error);
        }
      }
    });
    const timeout = setTimeout(() => {
      finish(new Error("Rumble! didn’t return a roll. Keep it open and check the notation."));
    }, 12000);

    // Rumble uses its own parser and animation on the sender's connection.
    OBR.broadcast.sendMessage("FORGE_LISTENER", { notation, sender, targetId: "0000" }, { destination: "LOCAL" })
      .catch(() => finish(new Error("Couldn’t send the roll to Rumble!")));
  });
}
