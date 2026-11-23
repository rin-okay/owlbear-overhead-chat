import OBR from "./obr.js";
import { COMBAT_POPOVER, formatCombatDamage, openCombatChannel } from "./combat-log.js?v=2.8.8";
import { appliedCombatDamage, applyForgeDamage, forgeHpKey, hasForgeHp } from "./forge-hp.js?v=2.8.8";

const entries = document.querySelector("#entries");
const empty = document.querySelector("#empty");
const displayed = new Map();
let role;
let hpKey;
let tokens = new Map();
let sceneVersion = 0;

function paragraph(text, className) {
  const element = document.createElement("p");
  element.textContent = text;
  element.className = className;
  return element;
}

function applyControls(entry, target, parent) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "apply";
  const form = document.createElement("form");
  const mode = document.createElement("select");
  mode.setAttribute("aria-label", "damage amount for " + target.name);
  if (entry.damage) {
    mode.add(new Option("full damage", "full"));
    mode.add(new Option("half damage", "half"));
  }
  mode.add(new Option("custom amount", "custom"));
  const custom = document.createElement("input");
  custom.type = "number";
  custom.min = "0";
  custom.step = "1";
  custom.placeholder = "amount";
  custom.setAttribute("aria-label", "custom damage");
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "apply damage";
  const feedback = paragraph("", "feedback");
  feedback.setAttribute("role", "status");
  let applied;
  let busy = false;
  let error = "";

  function update() {
    const token = tokens.get(target.id);
    const receipt = appliedCombatDamage(token, entry.id) ?? applied;
    const ready = hasForgeHp(token, hpKey);
    details.hidden = role !== "GM" || receipt !== undefined || !ready;
    feedback.hidden = role !== "GM";
    feedback.textContent = receipt !== undefined ? "applied " + receipt + " damage"
      : error || (!token ? "target unavailable" : !ready ? "set this token’s current HP in Forge! to apply damage" : "");
    const manual = mode.value === "custom";
    custom.hidden = !manual;
    custom.required = manual;
    custom.disabled = !manual || busy;
    mode.disabled = button.disabled = busy;
  }

  mode.addEventListener("change", update);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || details.hidden) return;
    const amount = mode.value === "custom" ? custom.valueAsNumber
      : mode.value === "half" ? Math.floor(entry.damage.amount / 2) : entry.damage.amount;
    const version = sceneVersion;
    const current = () => version === sceneVersion && displayed.has(entry.id);
    busy = true;
    error = "";
    update();
    try {
      applied = await applyForgeDamage(OBR, target.id, entry.id, amount, current);
      details.open = false;
    } catch (cause) {
      error = cause.message || "Couldn’t apply damage.";
    } finally {
      busy = false;
      if (current()) update();
    }
  });
  form.append(mode, custom, button);
  details.append(summary, form);
  parent.append(details, feedback);
  update();
  return update;
}

function createEntry(entry) {
  const item = document.createElement("li");
  item.className = "entry";
  const level = entry.level > 0 ? " (level " + entry.level + ")" : "";
  const heading = entry.selected && entry.attack
    ? entry.actor + " attacks " + entry.selected.name + " with " + entry.action + level
    : entry.actor + " uses " + entry.action + level;
  item.append(paragraph(heading, "action"));

  const controls = [];
  if (entry.attack && !entry.hits.length) item.append(paragraph("it misses!", "outcome"));
  for (const hit of entry.hits) {
    const hitSection = document.createElement("section");
    if (hit.id !== entry.selected?.id || !entry.attack) {
      hitSection.append(paragraph("it hits " + hit.name + "!", "outcome"));
    }
    if (entry.damage) hitSection.append(paragraph(formatCombatDamage(entry.damage), "damage"));
    if (entry.attack && !entry.damage?.blocked) controls.push(applyControls(entry, hit, hitSection));
    item.append(hitSection);
  }
  return { item, controls };
}

function render(log) {
  const ids = new Set(log.map(({ id }) => id));
  for (const [id, { item }] of displayed) {
    if (ids.has(id)) continue;
    item.remove();
    displayed.delete(id);
  }
  const atTop = document.querySelector("#log").scrollTop < 12;
  for (const entry of log) {
    if (displayed.has(entry.id)) continue;
    const row = createEntry(entry);
    displayed.set(entry.id, row);
    entries.prepend(row.item);
  }
  if (atTop) document.querySelector("#log").scrollTop = 0;
  empty.hidden = displayed.size > 0;
}

function refreshControls() {
  for (const { controls } of displayed.values()) for (const update of controls) update();
}

function updateItems(items) {
  tokens = new Map(items.map((item) => [item.id, item]));
  refreshControls();
}

OBR.onReady(() => {
  document.querySelector("#close").addEventListener("click", () => void OBR.popover.close(COMBAT_POPOVER));
  OBR.player.onChange((player) => { role = player.role; refreshControls(); });
  OBR.room.onMetadataChange((metadata) => { hpKey = forgeHpKey(metadata); refreshControls(); });
  let itemRevision = 0;
  const loadItems = async () => {
    const revision = ++itemRevision;
    if (!await OBR.scene.isReady()) return;
    const items = await OBR.scene.items.getItems();
    if (revision === itemRevision) updateItems(items);
  };
  OBR.scene.items.onChange((items) => {
    itemRevision++;
    updateItems(items);
  });
  OBR.scene.onReadyChange((ready) => {
    itemRevision++;
    sceneVersion++;
    updateItems([]);
    render([]);
    if (ready) void loadItems().catch(console.error);
  });
  void OBR.player.getRole().then((value) => { role = value; refreshControls(); }).catch(console.error);
  void OBR.room.getMetadata().then((metadata) => {
    hpKey = forgeHpKey(metadata);
    refreshControls();
  }).catch(console.error);
  void loadItems().catch(console.error);
  void openCombatChannel(OBR).then((channel) => {
    channel.onmessage = ({ data }) => { if (data?.type === "entries") render(data.entries); };
    channel.postMessage({ type: "history" });
    window.addEventListener("pagehide", () => channel.close(), { once: true });
  }).catch(console.error);
});
