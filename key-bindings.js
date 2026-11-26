import { SKILLS, aimsAtLocation, readSkills } from "./skills.js?v=2.11.0";

const SHIFT = 1;
const CTRL = 2;
const ALT = 4;
const META = 8;
export const MODIFIERS = [[SHIFT, "Shift"], [CTRL, "Ctrl"], [ALT, "Alt"], [META, "Meta"]];
const chord = (code, modifiers = 0) => ({ code, modifiers });
export const modifierMask = (event) => (event.shiftKey ? SHIFT : 0) | (event.ctrlKey ? CTRL : 0) |
  (event.altKey ? ALT : 0) | (event.metaKey ? META : 0);

export const KEYBOARD_ROWS = [
  "Escape Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace",
  "Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Backslash",
  "CapsLock KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Enter",
  "IntlBackslash KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash IntlRo IntlYen ArrowUp",
  "Space ArrowLeft ArrowDown ArrowRight Insert Delete Home End PageUp PageDown",
  "NumLock NumpadDivide NumpadMultiply NumpadSubtract Numpad7 Numpad8 Numpad9 NumpadAdd Numpad4 Numpad5 Numpad6 Numpad1 Numpad2 Numpad3 NumpadEnter Numpad0 NumpadDecimal",
].map((row) => row.split(" "));

const printed = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", IntlBackslash: "<>",
  IntlRo: "ろ", IntlYen: "¥", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  NumpadAdd: "+", NumpadSubtract: "-", NumpadMultiply: "*", NumpadDivide: "/", NumpadDecimal: ".",
  Escape: "Esc", Backspace: "Bksp", CapsLock: "Caps", PageUp: "PgUp", PageDown: "PgDn",
};
const codeSet = new Set(KEYBOARD_ROWS.flat());
const keyCodes = new Map([
  ...[...codeSet].filter((code) => !code.startsWith("Numpad") && !code.startsWith("Intl"))
    .map((code) => [code.replace(/^(Key|Digit)/, "").toLowerCase(), code]),
  ...Object.entries(printed).filter(([code]) => !code.startsWith("Numpad") && !code.startsWith("Intl"))
    .map(([code, label]) => [label.toLowerCase(), code]),
  [" ", "Space"],
]);
const plain = (code) => printed[code] ?? code.replace(/^(Key|Digit|Numpad)/, "");

const commands = [];
function add(id, label, code, props = {}) {
  commands.push({ id, label, defaultKey: code ? chord(code) : null, ...props });
}
const room = { group: "Room", scene: true };
add("hotbar-toggle", "Show / hide hotbar", "Equal", room);
add("hotbar-mode", "Switch hotbar mode", "Minus", room);
add("keyboard", "Open keyboard settings", "Slash", room);
add("move-mode", "Toggle move mode", null, room);
add("combat-log", "Open combat log", null, room);

