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
  let cfg;
  let generation = 0;
  const select = el("vision");
  function render() {
    el("spawn-status").textContent = point(cfg.spawn)
      ? "Spawn point: " + Math.round(cfg.spawn.x) + ", " + Math.round(cfg.spawn.y)
      : "Select an item at the desired spawn point, then use the button.";
    el("template-status").textContent = cfg.templateId ? "Vision template selected." : "Select a character with Smoke & Spectre vision already enabled.";
    setVisible("smoke-options", select.value === "smoke-template");
    setVisible("native-options", select.value === "native");
  }
  function checkScene(expected) {
    if (!expected || expected !== cfg) throw Error("The scene changed. Try again once its settings load.");
  }
  select.addEventListener("change", render);
  listen("set-spawn", async () => {
    const current = cfg;
    const item = await selectedItem();
    checkScene(current);
    if (!point(item.position)) throw Error("The selected item has no usable position.");
    current.spawn = {x:item.position.x, y:item.position.y};
    render();
  });
  listen("set-template", async () => {
    const current = cfg;
    const item = await selectedItem();
    checkScene(current);
    if (!character(item) || !Object.keys(smokeFields(item)).length) {
      throw Error("No recognized Smoke & Spectre metadata was found on that character. Check its vision settings or choose the GM enable option.");
    }
    current.templateId = item.id;
    render();
  });
  listen("save", async () => {
    const current = cfg;
    if (await OBR.player.getRole() !== "GM") throw Error("Only the GM can edit these settings.");
    checkScene(current);
    const worker = el("worker").value.trim();
    const settings = {
      ...current, enabled:el("enabled").checked, worker:httpsOrigin(worker),
      vision:select.value, radius:Number(el("radius").value),
    };
    if (settings.enabled && !point(settings.spawn)) throw Error("Set the scene’s spawn point first.");
    if ((worker && !settings.worker) || (settings.enabled && !workerOrigin(settings, location.origin))) {
      throw Error("Enter the deployed Cloudflare Worker’s HTTPS address, without a path.");
    }
    if (settings.enabled && settings.vision === "smoke-template" && !settings.templateId) throw Error("Select a vision template first.");
    if (settings.vision === "native" && (!Number.isInteger(settings.radius) || settings.radius < 1 || settings.radius > 100)) {
      throw Error("Set a whole-number radius from 1 to 100.");
    }
    const permissions = await OBR.room.getPermissions();
    checkScene(current);
    await OBR.scene.setMetadata({[CONFIG]:settings});
    if (current !== cfg) return;
    status(settings.enabled && !permissions.includes("CHARACTER_UPDATE")
      ? "Saved. Enable Character Update in Owlbear’s player permissions so players can move their tokens."
      : "Scene settings saved.");
  });
  async function loadScene(ready) {
    const request = ++generation;
    cfg = undefined;
    setVisible("gm", false);
    setVisible("check-scene", false);
    status("Waiting for Owlbear to finish opening the scene…");
    try {
      const available = ready ?? await OBR.scene.isReady();
      if (request !== generation) return;
      if (!available) {
        status("Open a scene to configure Discord Arrivals.");
        return;
      }
      const metadata = await OBR.scene.getMetadata();
      if (request !== generation) return;
      cfg = {...defaults, ...metadata[CONFIG]};
      el("enabled").checked = cfg.enabled;
      el("worker").value = cfg.worker ?? "";
      select.value = cfg.vision;
      el("radius").value = cfg.radius;
      render();
      setVisible("gm", true);
      status("");
    } catch (error) {
      if (request === generation) readableError(error);
    } finally {
      if (request === generation && !cfg) setVisible("check-scene", true);
    }
  }
  listen("check-scene", () => loadScene());
  OBR.scene.onReadyChange((ready) => { void loadScene(ready); });
  await loadScene();
}

async function focusToken(tokenId) {
  const [bounds, dpi, viewportWidth, viewportHeight] = await Promise.all([
    OBR.scene.items.getItemBounds([tokenId]),
    OBR.scene.grid.getDpi(),
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  const minimumSpan = 10 * dpi;
  const maxArrivalZoom = 0.75;
  const width = Math.max(bounds.width, minimumSpan, viewportWidth / maxArrivalZoom);
  const height = Math.max(bounds.height, minimumSpan, viewportHeight / maxArrivalZoom);
  const { x, y } = bounds.center;
  await OBR.viewport.animateToBounds({
    center: bounds.center, width, height,
    min: { x: x - width / 2, y: y - height / 2 },
    max: { x: x + width / 2, y: y + height / 2 },
  });
}

async function setupPlayer() {
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
    listen("find-token", () => focusToken(existing.id));
    setVisible("find-token", true);
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
      connect.disabled = true;
      el("paste-details").hidden = true;
      status(data.needsVision ? "Your token is ready. The GM can enable Smoke & Spectre vision on it." : "Your token is ready.");
      listen("continue-to-tutorial", async () => {
        await OBR.broadcast.sendMessage("chat.overhead.arrival-guide.v1", {
          tokenId: token.id, closeWelcome: welcome,
        }, { destination: "LOCAL" });
      });
      setVisible("continue-to-tutorial", true);
      listen("find-token", () => focusToken(token.id));
      setVisible("find-token", true);
      try {
        await focusToken(token.id);
      } catch {
        // The token stays ready if this client cannot move the camera.
      }
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
  status(linked ? "Your linked token isn’t available in this scene. Connect Discord to recover it." : "");
}

async function waitForPlayerScene() {
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    unsubscribe();
    await setupPlayer();
  };
  const unsubscribe = OBR.scene.onReadyChange((ready) => {
    if (ready) void start().catch(readableError);
  });
  if (await OBR.scene.isReady()) await start();
  else if (!started) status("Waiting for the GM to open a scene…");
}

OBR.onReady(async () => {
  try {
    if (await OBR.player.getRole() === "GM") await setupGM();
    else await waitForPlayerScene();
  } catch (error) {
    readableError(error);
  }
});
