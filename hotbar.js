const HOTBAR_ID = "chat.overhead.hotbar.v1";
const HOTBAR_COMMAND = HOTBAR_ID + "/command";
export const MIN_HOTBAR_SLOTS = 10;
export const MAX_HOTBAR_SLOTS = 15;
const VIEWPORT_MARGIN = 8;

function hotbarLength(left, viewport, slots, compact) {
  const slotSize = left ? (compact ? 36 : 45) : (compact ? 46 : 76);
  return Math.max(1, Math.min(slots * slotSize, viewport - (left ? 32 : 24)));
}

const key = (obr, field) => JSON.stringify([HOTBAR_ID, obr.room.id, obr.player.id, field]);

export const hotbarVerticalRange = (left) => left ? 100 : 30;
const clampValue = (left, value) => Math.min(hotbarVerticalRange(left), Math.max(0, Math.round(value)));
const verticalKey = (obr, left) => key(obr, left ? "left-height" : "bottom-height");

export function hotbarVerticalPosition(obr, left) {
  try {
    const saved = localStorage.getItem(verticalKey(obr, left));
    if (saved !== null && Number.isFinite(Number(saved))) return clampValue(left, Number(saved));
  } catch {}
  return left ? 50 : 0;
}

export function setHotbarVerticalPosition(obr, left, value) {
  if (!Number.isFinite(value)) return;
  try { localStorage.setItem(verticalKey(obr, left), String(clampValue(left, value))); } catch {}
}

function dimensions(left, compact, slots, viewport) {
  return {
    width: left ? Math.min(compact ? 62 : 146, viewport.width) : hotbarLength(false, viewport.width, slots, compact),
    height: left ? hotbarLength(true, viewport.height, slots, compact) : Math.min(compact ? 42 : 57, viewport.height),
  };
}

function anchorPosition(obr, left, viewport, size) {
  const value = hotbarVerticalPosition(obr, left);
  if (!left) {
    const margin = Math.min(12, Math.max(0, viewport.height - size.height));
    return { left: viewport.width / 2, top: Math.max(size.height, viewport.height - margin - viewport.height * value / 100) };
  }
  const available = Math.max(0, viewport.height - size.height);
  const margin = Math.min(VIEWPORT_MARGIN, available / 2);
  return {
    left: Math.min(60, Math.max(0, viewport.width - size.width)),
    top: Math.round(size.height / 2 + margin + (available - margin * 2) * (100 - value) / 100),
  };
}

export function hotbarOrientation(obr) {
  try {
    if (localStorage.getItem(key(obr, "position")) === "left") return "left";
  } catch {}
  return "bottom";
}

export function setHotbarOrientation(obr, value) {
  try { localStorage.setItem(key(obr, "position"), value === "left" ? "left" : "bottom"); } catch {}
}

export function hotbarShowsLabels(obr) {
  try { return localStorage.getItem(key(obr, "labels")) !== "off"; } catch { return true; }
}

export function setHotbarLabels(obr, visible) {
  try { localStorage.setItem(key(obr, "labels"), visible ? "on" : "off"); } catch {}
}

export function hotbarMode(obr) {
  try {
    if (sessionStorage.getItem(key(obr, "mode")) === "quickbar") return "quickbar";
  } catch {}
  return "skills";
}

export function sendHotbarCommand(obr, command, movement) {
  return obr.broadcast.sendMessage(HOTBAR_COMMAND, { command, movement }, { destination: "LOCAL" });
}

export function setupHotbar(obr) {
  let visible = false;
  let pending = Promise.resolve();

  let openedSlots = MIN_HOTBAR_SLOTS;

  async function open(slots = openedSlots) {
    const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
    const viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    const left = hotbarOrientation(obr) === "left";
    const compact = !hotbarShowsLabels(obr);
    const size = dimensions(left, compact, slots, viewport);
    const url = new URL("./hotbar.html?v=3.2.3", import.meta.url);
    if (left) url.searchParams.set("position", "left");
    if (compact) url.searchParams.set("labels", "off");
    if (slots !== MIN_HOTBAR_SLOTS) url.searchParams.set("slots", String(slots));
    await obr.popover.open({
      id: HOTBAR_ID, url: url.href, ...size,
      anchorReference: "POSITION", anchorPosition: anchorPosition(obr, left, viewport, size),
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: left ? { horizontal: "LEFT", vertical: "CENTER" } : { horizontal: "CENTER", vertical: "BOTTOM" },
      disableClickAway: true, hidePaper: true,
    });
    visible = true;
    openedSlots = slots;
  }

  async function close() {
    await obr.popover.close(HOTBAR_ID);
    visible = false;
  }

  function change(command, movement) {
    const result = pending.then(async () => {
      if (command === "toggle") {
        if (visible) await close();
        else await open();
      } else if (command === "mode") {
        const next = hotbarMode(obr) === "skills" ? "quickbar" : "skills";
        sessionStorage.setItem(key(obr, "mode"), next);
      } else if (command === "layout" && visible) {
        await close();
        await open();
      } else if (command === "resize" && visible && Number.isInteger(movement?.slots) &&
          movement.slots >= MIN_HOTBAR_SLOTS && movement.slots !== openedSlots &&
          movement.left === (hotbarOrientation(obr) === "left") && movement.compact === !hotbarShowsLabels(obr)) {
        if (movement.left) {
          await close();
          await open(movement.slots);
        } else {
          const width = await obr.viewport.getWidth();
          await obr.popover.setWidth(HOTBAR_ID, hotbarLength(false, width, movement.slots, movement.compact));
          openedSlots = movement.slots;
        }
      }
    });
    pending = result.catch(() => {});
    return result;
  }

  const ownConnection = obr.player.getConnectionId();
  obr.broadcast.onMessage(HOTBAR_COMMAND, async ({ connectionId, data }) => {
    try {
      if (connectionId === await ownConnection) await change(data?.command, data?.movement);
    } catch (error) {
      console.error("Overhead Chat hotbar", error);
    }
  });
  return change;
}
