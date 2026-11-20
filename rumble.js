import OBR from "./obr.js";

const REQUEST = "com.battle-system.friends/metadata_diceroll";
const ACTIVE = "com.battle-system.rumble/rumble_active";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCompleted = 0;

export async function rollWithRumble(notation) {
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
      else finish(null, { total, detail: detail.slice(0, 1200) });
    });
    const timeout = setTimeout(() => {
      finish(new Error("Rumble! didn’t return a roll. Keep it open, select Everyone, and check the notation."));
    }, 12000);

    // Rumble uses its own parser and animation on the sender's connection.
    OBR.player.setMetadata({ [REQUEST]: { notation, sender, created: new Date().toISOString() } })
      .catch(() => finish(new Error("Couldn’t send the roll to Rumble!")));
  });
}
