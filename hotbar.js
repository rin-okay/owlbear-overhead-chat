const HOTBAR_ID = "chat.overhead.hotbar.v1";
const HOTBAR_COMMAND = HOTBAR_ID + "/command";

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

export function hotbarMode(obr) {
  try {
    if (sessionStorage.getItem(key(obr, "mode")) === "quickbar") return "quickbar";
  } catch {}
  return "skills";
}

export function sendHotbarCommand(obr, command) {
  return obr.broadcast.sendMessage(HOTBAR_COMMAND, { command }, { destination: "LOCAL" });
}

export function handleHotbarKey(obr, event) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey ||
      event.metaKey || event.shiftKey || (event.key !== "=" && event.key !== "-")) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) void sendHotbarCommand(obr, event.key === "=" ? "toggle" : "mode").catch(console.error);
  return true;
}

export function setupHotbar(obr) {
  let visible = false;
  let pending = Promise.resolve();

  async function open() {
    const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
    const left = hotbarOrientation(obr) === "left";
    const url = new URL("./hotbar.html?v=2.9.16", import.meta.url);
    if (left) url.searchParams.set("position", "left");
    await obr.popover.open({
      id: HOTBAR_ID, url: url.href,
      width: left ? 146 : Math.max(1, Math.min(760, width - 24)),
      height: left ? Math.max(1, Math.min(450, height - 32)) : 57,
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