for (const [dir, label, letter, arrow, offset] of [
  ["up", "up", "KeyW", "ArrowUp", [0, -1]], ["left", "left", "KeyA", "ArrowLeft", [-1, 0]],
  ["down", "down", "KeyS", "ArrowDown", [0, 1]], ["right", "right", "KeyD", "ArrowRight", [1, 0]],
]) {
  add("move-" + dir, "Move / aim " + label, letter, { group: "Movement", offset });
  add("arrow-" + dir, "Move " + label + " (alternate)", arrow, { group: "Movement", offset, alternate: true });
  const half = offset.map((value) => value / 2);
  add("half-" + dir, "Half-step " + label, null, { group: "Movement", offset: half, half: true, base: "move-" + dir, modifiers: SHIFT });
  add("half-arrow-" + dir, "Half-step " + label + " (alternate)", null, {
    group: "Movement", offset: half, half: true, base: "arrow-" + dir, modifiers: SHIFT,
  });
}
add("rotate-left", "Turn left 15°", "KeyQ", { group: "Movement", rotation: -15 });
add("rotate-right", "Turn right 15°", "KeyE", { group: "Movement", rotation: 15 });
add("comma-turn", "Turn left 15° (alternate)", "Comma", { group: "Movement", rotation: -15 });
add("period-turn", "Turn right 15° (alternate)", "Period", { group: "Movement", rotation: 15 });
add("quarter-left", "Turn left 90°", null, { group: "Movement", rotation: -90, base: "rotate-left", modifiers: SHIFT });
add("quarter-right", "Turn right 90°", null, { group: "Movement", rotation: 90, base: "rotate-right", modifiers: SHIFT });
add("mirror", "Flip avatar", "KeyR", { group: "Movement", mirror: true });
add("target", "Open / clear targeting", "KeyZ", { group: "Targeting and chat" });
add("confirm", "Confirm aim / return to chat", "Space", { group: "Targeting and chat" });
add("cancel", "Cancel / exit move mode", "Escape", { group: "Targeting and chat" });
add("send", "Send chat / exit move mode", "Enter", { group: "Targeting and chat" });
add("save-options", "Open combat save options", null, { group: "Targeting and chat", base: "arrow-down", modifiers: ALT });
for (const digit of "1234567890") {
  add("slot-" + digit, "Quickbar " + digit + " / choice " + digit, "Digit" + digit, { group: "Quickbar", digit });
  add("aim-slot-" + digit, "Aim quickbar spell " + digit, null, {
    group: "Quickbar", digit, aim: true, base: "slot-" + digit, modifiers: CTRL,
  });
  add("upcast-slot-" + digit, "Aim and upcast quickbar spell " + digit, null, {
    group: "Quickbar", digit, aim: true, upcast: true, base: "slot-" + digit, modifiers: CTRL | SHIFT,
  });
}
for (const [id, skill] of Object.entries(SKILLS)) {
  const base = "skill-" + id;
  add(base, skill.name, keyCodes.get(skill.key), { group: "Skills", skill: id });
  if (skill.upcast) add("upcast-" + id, "Upcast " + skill.name, null, {
    group: "Skills", skill: id, upcast: true, base, modifiers: SHIFT,
  });
  if (Number.isInteger(skill.spellLevel) && aimsAtLocation(id)) {
    add("aim-" + id, "Aim " + skill.name, null, {
      group: "Skills", skill: id, aim: true, base, modifiers: CTRL,
    });
    if (skill.upcast) add("aim-upcast-" + id, "Aim and upcast " + skill.name, null, {
      group: "Skills", skill: id, aim: true, upcast: true, base, modifiers: CTRL | SHIFT,
    });
  }
}

export const KEY_ACTIONS = Object.fromEntries(commands.map((action) => [action.id, action]));
export const FIXED_KEYS = [
  ["F1", "Chat"], ["F2", "Move"], ["F3", "Center avatar"], ["F4", "Camera follow"], ["F10", "Keyboard settings"],
];

export function editableTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]"));
}

export function keyIdentity(event) {
  return event.code && event.code !== "Unidentified"
    ? event.code : keyCodes.get(event.key?.toLowerCase());
}

