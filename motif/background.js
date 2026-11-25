import OBR, { buildShape } from "./obr.js";
import { createEngine, loadMix } from "./audio.js";
import { applyRequest, elapsed, EMPTY, KEY, LOCAL, PLAY, REPLY, REQUEST } from "./model.js";

const TOOL = KEY + "/tool";
const MODE = TOOL + "/target";
const LISTENER = KEY + "/listener";
const ICON = new URL("./icon.svg", import.meta.url).href;
const ALL = { destination: "ALL" };
const HERE = { destination: "LOCAL" };
const recentlyPlayed = new Map();
let current = EMPTY;
let queue = Promise.resolve();
let target;
let targetVersion = 0;
let needsAudio = false;
let listenerUntil = 0;
let sceneVersion = 0;

function report(error) {
  console.warn("Motif", error);
}

function notify(message) {
  void OBR.notification.show(message).catch(report);
}

async function authority() {
  const [connectionId, role, party] = await Promise.all([
    OBR.player.getConnectionId(), OBR.player.getRole(), OBR.party.getPlayers(),
  ]);
  const self = { id: OBR.player.id, connectionId, role };
  const people = [self, ...party.filter(player => player.connectionId !== connectionId)];
  const host = people.filter(player => player.role === "GM").sort((a, b) =>
    a.id.localeCompare(b.id) || a.connectionId.localeCompare(b.connectionId))[0];
  return { connectionId, people, hosting: host?.connectionId === connectionId, host: host?.connectionId };
}

function receiveState(metadata) {
  current = metadata[KEY] ?? EMPTY;
  engine.render(current.active);
}

function submit(request, sender, connectionId, { silent = false } = {}) {
  queue = queue.then(async () => {
    const info = await authority();
    if (!info.hosting) return;
    const actor = info.people.find(player => player.connectionId === sender);
    if (!actor) return;
    const now = Date.now();
    const gm = actor.role === "GM";
    let error;
    try {
      if (!gm && request.type === "play" && now - (recentlyPlayed.get(sender) ?? 0) < 900) {
        throw Error("Wait a moment before playing another cue.");
      }
      const metadata = await OBR.room.getMetadata();
      const state = metadata[KEY] ?? EMPTY;
      const next = applyRequest(state, request, { now, gm, id: crypto.randomUUID(), owner: actor.id });
      if (next !== state) {
        if (new TextEncoder().encode(JSON.stringify(next)).length > 14000) throw Error("Room audio data is full. Remove a custom cue or stop an active one.");
        await OBR.room.setMetadata({ [KEY]: next });
        receiveState({ [KEY]: next });
        if (!gm) recentlyPlayed.set(sender, now);
        if (request.type === "play") {
          const point = request.target;
          if (Number.isFinite(point?.x) && Number.isFinite(point?.y) && await OBR.scene.isReady()) {
            void OBR.broadcast.sendMessage(KEY + "/ripple", { point, since: now }, ALL).catch(report);
          }
        }
      }
    } catch (cause) { error = cause.message || "Couldn’t update room audio."; }
    if (!silent && typeof request.requestId === "string") {
      await OBR.broadcast.sendMessage(REPLY, { requestId: request.requestId, connectionId, error }, ALL);
    }
  }).catch(report);
}

function send(request) {
  return OBR.broadcast.sendMessage(REQUEST, request, ALL);
}

function finish(entry) {
  if (listenerUntil > Date.now()) return;
  void OBR.player.getConnectionId().then(id => {
    const { id: entryId, since, start, end } = entry;
    submit({ type: "finish", entryId, since, start, end }, id, id, { silent: true });
  }).catch(report);
}

const engine = createEngine({
  onBlocked() {
    needsAudio = true;
    void OBR.broadcast.sendMessage(LOCAL, { type: "blocked" }, HERE).catch(report);
    void OBR.action.setBadgeText("!").catch(report);
  },
  onFinish: finish,
  onError(entry) {
    void OBR.broadcast.sendMessage(LOCAL, { type: "error", name: entry.name }, HERE).catch(report);
  },
});

async function ripple({ point, since }) {
  const version = sceneVersion;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Number.isFinite(since) ||
      Date.now() - since > 4000 || !await OBR.scene.isReady()) return;
  const dpi = await OBR.scene.grid.getDpi();
  if (version !== sceneVersion || !Number.isFinite(dpi) || dpi <= 0) return;
  const ring = buildShape().shapeType("CIRCLE").name("Motif ripple").layer("POINTER")
    .position(point).width(dpi * .25).height(dpi * .25).locked(true).disableHit(true)
    .fillOpacity(0).strokeColor("#8de1c9").strokeWidth(dpi * .036).build();
  await OBR.scene.local.addItems([ring]);
  try {
    for (let step = 1; step <= 8 && version === sceneVersion; step++) {
      await new Promise(resolve => setTimeout(resolve, 65));
      if (version !== sceneVersion) break;
      await OBR.scene.local.updateItems([ring.id], ([item]) => {
        if (!item) return;
        item.width = item.height = dpi * (.25 + step * .14);
        item.style.strokeOpacity = 1 - step / 9;
      });
    }
  } finally {
    if (version === sceneVersion) await OBR.scene.local.deleteItems([ring.id]);
  }
}

async function clearTarget() {
  targetVersion++;
  const marker = target?.marker;
  target = undefined;
  if (marker && await OBR.scene.isReady()) await OBR.scene.local.deleteItems([marker]);
}

