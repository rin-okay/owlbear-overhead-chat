import OBR from "./obr.js";
import { COMBAT_POPOVER, formatCombatDamage, openCombatChannel } from "./combat-log.js?v=2.8.9";
import { appliedCombatDamage, applyForgeDamage, forgeHpKey, hasForgeHp, undoForgeDamage } from "./forge-hp.js?v=2.8.9";

const entries = document.querySelector("#combat-entries");
const empty = document.querySelector("#combat-empty");
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

const customDialog = document.querySelector("#custom-damage");
const customInput = customDialog.querySelector("input");

function askCustomDamage(target) {
  customDialog.querySelector("label").textContent = "custom damage for " + target.name;
  customDialog.returnValue = "";
  customInput.value = "";
  return new Promise((resolve) => {
    customDialog.addEventListener("close", () => {
      resolve(customDialog.returnValue === "apply" ? customInput.valueAsNumber : undefined);
    }, { once: true });
    customDialog.showModal();
    customInput.focus();
  });
}

function applyControls(entry, target, parent) {
  const form = document.createElement("form");
  form.className = "apply-row";
  form.setAttribute("aria-label", "damage for " + target.name);
  const choices = ["full", "half", "custom"].map((kind) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "damage";
    input.value = kind;
    label.append(input, kind);
    form.append(label);
    return input;
  });
  const [full, , custom] = choices;
  (entry.damage ? full : custom).checked = true;
  const button = document.createElement("button");
  button.type = "submit";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "undo";
  undo.textContent = "⟲";
  undo.title = "undo damage";
  undo.setAttribute("aria-label", "undo damage to " + target.name);
  const feedback = paragraph("", "feedback");
  feedback.setAttribute("role", "status");
  let localReceipt;
  let busy = false;
  let error = "";

  function update() {
    const token = tokens.get(target.id);
    if (localReceipt && localReceipt.token !== token) localReceipt = undefined;
    const receipt = localReceipt ? localReceipt.amount : appliedCombatDamage(token, entry.id);
    const applied = receipt !== undefined;
    const ready = hasForgeHp(token, hpKey);
    form.hidden = role !== "GM" || (!applied && !ready);
    choices.forEach((input) => { input.disabled = applied || busy || (!entry.damage && input !== custom); });
    button.disabled = applied || busy;
    button.textContent = applied ? "✓" : "apply";
    button.classList.toggle("applied", applied);
    button.setAttribute("aria-label", applied ? "damage applied" : "apply damage to " + target.name);
    undo.hidden = !applied;
    undo.disabled = busy || !token;
    feedback.hidden = role !== "GM";
    feedback.textContent = error || (applied ? "applied " + receipt + " damage"
      : !token ? "target unavailable" : !ready ? "set this token’s current HP in Forge! to apply damage" : "");
  }

  async function submit(kind, undoing = false) {
    if (busy || form.hidden || role !== "GM") return;
    const version = sceneVersion;
    const current = () => version === sceneVersion && displayed.has(entry.id);
    busy = true;
    error = "";
    update();
    try {
      const amount = undoing ? undefined : kind === "custom" ? await askCustomDamage(target)
        : kind === "half" ? Math.floor(entry.damage.amount / 2) : entry.damage.amount;
      if ((!undoing && amount === undefined) || !current()) return;
      const before = tokens.get(target.id);
      const applied = undoing
        ? await undoForgeDamage(OBR, target.id, entry.id, current)
        : await applyForgeDamage(OBR, target.id, entry.id, amount, current);
      if (current() && tokens.get(target.id) === before) localReceipt = { token: before, amount: applied };
    } catch (cause) {
      error = cause.message || "Couldn’t update damage.";
    } finally {
      busy = false;
      if (current()) update();
    }
  }

  custom.addEventListener("change", () => { if (custom.checked) void submit("custom"); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!button.disabled) return submit(choices.find((input) => input.checked)?.value);
  });
  undo.addEventListener("click", () => submit(undefined, true));
  form.append(button, undo);
  parent.append(form, feedback);
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
  const atTop = document.querySelector("#combat-transcript").scrollTop < 12;
  for (const entry of log) {
    if (displayed.has(entry.id)) continue;
    const row = createEntry(entry);
    displayed.set(entry.id, row);
    entries.prepend(row.item);
  }
  if (atTop) document.querySelector("#combat-transcript").scrollTop = 0;
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
  document.querySelector("#combat-close").addEventListener("click", () => void OBR.popover.close(COMBAT_POPOVER));
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
    if (customDialog.open) customDialog.close();
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