export function eventChord(event) {
  if (event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return;
  const code = keyIdentity(event);
  if (!codeSet.has(code)) return;
  return chord(code, modifierMask(event));
}

function signature(binding) {
  return binding && binding.code + ":" + binding.modifiers;
}

function isBaseBinding(binding) {
  return binding === null || codeSet.has(binding?.code) && binding.modifiers === 0;
}

function baseOverrides(overrides) {
  return Object.fromEntries(Object.entries(overrides ?? {}).filter(([id, binding]) =>
    Object.hasOwn(KEY_ACTIONS, id) && !KEY_ACTIONS[id].base && isBaseBinding(binding)));
}

export function legacyOverrides(legacy) {
  const overrides = {};
  for (const [id, key] of Object.entries(legacy ?? {})) {
    if (!Object.hasOwn(SKILLS, id)) continue;
    if (key === "") overrides["skill-" + id] = null;
    else if (typeof key === "string" && /^[a-z]$/.test(key)) overrides["skill-" + id] = chord(keyCodes.get(key));
  }
  return overrides;
}

export function resolveBindings(overrides = {}) {
  const bindings = {};
  const occupied = new Set();
  function place(id, binding) {
    const key = signature(binding);
    bindings[id] = !key || occupied.has(key) ? null : binding;
    if (bindings[id]) occupied.add(key);
  }
  for (const action of commands) {
    if (!action.base && Object.hasOwn(overrides, action.id) && isBaseBinding(overrides[action.id])) place(action.id, overrides[action.id]);
  }
  for (const action of commands) {
    if (!Object.hasOwn(bindings, action.id) && !action.base) place(action.id, action.defaultKey);
  }
  for (const action of commands) {
    if (Object.hasOwn(bindings, action.id)) continue;
    const base = bindings[action.base];
    place(action.id, base ? chord(base.code, action.modifiers) : null);
  }
  return bindings;
}

export function assignBinding(overrides, id, next) {
  if (!Object.hasOwn(KEY_ACTIONS, id) || KEY_ACTIONS[id].base || !isBaseBinding(next)) return overrides;
  const old = resolveBindings(overrides);
  const key = signature(next);
  const replaced = key && Object.keys(old).find((other) => other !== id && signature(old[other]) === key);
  return { ...baseOverrides(overrides), ...(replaced ? { [replaced]: null } : {}), [id]: next };
}

export function actionForEvent(bindings, event) {
  return actionForChord(bindings, eventChord(event));
}

export function actionForChord(bindings, pressed) {
  const key = signature(pressed);
  if (!key) return;
  const id = Object.keys(bindings).find((name) => signature(bindings[name]) === key);
  return KEY_ACTIONS[id];
}

export function keyLabel(code, layout = {}) {
  return layout[code]?.toUpperCase() || plain(code);
}

export function bindingLabel(binding, layout) {
  if (!binding) return "unassigned";
  return [...MODIFIERS.filter(([bit]) => binding.modifiers & bit).map(([, label]) => label),
    (binding.code.startsWith("Numpad") ? "Num " : "") + keyLabel(binding.code, layout)].join("+");
}

export function bindingStorageKey(obr) {
  return JSON.stringify(["chat.overhead.keyboard.v1", obr.room.id, obr.player.id]);
}

export function readKeyboard(obr) {
  try {
    const saved = JSON.parse(localStorage.getItem(bindingStorageKey(obr)));
    if (saved?.overrides && saved.layout) return { overrides: baseOverrides(saved.overrides), layout: saved.layout };
  } catch {}
  return { overrides: legacyOverrides(readSkills(obr, "player").bindings), layout: {} };
}

export function writeKeyboard(obr, settings) {
  localStorage.setItem(bindingStorageKey(obr), JSON.stringify({ ...settings, overrides: baseOverrides(settings.overrides) }));
}

export async function browserLayout(keyboard = globalThis.navigator?.keyboard) {
  try {
    const map = await keyboard?.getLayoutMap();
    return Object.fromEntries([...map ?? []].filter(([code, key]) => codeSet.has(code) && key.length > 0 && key.length < 8));
  } catch {
    return {};
  }
}

export function mapShortcut(binding, layout) {
  if (!binding || binding.code.startsWith("Numpad")) return;
  const { code, modifiers } = binding;
  const symbol = /^[A-Za-z0-9]$/.test(plain(code)) || printed[code]?.length === 1 &&
    !code.startsWith("Arrow") ? plain(code) : code;
  const key = layout[code] ?? symbol;
  if (["Dead", "Unidentified", "+", "AltGraph"].includes(key) || code.startsWith("Intl") && !layout[code]) return;
  const name = code === "Space" ? "space" : key.toLowerCase();
  return [...MODIFIERS.filter(([bit]) => modifiers & bit).map(([, word]) => word.toLowerCase()), name].join("+");
}

const profiles = new Map();
export function keyboardProfile(obr) {
  const key = bindingStorageKey(obr);
  let raw;
  try { raw = localStorage.getItem(key); } catch {}
  let profile = profiles.get(key);
  if (!profile || profile.raw !== raw) {
    const settings = readKeyboard(obr);
    profile = { raw, ...settings, bindings: resolveBindings(settings.overrides) };
    profiles.set(key, profile);
  }
  return profile;
}
