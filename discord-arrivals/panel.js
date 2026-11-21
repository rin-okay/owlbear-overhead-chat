import OBR from "./obr.js";
import { AVATAR, CLAIM, CONFIG, MODAL, RESULT, character, defaults, dismissKey, httpsOrigin, linkKey, point, smokeFields, workerOrigin } from "./model.mjs";

const el = (id) => document.getElementById(id);
const status = (message) => { el("status").textContent = message; };
const welcome = new URLSearchParams(location.search).has("welcome");
const setVisible = (id, show) => { el(id).hidden = !show; };
function readableError(error) { status(error.message || "Something went wrong. Try again."); }
function listen(id, action) {
  el(id).addEventListener("click", () => Promise.resolve().then(action).catch(readableError));
}
async function selectedItem() {
  const ids = await OBR.player.getSelection();
  if (ids?.length !== 1) throw Error("Select exactly one item on the map first.");
  const [item] = await OBR.scene.items.getItems(ids);
  if (!item) throw Error("The selected item is unavailable.");
  return item;
}

async function setupGM() {
  if (!await OBR.scene.isReady()) {
    status("Open the scene you want to configure, then reopen this panel.");
    return;
  }
  let active = true;
  OBR.scene.onReadyChange(() => {
    active = false;
    el("save").disabled = true;
    status("The scene changed. Reopen this panel to edit the current scene.");
  });
  const previous = (await OBR.scene.getMetadata())[CONFIG] ?? {};
  const cfg = {...defaults, ...previous};
  const select = el("vision");
  el("enabled").checked = cfg.enabled;
  el("worker").value = cfg.worker ?? "";
  select.value = cfg.vision;
  el("radius").value = cfg.radius;
  function render() {
    el("spawn-status").textContent = point(cfg.spawn)
      ? "Spawn point: " + Math.round(cfg.spawn.x) + ", " + Math.round(cfg.spawn.y)
      : "Select an item at the desired spawn point, then use the button.";
    el("template-status").textContent = cfg.templateId ? "Vision template selected." : "Select a character with Smoke & Spectre vision already enabled.";
    setVisible("smoke-options", select.value === "smoke-template");
    setVisible("native-options", select.value === "native");
  }
  select.addEventListener("change", render);
  listen("set-spawn", async () => {
    const item = await selectedItem();
    if (!point(item.position)) throw Error("The selected item has no usable position.");
    cfg.spawn = {x:item.position.x, y:item.position.y};
    render();
  });
  listen("set-template", async () => {
    const item = await selectedItem();
    if (!character(item) || !Object.keys(smokeFields(item)).length) {
      throw Error("No recognized Smoke & Spectre metadata was found on that character. Check its vision settings or choose the GM enable option.");
    }
    cfg.templateId = item.id;
    render();
  });
  listen("save", async () => {
    if (!active || await OBR.player.getRole() !== "GM") throw Error("Reopen this panel as GM in the intended scene.");
    cfg.enabled = el("enabled").checked;
    cfg.worker = httpsOrigin(el("worker").value.trim());
    cfg.vision = select.value;
    cfg.radius = Number(el("radius").value);
    if (cfg.enabled && !point(cfg.spawn)) throw Error("Set the scene’s spawn point first.");
    if ((el("worker").value.trim() && !cfg.worker) || (cfg.enabled && !workerOrigin(cfg, location.origin))) {
      throw Error("Enter the deployed Cloudflare Worker’s HTTPS address, without a path.");
    }
    if (cfg.enabled && cfg.vision === "smoke-template" && !cfg.templateId) throw Error("Select a vision template first.");
    if (cfg.vision === "native" && (!Number.isInteger(cfg.radius) || cfg.radius < 1 || cfg.radius > 100)) {
      throw Error("Set a whole-number radius from 1 to 100.");
    }
    const permissions = await OBR.room.getPermissions();
    if (!active) throw Error("The scene changed. Reopen the panel and try again.");
    await OBR.scene.setMetadata({[CONFIG]:cfg});
    status(cfg.enabled && !permissions.includes("CHARACTER_UPDATE")
      ? "Saved. Enable Character Update in Owlbear’s player permissions so players can move their tokens."
      : "Scene settings saved.");
  });
  render();
  setVisible("gm", true);
  status("");
}

