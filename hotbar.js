const HOTBAR_ID = "chat.overhead.hotbar.v1";
export const HOTBAR_PLACEMENT = HOTBAR_ID + "/placement";
const HOTBAR_COMMAND = HOTBAR_ID + "/command";
export const MIN_HOTBAR_SLOTS = 10;
export const MAX_HOTBAR_SLOTS = 15;
const GRIP_SIZE = 24;
const VIEWPORT_MARGIN = 8;

function hotbarLength(left, viewport, slots, compact) {
  const slotSize = left ? (compact ? 36 : 45) : (compact ? 46 : 76);
  return Math.max(1, Math.min(slots * slotSize + GRIP_SIZE, viewport - (left ? 32 : 24)));
}

export async function resizeHotbar(obr, left, slots, compact) {
  if (left) {
    await obr.popover.setHeight(HOTBAR_ID, hotbarLength(true, await obr.viewport.getHeight(), slots, compact));
  } else {
    await obr.popover.setWidth(HOTBAR_ID, hotbarLength(false, await obr.viewport.getWidth(), slots, compact));
  }
}

const key = (obr, field) => JSON.stringify([HOTBAR_ID, obr.room.id, obr.player.id, field]);

const placementKey = (obr, left) => key(obr, left ? "vertical-placement" : "horizontal-placement");

function readPlacement(obr, left) {
  try {
    const saved = JSON.parse(localStorage.getItem(placementKey(obr, left)));
    if ([saved?.x, saved?.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return saved;
  } catch {}
}

function dimensions(left, compact, slots, viewport) {
  return {
    width: left ? Math.min(compact ? 62 : 146, viewport.width) : hotbarLength(false, viewport.width, slots, compact),
    height: left ? hotbarLength(true, viewport.height, slots, compact) : Math.min(compact ? 42 : 57, viewport.height),
  };
}

export function clampAnchor(left, point, viewport, size) {
  const leftInset = left ? 0 : size.width / 2;
  const topInset = left ? size.height / 2 : size.height;
  const clamp = (value, before, after, limit) => {
    const margin = Math.min(VIEWPORT_MARGIN, Math.max(0, (limit - before - after) / 2));
    return Math.min(limit - after - margin, Math.max(before + margin, Math.round(value)));
  };
  return {
    left: clamp(point.left, leftInset, size.width - leftInset, viewport.width),
    top: clamp(point.top, topInset, size.height - topInset, viewport.height),
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

export function openHotbarPlacement(obr, { left, compact, slots, x, y, width, height, screenX, screenY }) {
  const url = new URL("./hotbar-placement.html?v=3.2.2", import.meta.url);
  for (const [key, value] of Object.entries({ left, compact, slots, x, y, width, height, screenX, screenY })) {
    url.searchParams.set(key, String(value));
  }
  return obr.modal.open({ id: HOTBAR_PLACEMENT, url: url.href, fullScreen: true, hideBackdrop: true, hidePaper: true });
}

export function setupHotbar(obr) {
  let visible = false;
  let pending = Promise.resolve();

  async function open(movement) {
    const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
    const viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    const left = hotbarOrientation(obr) === "left";
    const compact = !hotbarShowsLabels(obr);
    if (movement && (left !== movement.left || compact !== movement.compact)) return;
    const slots = movement?.slots ?? MIN_HOTBAR_SLOTS;
    const size = dimensions(left, compact, slots, viewport);
    const saved = readPlacement(obr, left);
    const preferred = saved ? { left: saved.x * viewport.width, top: saved.y * viewport.height }
      : left ? { left: 60, top: viewport.height / 2 } : { left: viewport.width / 2, top: viewport.height - 12 };
    const anchor = clampAnchor(left, preferred, viewport, size);
    const destination = movement ? clampAnchor(left, movement.absolute
      ? { left: movement.x * viewport.width, top: movement.y * viewport.height }
      : { left: anchor.left + movement.dx, top: anchor.top + movement.dy }, viewport, size) : anchor;
    if (movement && destination.left === anchor.left && destination.top === anchor.top) return;

    const url = new URL("./hotbar.html?v=3.2.2", import.meta.url);
    if (left) url.searchParams.set("position", "left");
    if (compact) url.searchParams.set("labels", "off");
    if (slots !== MIN_HOTBAR_SLOTS) url.searchParams.set("slots", String(slots));
    const options = {
      id: HOTBAR_ID, url: url.href, ...size,
      anchorReference: "POSITION",
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: left ? { horizontal: "LEFT", vertical: "CENTER" } : { horizontal: "CENTER", vertical: "BOTTOM" },
      disableClickAway: true, hidePaper: true,
    };
    if (movement) await close();
    if (movement?.keyboard) url.searchParams.set("focus", "grip");
    try {
      await obr.popover.open({ ...options, url: url.href, anchorPosition: destination });
    } catch (error) {
      if (movement) {
        await obr.popover.open({ ...options, anchorPosition: anchor });
        visible = true;
      }
      throw error;
    }
    visible = true;
    if (movement) {
      try {
        localStorage.setItem(placementKey(obr, left),
          JSON.stringify({ x: destination.left / viewport.width, y: destination.top / viewport.height }));
      } catch {}
    }
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
      } else if (command === "move" && visible &&
          typeof movement?.left === "boolean" && typeof movement.compact === "boolean" &&
          (movement.absolute === true
            ? [movement.x, movement.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
            : [movement.dx, movement.dy].every(Number.isFinite) && (movement.dx || movement.dy)) &&
          Number.isInteger(movement.slots) && movement.slots >= MIN_HOTBAR_SLOTS) {
        await open(movement);
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
