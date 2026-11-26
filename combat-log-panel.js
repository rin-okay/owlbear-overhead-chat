import { actionForEvent, keyboardProfile } from "./key-bindings.js?v=2.11.4";
import OBR from "./obr.js";
import { COMBAT_POPOVER, damageNotation, formatCombatDamage, openCombatChannel } from "./combat-log.js?v=2.11.4";
import { appliedCombatDamage, applyForgeDamage, forgeHpKey, hasForgeHp, undoForgeDamage } from "./forge-hp.js?v=2.9.7";

const combatWindow = document.querySelector("#combat-window");
const entries = document.querySelector("#combat-entries");
const empty = document.querySelector("#combat-empty");
const displayed = new Map();
let role;
let hpKey;
let tokens = new Map();
let sceneVersion = 0;
let rollSave;
let rollDamage;

export function setCombatRollers(saveRoller, damageRoller) {
  rollSave = saveRoller;
  rollDamage = damageRoller;
}

function restoreMovementFocus(control) {
  if (control.contains(document.activeElement)) combatWindow.focus({ preventScroll: true });
}

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
  const pending = Boolean(entry.damageFormula && !entry.damage);
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
  (entry.damage || pending ? full : custom).checked = true;
  const button = document.createElement("button");
  button.type = "submit";
  button.className = "compact-button apply-button";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "compact-button undo";
  undo.textContent = "⟲";
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
    const hidden = role !== "GM" || (!applied && !ready);
    if (hidden) restoreMovementFocus(form);
    form.hidden = hidden;
    choices.forEach((input) => { input.disabled = pending || applied || busy || (!entry.damage && input !== custom); });
    button.disabled = pending || applied || busy;
    const healing = receipt < 0;
    const result = applied ? Math.abs(receipt) + " " + (healing ? "healing" : entry.damage?.type || "damage") : "";
    button.textContent = result || "apply";
    button.title = result;
    button.classList.toggle("applied", applied);
    button.classList.toggle("hp-lost", receipt > 0);
    button.classList.toggle("hp-restored", healing);
    button.setAttribute("aria-label", applied
      ? result + " applied to " + target.name : "apply damage to " + target.name);
    undo.hidden = !applied;
    undo.title = healing ? "undo healing" : "undo damage";
    undo.setAttribute("aria-label", undo.title + " to " + target.name);
    undo.disabled = busy || !token;
    feedback.hidden = role !== "GM";
    feedback.textContent = error || (!token ? "target unavailable"
      : !ready ? "set this token’s current HP in Forge! to apply damage" : "");
  }

  async function submit(kind, undoing = false) {
    if (pending || busy || form.hidden || role !== "GM") return;
    const version = sceneVersion;
    const current = () => version === sceneVersion && displayed.has(entry.id);
    restoreMovementFocus(form);
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

const saveMenu = document.createElement("div");
saveMenu.className = "save-menu";
saveMenu.popover = "auto";
combatWindow.append(saveMenu);
let menuRoll;
for (const mode of ["advantage", "disadvantage"]) {
  const option = document.createElement("button");
  option.type = "button";
  option.textContent = "roll with " + mode;
  option.addEventListener("click", () => {
    saveMenu.hidePopover();
    combatWindow.focus({ preventScroll: true });
    void menuRoll?.(mode);
  });
  saveMenu.append(option);
}

function showRollError(error, fallback) {
  void OBR.notification.show(error.message || fallback).catch(console.error);
}

function saveControl(entry, hit) {
  const button = document.createElement("button");
  const label = entry.saveAbility + " save";
  button.className = "compact-button save-button";
  button.type = "button";
  button.title = "Click to roll. Right-click for advantage or disadvantage.";
  button.setAttribute("aria-haspopup", "true");
  const update = (total) => {
    button.textContent = total === undefined ? label : label + ": " + total;
    button.setAttribute("aria-label", button.textContent + " for " + hit.name);
  };
  update(entry.saves?.[hit.id]);

  async function roll(mode) {
    if (!rollSave || button.disabled || !button.isConnected) return;
    restoreMovementFocus(button);
    button.disabled = true;
    try {
      await rollSave(entry.id, hit.id, entry.saveAbility, mode);
    } catch (error) {
      showRollError(error, "Couldn’t roll the save.");
    } finally {
      button.disabled = false;
    }
  }
  function openMenu(event) {
    event.preventDefault();
    if (button.disabled) return;
    menuRoll = roll;
    const bounds = button.getBoundingClientRect();
    saveMenu.showPopover();
    const left = Math.max(4, Math.min(bounds.left, window.innerWidth - saveMenu.offsetWidth - 4));
    const top = bounds.bottom + saveMenu.offsetHeight + 4 > window.innerHeight
      ? Math.max(4, bounds.top - saveMenu.offsetHeight - 3) : bounds.bottom + 3;
    saveMenu.style.left = left + "px";
    saveMenu.style.top = top + "px";
    saveMenu.firstElementChild.focus({ preventScroll: true });
  }
  button.addEventListener("click", () => roll("normal"));
  button.addEventListener("contextmenu", openMenu);
  button.addEventListener("keydown", (event) => {
    if (actionForEvent(keyboardProfile(OBR).bindings, event)?.id === "save-options") {
      event.stopPropagation();
      openMenu(event);
    }
  });
  return { button, update };
}

function damageLine(entry) {
  if (entry.damage) return paragraph(formatCombatDamage(entry.damage), "damage");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "damage-roll";
  button.textContent = "(" + damageNotation(entry.damageFormula, true) + " " + entry.damageFormula.type + ")";
  button.setAttribute("aria-label", "roll " + button.textContent);
  button.addEventListener("click", async () => {
    if (!rollDamage || button.disabled) return;
    restoreMovementFocus(button);
    button.disabled = true;
    try {
      await rollDamage(entry);
      // The GM publishes the result separately from the chat roll.
      setTimeout(() => { if (button.isConnected) button.disabled = false; }, 2500);
    } catch (error) {
      button.disabled = false;
      showRollError(error, "Couldn’t roll damage.");
    }
  });
  return button;
}

function createEntry(entry) {
  const item = document.createElement("li");
  item.className = "entry";
  const level = entry.level > 0 ? " (level " + entry.level + ")" : "";
  const multiple = entry.hits.length > 1;
  const heading = !multiple && entry.selected && entry.attack
    ? entry.actor + " attacks " + entry.selected.name + " with " + entry.action + level
    : entry.actor + " uses " + entry.action + level;
  item.append(paragraph(heading, "action"));

  const controls = [];
  const saves = new Map();
  const hasDamageLine = entry.damage || entry.damageFormula;
  if (entry.attack && !entry.hits.length) item.append(paragraph("it misses!", "outcome"));
  if (multiple && hasDamageLine) item.append(damageLine(entry));
  for (const hit of entry.hits) {
    const hitSection = document.createElement("section");
    if (multiple) hitSection.className = "target-line";
    if (multiple || hit.id !== entry.selected?.id || !entry.attack || entry.saveAbility) {
      const text = "it hits " + hit.name + "!";
      const line = paragraph(multiple ? "" : text, "outcome");
      if (multiple) {
        const label = document.createElement("span");
        label.className = "target-name";
        label.textContent = text;
        label.title = text;
        line.append(label);
      }
      if (entry.saveAbility) {
        const { button, update } = saveControl(entry, hit);
        saves.set(hit.id, update);
        line.append(button);
      }
      hitSection.append(line);
    }
    if (!multiple && hasDamageLine) hitSection.append(damageLine(entry));
    if (entry.attack && !entry.damage?.blocked) controls.push(applyControls(entry, hit, hitSection));
    item.append(hitSection);
  }
  return { item, controls, saves, hasDamage: Boolean(entry.damage) };
}

function render(log) {
  const ids = new Set(log.map(({ id }) => id));
  for (const [id, { item }] of displayed) {
    if (ids.has(id)) continue;
    restoreMovementFocus(item);
    item.remove();
    displayed.delete(id);
  }
  const atTop = document.querySelector("#combat-transcript").scrollTop < 12;
  for (const entry of log) {
    const previous = displayed.get(entry.id);
    if (previous?.hasDamage === Boolean(entry.damage)) {
      for (const [id, update] of previous.saves) update(entry.saves?.[id]);
      continue;
    }
    const row = createEntry(entry);
    displayed.set(entry.id, row);
    if (previous) {
      restoreMovementFocus(previous.item);
      previous.item.replaceWith(row.item);
    } else entries.prepend(row.item);
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
    if (saveMenu.matches(":popover-open")) saveMenu.hidePopover();
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
