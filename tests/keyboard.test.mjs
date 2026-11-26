import assert from "node:assert/strict";
import test from "node:test";
import {
  actionForEvent, assignBinding, bindingLabel, bindingStorageKey, browserLayout, keyboardProfile,
  eventChord, legacyOverrides, resolveBindings, writeKeyboard,
} from "../key-bindings.js";
import { handleRoomKey } from "../keyboard-shortcuts.js";

const event = (code, key, props = {}) => ({ code, key, ...props });
const command = (code, key, props, overrides) => actionForEvent(resolveBindings(overrides), event(code, key, props))?.id;

test("Danish, AZERTY and US layouts resolve the same physical defaults", () => {
  assert.equal(command("Equal", "="), "hotbar-toggle");
  assert.equal(command("Equal", "Dead"), "hotbar-toggle");
  assert.equal(command("Minus", "+"), "hotbar-mode");
  assert.equal(command("Slash", "-"), "keyboard");
  assert.equal(command("KeyW", "z"), "move-up");
  assert.equal(command("Digit2", "é"), "slot-2");
  assert.equal(command("", "="), "hotbar-toggle");
});

test("targeting, half steps, rotation, quickbar and spell chords use the same resolver", () => {
  assert.equal(command("KeyZ", "w"), "target");
  assert.equal(command("Space", " "), "confirm");
  assert.equal(command("KeyD", "D", { shiftKey: true }), "half-right");
  assert.equal(command("ArrowUp", "ArrowUp"), "camera-up");
  assert.equal(command("KeyE", "E", { shiftKey: true }), "quarter-right");
  assert.equal(command("KeyG", "g", { ctrlKey: true, shiftKey: true }), "aim-upcast-missile");
  assert.equal(command("Digit0", "à", { ctrlKey: true }), "aim-slot-0");
  assert.equal(command("ArrowDown", "ArrowDown", { altKey: true }), "save-options");
  assert.equal(command("Enter", "Enter", { shiftKey: true }), undefined);
});

test("camera shortcuts are independently assignable and Alt follows movement", () => {
  assert.equal(command("KeyW", "∑", { altKey: true }), "alt-camera-up");
  assert.equal(command("ArrowLeft", "ArrowLeft"), "camera-left");
  assert.equal(resolveBindings()["look-mode"], null);
  let overrides = assignBinding({}, "move-up", { code: "KeyP", modifiers: 0 });
  overrides = assignBinding(overrides, "camera-left", { code: "Numpad4", modifiers: 0 });
  overrides = assignBinding(overrides, "look-mode", { code: "Tab", modifiers: 0 });
  assert.equal(command("KeyP", "π", { altKey: true }, overrides), "alt-camera-up");
  assert.equal(command("Numpad4", "4", {}, overrides), "camera-left");
  assert.equal(command("ArrowLeft", "ArrowLeft", {}, overrides), undefined);
  assert.equal(command("Tab", "Tab", {}, overrides), "look-mode");
});

test("overwrite, explicit unassign and migration leave a single owner for each chord", () => {
  let overrides = legacyOverrides({ missile: "k", bless: "" });
  assert.equal(command("KeyK", "k", {}, overrides), "skill-missile");
  assert.equal(resolveBindings(overrides)["skill-fireball"], null);
  assert.equal(resolveBindings(overrides)["skill-bless"], null);
  overrides = assignBinding(overrides, "hotbar-toggle", { code: "KeyZ", modifiers: 0 });
  assert.equal(resolveBindings(overrides).target, null);
  assert.equal(command("KeyZ", "z", {}, overrides), "hotbar-toggle");
  assert.equal(command("Equal", "=", {}, overrides), undefined);
  overrides = assignBinding(overrides, "hotbar-toggle", null);
  assert.equal(resolveBindings(overrides).target, null);
  assert.equal(command("KeyZ", "z", {}, overrides), undefined);
  assert.deepEqual(assignBinding(overrides, "hotbar-toggle", { code: "F2", modifiers: 0 }), overrides);
});

