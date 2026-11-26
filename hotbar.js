const HOTBAR_ID = "chat.overhead.hotbar.v1";
const HOTBAR_COMMAND = HOTBAR_ID + "/command";
export const MIN_HOTBAR_SLOTS = 10;
export const MAX_HOTBAR_SLOTS = 15;

function hotbarLength(left, viewport, slots, compact) {
  const slotSize = left ? (compact ? 36 : 45) : (compact ? 46 : 76);
  return Math.max(1, Math.min(slots * slotSize, viewport - (left ? 32 : 24)));
}

export async function resizeHotbar(obr, left, slots, compact) {
  if (left) {
    await obr.popover.setHeight(HOTBAR_ID, hotbarLength(true, await obr.viewport.getHeight(), slots, compact));
  } else {
    await obr.popover.setWidth(HOTBAR_ID, hotbarLength(false, await obr.viewport.getWidth(), slots, compact));
  }
}

const key = (obr, field) => JSON.stringify([HOTBAR_ID, obr.room.id, obr.player.id, field]);

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

export function sendHotbarCommand(obr, command) {
  return obr.broadcast.sendMessage(HOTBAR_COMMAND, { command }, { destination: "LOCAL" });
}

export function setupHotbar(obr) {
  let visible = false;
  let pending = Promise.resolve();

  async function open() {
    const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
    const left = hotbarOrientation(obr) === "left";
    const compact = !hotbarShowsLabels(obr);
    const url = new URL("./hotbar.html?v=2.11.10", import.meta.url);
    if (left) url.searchParams.set("position", "left");
    if (compact) url.searchParams.set("labels", "off");
    await obr.popover.open({
      id: HOTBAR_ID, url: url.href,
      width: left ? (compact ? 62 : 146) : hotbarLength(false, width, MIN_HOTBAR_SLOTS, compact),
      height: left ? hotbarLength(true, height, MIN_HOTBAR_SLOTS, compact) : (compact ? 42 : 57),
      anchorReference: "POSITION",
      anchorPosition: left ? { left: 60, top: height / 2 } : { left: width / 2, top: height - 12 },
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: left ? { horizontal: "LEFT", vertical: "CENTER" } : { horizontal: "CENTER", vertical: "BOTTOM" },
      disableClickAway: true, hidePaper: true,
    });
    visible = true;
  }

  async function close() {
    await obr.popover.close(HOTBAR_ID);
    visible = false;
  }

  function change(command) {
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
      }
    });
    pending = result.catch(() => {});
    return result;
  }

  const ownConnection = obr.player.getConnectionId();
  obr.broadcast.onMessage(HOTBAR_COMMAND, async ({ connectionId, data }) => {
    try {
      if (connectionId === await ownConnection) await change(data?.command);
    } catch (error) {
      console.error("Overhead Chat hotbar", error);
    }
  });
  return change;
}
