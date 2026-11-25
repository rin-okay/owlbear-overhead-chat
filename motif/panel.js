import OBR from "./obr.js";
import { loadMix, warm } from "./audio.js";
import { BUILT_INS, EMPTY, KEY, LOCAL, REPLY, REQUEST } from "./model.js";

const $ = id => document.getElementById(id);
const editor = $("editor");
const form = $("edit-form");
const controls = form.elements;
const mix = loadMix();
const pending = new Map();
const ALL = { destination: "ALL" };
const HERE = { destination: "LOCAL" };
let state = EMPTY;
let gm = false;
let self;
let chosen;
let editing;
let view = "library";

function status(message = "") { $("notice").textContent = message; }

function make(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, task) {
  const node = make("button", "", label);
  node.type = "button";
  node.addEventListener("click", task);
  return node;
}

function send(channel, request, options = ALL) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => settle(Error("Motif didn’t receive a GM reply.")), 5500);
    function settle(error) {
      pending.delete(requestId);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    }
    pending.set(requestId, settle);
    void OBR.broadcast.sendMessage(channel, { requestId, ...request }, options).catch(settle);
  });
}

async function action(request) {
  status();
  try { await send(REQUEST, request); }
  catch (error) { status(error.message); }
}

function choose(cue) {
  chosen = cue.id;
  localStorage.setItem(KEY + "/selected/" + OBR.room.id, cue.id);
  renderLibrary();
  $("cue-list").querySelector('[aria-pressed="true"]')?.focus();
}

async function play() {
  if ($("play").disabled) return;
  status();
  try { await send(LOCAL, { type: "panel-play", cueId: chosen }, HERE); }
  catch (error) { status(error.message); }
}

function available() { return [...BUILT_INS, ...state.cues].filter(cue => gm || cue.allowPlayers); }

function row(cue, select) {
  const node = make("article", "cue");
  const head = make("div", "cue-heading");
  const name = select ? button(cue.name, () => choose(cue)) : make("span", "", cue.name);
  name.className = "cue-name";
  if (select) {
    name.setAttribute("aria-pressed", String(cue.id === chosen));
    node.classList.toggle("selected", cue.id === chosen);
  }
  head.append(make("span", "cue-kind", cue.kind === "music" ? "Music" : "SFX"), name);
  node.append(head);
  return node;
}

function renderLibrary() {
  const all = available();
  const query = $("search").value.trim().toLowerCase();
  const type = $("filter").value;
  const matches = all.filter(cue => (!type || cue.kind === type) &&
    [cue.name, cue.tags, cue.id].join(" ").toLowerCase().includes(query));
  const list = $("cue-list");
  const scroll = list.scrollTop;
  list.replaceChildren();
  for (const cue of matches) {
    const node = row(cue, true);
    const custom = state.cues.some(item => item.id === cue.id);
    const detail = [cue.tags, gm ? cue.id : ""].filter(Boolean).join(" · ");
    if (detail) node.append(make("div", "cue-detail", detail));
    if (gm && (custom || cue.id === chosen)) {
      const tools = make("div", "cue-actions");
      if (cue.id === chosen) tools.append(button("Cache audio", async () => {
        status("Caching " + cue.name + "…");
        status(await warm(cue.url) ? "Audio cached on this device." : "This file couldn’t be cached. Motif can still try streaming it.");
      }));
      if (custom) {
        tools.append(button("Edit", () => edit("cue", cue)));
        tools.append(button("Remove", () => {
          if (window.confirm("Remove " + cue.name + " from the library?")) void action({ type: "delete", cueId: cue.id });
        }));
      }
      node.append(tools);
    }
    list.append(node);
  }
  if (!matches.length) list.append(make("p", "empty", all.length ? "No matching sounds." : "The GM hasn’t enabled any player-triggerable sounds."));
  list.scrollTop = scroll;
  $("play").disabled = !all.some(cue => cue.id === chosen);
}

function renderActive() {
  const entries = gm ? state.active : state.active.filter(entry => !entry.hidden);
  $("active-count").textContent = entries.length;
  $("stop-all").hidden = !gm || !entries.length;
  const list = $("active-list");
  list.replaceChildren();
  for (const entry of entries) {
    const node = row(entry);
    const details = [entry.hidden ? "Hidden" : entry.since === null ? "Paused" : "Playing"];
    if (entry.loop) details.push("Loop");
    details.push(Math.round(entry.volume * 100) + "%");
    if (entry.start || entry.end !== null) details.push(entry.start + "–" + (entry.end ?? "end") + " s");
    node.append(make("div", "cue-detail", details.join(" · ")));
    if (gm) {
      const tools = make("div", "cue-actions");
      const op = (label, type) => button(label, () => void action({ type, entryId: entry.id }));
      tools.append(op(entry.since === null ? "Resume" : "Pause", entry.since === null ? "resume" : "pause"),
        op(entry.hidden ? "Show / unmute" : "Hide / mute", "hide"),
        button("Edit", () => edit("active", entry)), op("Stop", "stop"));
      node.append(tools);
    }
    list.append(node);
  }
  if (!entries.length) list.append(make("p", "empty", "Nothing playing."));
}