test("Shift, Ctrl and Alt variants always follow their base keys", () => {
  let overrides = assignBinding({}, "skill-missile", { code: "IntlBackslash", modifiers: 0 });
  overrides = assignBinding(overrides, "arrow-down", { code: "KeyV", modifiers: 0 });
  assert.equal(command("IntlBackslash", "<", { shiftKey: true }, overrides), "upcast-missile");
  assert.equal(command("IntlBackslash", "<", { ctrlKey: true }, overrides), "aim-missile");
  assert.equal(command("IntlBackslash", ">", { ctrlKey: true, shiftKey: true }, overrides), "aim-upcast-missile");
  assert.equal(command("KeyV", "v", { altKey: true }, overrides), "save-options");
  assert.equal(command("ArrowDown", "ArrowDown", { altKey: true }, overrides), undefined);
  assert.equal(assignBinding(overrides, "aim-missile", { code: "Numpad5", modifiers: 0 }), overrides);
  assert.equal(assignBinding(overrides, "aim-missile", null), overrides);
  assert.equal(assignBinding(overrides, "skill-missile", { code: "KeyV", modifiers: 2 }), overrides);
  assert.equal(command("IntlBackslash", "<", { ctrlKey: true }, assignBinding(overrides, "skill-missile", null)), undefined);
});

test("an older profile keeps plain assignments and ignores modified overrides", (t) => {
  const { obr } = client(t, "old-profile");
  localStorage.setItem(bindingStorageKey(obr), JSON.stringify({ overrides: {
    "skill-missile": { code: "KeyT", modifiers: 0 },
    "aim-missile": null,
    "upcast-missile": { code: "KeyY", modifiers: 0 },
    "hotbar-toggle": { code: "KeyY", modifiers: 2 },
    "skill-fireball": null,
  }, layout: {} }));
  const { bindings, overrides } = keyboardProfile(obr);
  assert.deepEqual(Object.keys(overrides), ["skill-missile", "skill-fireball"]);
  assert.equal(bindings["aim-missile"].code, "KeyT");
  assert.equal(bindings["upcast-missile"].code, "KeyT");
  assert.equal(bindings["hotbar-toggle"].code, "Equal");
  assert.equal(bindings["skill-fireball"], null);
});

test("IME, AltGr and modifier-only presses never dispatch gameplay", () => {
  assert.equal(eventChord(event("KeyA", "a", { isComposing: true })), undefined);
  assert.equal(eventChord(event("KeyA", "a", { getModifierState: (name) => name === "AltGraph" })), undefined);
  assert.equal(eventChord(event("F10", "F10")), undefined);
  assert.equal(eventChord(event("ControlLeft", "Control")), undefined);
});

test("binding labels use the reported layout where supported", async () => {
  const layout = await browserLayout({ getLayoutMap: async () => new Map([["KeyA", "q"], ["Equal", "´"]]) });
  assert.equal(bindingLabel({ code: "KeyA", modifiers: 3 }, layout), "Shift+Ctrl+Q");
  assert.deepEqual(await browserLayout({ getLayoutMap: async () => { throw Error("Denied"); } }), {});
});

function client(t, id = "player") {
  const storage = new Map();
  Object.defineProperty(globalThis, "localStorage", { value: {
    getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  }, configurable: true });
  t.after(() => {
    delete globalThis.localStorage;
  });
  return { obr: { room: { id: "room" }, player: { id } } };
}

test("room dispatch protects typing, retains F10 and reads a change without reloading", (t) => {
  const { obr } = client(t);
  const calls = [];
  const handlers = { keyboard: () => calls.push("keyboard"), "hotbar-toggle": () => calls.push("toggle") };
  const key = (code, glyph, typing) => event(code, glyph, {
    target: { closest: (selector) => typing && selector.startsWith("input") },
    preventDefault() {}, stopPropagation() {},
  });
  assert.equal(handleRoomKey(obr, key("Slash", "/", true), handlers), false);
  assert.equal(handleRoomKey(obr, key("F10", "F10", true), handlers), true);
  assert.equal(handleRoomKey(obr, key("Equal", "Dead"), handlers), true);
  const { overrides, layout } = keyboardProfile(obr);
  assert.deepEqual(overrides, {});
  writeKeyboard(obr, { overrides: assignBinding(overrides, "hotbar-toggle", { code: "KeyT", modifiers: 0 }), layout });
  assert.equal(handleRoomKey(obr, key("Equal", "Dead"), handlers), false);
  assert.equal(handleRoomKey(obr, key("KeyT", "t"), handlers), true);
  assert.deepEqual(calls, ["keyboard", "toggle", "toggle"]);
});