async function selectTarget(event) {
  const old = target;
  const version = ++targetVersion;
  target = undefined;
  if (old?.marker) await OBR.scene.local.deleteItems([old.marker]);
  const [point, dpi] = await Promise.all([
    OBR.scene.grid.snapPosition(event.target?.position ?? event.pointerPosition, 1, false, true),
    OBR.scene.grid.getDpi(),
  ]);
  if (version !== targetVersion || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
  const marker = buildShape().shapeType("CIRCLE").name("Motif target").layer("POINTER")
    .position(point).width(dpi * .42).height(dpi * .42).locked(true).disableHit(true)
    .fillOpacity(0).strokeColor("#8de1c9").strokeWidth(dpi * .036).build();
  target = { point, marker: marker.id };
  await OBR.scene.local.addItems([marker]);
  if (version !== targetVersion && await OBR.scene.isReady()) await OBR.scene.local.deleteItems([marker.id]);
}

async function openBrowser() { await OBR.action.open(); }

async function playSelected() {
  const cueId = localStorage.getItem(KEY + "/selected/" + OBR.room.id);
  if (!cueId) {
    notify("Select a sound in Motif first.");
    return;
  }
  await send({ type: "play", cueId, target: target?.point, requestId: crypto.randomUUID() });
}

async function registerTool() {
  await OBR.tool.create({ id: TOOL, defaultMode: MODE, shortcut: "Shift+C",
    icons: [{ icon: ICON, label: "Motif" }] });
  const filter = { activeTools: [TOOL] };
  await OBR.tool.createMode({
    id: MODE, icons: [{ icon: new URL("./target.svg", import.meta.url).href, label: "Select optional target", filter }],
    onToolClick: (_, event) => { void selectTarget(event).catch(report); return false; },
    onDeactivate: () => void clearTarget().catch(report),
  });
  await Promise.all([
    ["browse", "Select sound", ".", openBrowser],
    ["play", "Play selected sound", "Enter", playSelected],
    ["clear", "Clear sound target", "X", clearTarget],
  ].map(([id, label, shortcut, handler]) => OBR.tool.createAction({
    id: TOOL + "/" + id, shortcut, icons: [{ icon: new URL("./" + id + ".svg", import.meta.url).href, label, filter }],
    onClick: () => void handler().catch(report),
  })));
}

OBR.onReady(async () => {
  OBR.room.onMetadataChange(receiveState);
  OBR.scene.onReadyChange(() => {
    sceneVersion++;
    targetVersion++;
    target = undefined;
  });
  OBR.party.onChange(people => {
    for (const id of recentlyPlayed.keys()) if (!people.some(player => player.connectionId === id)) recentlyPlayed.delete(id);
  });
  OBR.broadcast.onMessage(REQUEST, ({ data, connectionId }) => {
    if (typeof data?.type !== "string") return;
    submit(data, connectionId, connectionId);
  });
  OBR.broadcast.onMessage(PLAY, ({ data, connectionId }) => {
    if (typeof data?.cueId !== "string") return;
    submit({ type: "play", cueId: data.cueId, target: data.target, requestId: data.requestId }, connectionId, connectionId);
  });
  OBR.broadcast.onMessage(KEY + "/ripple", ({ data, connectionId }) => {
    if (!data) return;
    void authority().then(info => {
      if (info.host === connectionId) return ripple(data);
    }).catch(report);
  });
  OBR.broadcast.onMessage(REPLY, ({ data, connectionId }) => {
    if (!data?.error) return;
    void authority().then(info => {
      if (info.host === connectionId && info.connectionId === data.connectionId) notify(data.error);
    }).catch(report);
  });
  const self = await OBR.player.getConnectionId();
  OBR.broadcast.onMessage(LOCAL, ({ data, connectionId }) => {
    if (self !== connectionId || !data) return;
    if (data.type === "mix") engine.setMix(loadMix());
    if (data.type === "status" && needsAudio) void OBR.broadcast.sendMessage(LOCAL, { type: "blocked" }, HERE).catch(report);
    if (data.type === "panel-play") void send({ type: "play", cueId: data.cueId, target: target?.point, requestId: data.requestId }).catch(report);
    if (data.type === "listener") {
      listenerUntil = Date.now() + 5500;
      engine.suspend(true);
      void OBR.action.setBadgeText(undefined).catch(report);
    }
    if (data.type === "listener-closed") listenerUntil = 0;
    if (data.type === "finished" && listenerUntil > Date.now() && typeof data.id === "string") {
      const { id: entryId, since, start, end } = data;
      submit({ type: "finish", entryId, since, start, end }, self, self, { silent: true });
    }
    if (data.type === "open-listener") {
      void OBR.popover.open({
        id: LISTENER, url: new URL("./listener.html", import.meta.url).href,
        width: 230, height: 78, anchorReference: "POSITION",
        anchorPosition: { left: 12, top: 110 }, disableClickAway: true,
      }).catch(report);
    }
  });
  receiveState(await OBR.room.getMetadata());
  void registerTool().catch(report);
  let fallback = false;
  setInterval(() => {
    const usingListener = listenerUntil > Date.now();
    if (fallback !== usingListener) {
      fallback = usingListener;
      engine.suspend(fallback);
    }
    if (current.active.some(entry => !entry.loop && entry.end !== null && elapsed(entry, Date.now()) >= entry.end - entry.start)) {
      submit({ type: "prune" }, self, self, { silent: true });
    }
  }, 1800);
});