function changeView(next) {
  view = next;
  $("show-library").setAttribute("aria-pressed", String(view === "library"));
  $("show-active").setAttribute("aria-pressed", String(view === "active"));
  $("library").hidden = view !== "library";
  $("active-view").hidden = view !== "active";
}

function edit(type, cue) {
  editing = { type, id: cue?.id };
  $("editor-title").textContent = cue ? "Edit " + cue.name : "Add sound";
  const source = type === "cue";
  $("source-fields").hidden = !source;
  controls.name.required = controls.url.required = source;
  controls.name.value = source ? cue?.name ?? "" : "";
  controls.url.value = source ? cue?.url ?? "" : "";
  controls.tags.value = source ? cue?.tags ?? "" : "";
  controls.kind.value = cue?.kind ?? "sfx";
  controls.allowPlayers.checked = cue?.allowPlayers ?? false;
  controls.start.value = cue?.start ?? 0;
  controls.end.value = cue?.end ?? "";
  controls.volume.value = Math.round((cue?.volume ?? .8) * 100);
  controls.loop.checked = cue?.loop ?? false;
  $("edit-error").textContent = "";
  editor.showModal();
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const config = {
    start: Number(controls.start.value), end: controls.end.value === "" ? null : Number(controls.end.value),
    volume: Number(controls.volume.value) / 100, loop: controls.loop.checked,
  };
  const request = editing.type === "active" ? { type: "edit", entryId: editing.id, settings: config } : {
    type: "save", cueId: editing.id,
    cue: { ...config, name: controls.name.value, url: controls.url.value, tags: controls.tags.value,
      kind: controls.kind.value, allowPlayers: controls.allowPlayers.checked },
  };
  try {
    await send(REQUEST, request);
    editor.close();
  } catch (error) { $("edit-error").textContent = error.message; }
  finally { submit.disabled = false; }
});

$("show-library").onclick = () => changeView("library");
$("show-active").onclick = () => changeView("active");
$("search").oninput = $("filter").onchange = renderLibrary;
$("play").onclick = play;
$("add").onclick = () => edit("cue");
$("cancel").onclick = () => editor.close();
$("stop-all").onclick = () => void action({ type: "stop-all" });
$("enable-audio").onclick = () => {
  void OBR.broadcast.sendMessage(LOCAL, { type: "open-listener" }, HERE).catch(error => status(error.message));
};
for (const [id, kind] of [["music-volume", "music"], ["effects-volume", "sfx"]]) {
  const input = $(id);
  input.value = mix[kind] * 100;
  input.oninput = () => {
    mix[kind] = Number(input.value) / 100;
    localStorage.setItem(KEY + "/mix", JSON.stringify(mix));
    void OBR.broadcast.sendMessage(LOCAL, { type: "mix" }, HERE).catch(error => status(error.message));
  };
}

function showState(metadata) {
  state = metadata[KEY] ?? EMPTY;
  renderLibrary();
  renderActive();
}

if (!OBR.isAvailable) status("Open Motif from an Owlbear Rodeo room.");
else OBR.onReady(async () => {
  try {
    const [role, connection, metadata] = await Promise.all([OBR.player.getRole(), OBR.player.getConnectionId(), OBR.room.getMetadata()]);
    gm = role === "GM";
    self = connection;
    chosen = localStorage.getItem(KEY + "/selected/" + OBR.room.id);
    $("room-role").textContent = gm ? "GM controls" : "Room audio";
    $("app").hidden = false;
    $("add").hidden = !gm;
    status();
    showState(metadata);
    OBR.room.onMetadataChange(showState);
    OBR.broadcast.onMessage(REPLY, ({ data, connectionId }) => {
      const settle = data?.connectionId === self && pending.get(data.requestId);
      if (!settle) return;
      void OBR.party.getPlayers().then(players => {
        if ((gm && connectionId === self) || players.some(player => player.role === "GM" && player.connectionId === connectionId)) {
          settle(data.error ? Error(data.error) : undefined);
        }
      }).catch(console.warn);
    });
    OBR.broadcast.onMessage(LOCAL, ({ data, connectionId }) => {
      if (self !== connectionId) return;
      if (data?.type === "blocked") $("enable-audio").hidden = false;
      if (data?.type === "error") status("Couldn’t play " + data.name + ". Check the file link and format.");
    });
    await OBR.broadcast.sendMessage(LOCAL, { type: "status" }, HERE);
  } catch (error) { status(error.message); }
});