async function setupPlayer() {
  if (!await OBR.scene.isReady()) { status("Ask the GM to open a scene."); return; }
  const [metadata, room, connection] = await Promise.all([
    OBR.scene.getMetadata(), OBR.room.getMetadata(), OBR.player.getConnectionId(),
  ]);
  if (!metadata[CONFIG]?.enabled) { status("The GM hasn’t enabled Discord arrivals in this scene."); return; }
  const player = OBR.player.id;
  const key = dismissKey(OBR.room.id, player);
  const linked = room[linkKey(player)];
  const [existing] = linked ? await OBR.scene.items.getItems([linked.tokenId]) : [];
  if (existing?.createdUserId === player && character(existing)) {
    if (!(await OBR.player.getMetadata())[AVATAR]?.tokenId) await OBR.player.setMetadata({[AVATAR]:{tokenId:existing.id}});
    status("Discord is linked and your token is in this scene.");
    return;
  }
  const worker = workerOrigin(metadata[CONFIG], location.origin);
  if (!worker) { status("Ask the GM to set the Cloudflare Worker address in Discord Arrivals."); return; }
  const start = new URL("/oauth/start", worker);
  start.search = new URLSearchParams({room:OBR.room.id, player, connection}).toString();
  const connect = el("connect");
  let popup;
  let claim;
  let retry;
  function clearClaim() {
    clearInterval(retry);
    claim = undefined;
  }
  async function submit(ticket) {
    if (typeof ticket !== "string" || !/^[\w-]{1,4000}\.[\w-]{43}$/.test(ticket)) throw Error("Paste the full sign-in code.");
    if (claim?.ticket === ticket) return;
    clearClaim();
    claim = {ticket, request:crypto.randomUUID(), started:Date.now()};
    retry = setInterval(send, 5500);
    await send();
  }
  async function send() {
    if (!claim) return;
    if (Date.now() - claim.started > 120000) {
      clearClaim();
      status("The GM isn’t responding. Ask them to open the room, then paste your sign-in code and try again.");
      return;
    }
    const request = claim;
    try {
      await OBR.broadcast.sendMessage(CLAIM, {ticket:request.ticket, request:request.request});
      if (claim === request) status("Discord connected. Waiting for the GM to place your token…");
    } catch {
      if (claim === request) status("Owlbear is reconnecting. Retrying…");
    }
  }
  const unsubscribe = OBR.broadcast.onMessage(RESULT, async ({connectionId, data}) => {
    try {
      if (!claim || data?.connection !== connection || data.request !== claim.request) return;
      const [party, items] = await Promise.all([
        OBR.party.getPlayers(), typeof data.tokenId === "string" ? OBR.scene.items.getItems([data.tokenId]) : [],
      ]);
      if (!claim || data.request !== claim.request ||
          !party.some((entry) => entry.connectionId === connectionId && entry.role === "GM")) return;
      if (data.error) {
        clearClaim();
        status(String(data.error).slice(0,240));
        return;
      }
      const [token] = items;
      if (!character(token) || token.createdUserId !== player) return;
      clearClaim();
      await OBR.player.setMetadata({[AVATAR]:{tokenId:token.id}});
      try { localStorage.setItem(key, "linked"); } catch {}
      connect.disabled = true;
      el("paste-details").hidden = true;
      status(data.needsVision ? "Your token is ready. The GM can enable Smoke & Spectre vision on it." : "Your token is ready.");
    } catch (error) {
      readableError(error);
    }
  });
  connect.addEventListener("click", () => {
    popup = window.open(start.href, "_blank");
    if (!popup) {
      document.querySelector("#oauth-link")?.remove();
      const link = document.createElement("a");
      link.id = "oauth-link";
      link.href = start.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "open discord in a new tab";
      el("player").append(link);
      status("Open the link, then copy the sign-in code back here.");
    } else {
      status("Finish signing in on Discord.");
    }
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== worker || !popup || event.source !== popup ||
        event.data?.type !== "discord-arrivals/oauth") return;
    el("code").value = event.data.ticket;
    void submit(event.data.ticket).catch(readableError);
  });
  el("paste").addEventListener("submit", (event) => {
    event.preventDefault();
    void submit(el("code").value.trim()).catch(readableError);
  });
  listen("skip", async () => {
    try { localStorage.setItem(key, "skipped"); } catch {}
    clearClaim();
    if (welcome) await OBR.modal.close(MODAL);
    else status("First-join prompt skipped. You can still connect here whenever you’re ready.");
  });
  window.addEventListener("pagehide", () => { clearClaim(); unsubscribe(); }, {once:true});
  connect.disabled = false;
  setVisible("player", true);
  status("");
}

OBR.onReady(async () => {
  try {
    if (await OBR.player.getRole() === "GM") await setupGM();
    else await setupPlayer();
  } catch (error) {
    readableError(error);
  }
});
