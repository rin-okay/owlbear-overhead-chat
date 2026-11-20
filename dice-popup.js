import OBR from "./obr.js";
import { normalizeAppearance } from "./appearance.js";

const POPOVER_ID = "chat.overhead.dice-tray";
const queue = [];
let active;

export function queueDicePopup(entry, tray, { border, fill, color, diceEdge, diceEdgeWidth } = normalizeAppearance()) {
  if (queue.length >= 8) queue.shift();
  queue.push({
    ...tray,
    name: entry.name,
    colors: { edge: diceEdge ?? border, edgeWidth: diceEdgeWidth, fill, ink: color },
    rolls: entry.parts.filter((part) => typeof part === "object")
      .map(({ notation, total, breakdown }) => ({ notation, total, breakdown })),
  });
  openNext();
}

function openNext() {
  if (active || !queue.length) return;
  const payload = queue.shift();
  const nonce = crypto.randomUUID();
  const channel = new BroadcastChannel(`${POPOVER_ID}:${nonce}`);
  const popup = { channel };
  active = popup;

  popup.done = Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()])
    .then(([width, height]) => {
      if (popup.closing) return;
      const url = new URL("./dice-tray.html", import.meta.url);
      url.hash = nonce;
      return OBR.popover.open({
        id: POPOVER_ID,
        url: url.href,
        width: Math.min(480, Math.max(180, width - 24)),
        height: Math.min(310, Math.max(150, height - 24)),
        anchorReference: "POSITION",
        anchorPosition: { top: height - 12, left: width / 2 },
        anchorOrigin: { vertical: "BOTTOM", horizontal: "CENTER" },
        transformOrigin: { vertical: "BOTTOM", horizontal: "CENTER" },
        disableClickAway: true,
        hidePaper: true,
      });
    }).catch((error) => {
      console.warn("Overhead Chat dice popup couldn’t open", error);
      void closePopup(popup);
    });

  popup.timer = setTimeout(() => closePopup(popup), 8500);
  channel.onmessage = ({ data }) => {
    if (popup.closing) return;
    if (data === "ready") {
      channel.postMessage(payload);
    } else if (data === "settled") {
      clearTimeout(popup.timer);
      popup.timer = setTimeout(() => closePopup(popup), 1900);
    } else if (data === "close") {
      void closePopup(popup);
    }
  };
}

async function closePopup(popup) {
  if (popup.closing) return;
  popup.closing = true;
  clearTimeout(popup.timer);
  popup.channel.close();
  await popup.done;
  await OBR.popover.close(POPOVER_ID).catch(() => {});
  active = undefined;
  openNext();
}

export function resetDicePopups() {
  queue.length = 0;
  if (active) void closePopup(active);
}
