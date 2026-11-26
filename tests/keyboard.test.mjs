import assert from "node:assert/strict";
import test from "node:test";
import {
  actionForEvent, assignBinding, bindingLabel, bindingStorageKey, browserLayout, keyboardProfile,
  eventChord, legacyOverrides, mapShortcut, resolveBindings, writeKeyboard,
} from "../key-bindings.js";
import { handleRoomKey, setupSceneKeys } from "../keyboard-shortcuts.js";

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
  assert.equal(command("ArrowUp", "ArrowUp"), "arrow-up");
  assert.equal(command("KeyE", "E", { shiftKey: true }), "quarter-right");
  assert.equal(command("KeyG", "g", { ctrlKey: true, shiftKey: true }), "aim-upcast-missile");
  assert.equal(command("Digit0", "à", { ctrlKey: true }), "aim-slot-0");
  assert.equal(command("ArrowDown", "ArrowDown", { altKey: true }), "save-options");
  assert.equal(command("Enter", "Enter", { shiftKey: true }), undefined);
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

test("labels and native map shortcuts use the reported layout where supported", async () => {
  const layout = await browserLayout({ getLayoutMap: async () => new Map([["KeyA", "q"], ["Equal", "´"]]) });
  assert.equal(bindingLabel({ code: "KeyA", modifiers: 3 }, layout), "Shift+Ctrl+Q");
  assert.equal(mapShortcut({ code: "KeyA", modifiers: 0 }, layout), "q");
  assert.equal(mapShortcut({ code: "Equal", modifiers: 0 }, {}), "=");
  assert.equal(mapShortcut({ code: "Slash", modifiers: 0 }, {}), "/");
  assert.equal(mapShortcut({ code: "Minus", modifiers: 0 }, {}), "-");
  assert.equal(mapShortcut({ code: "Backspace", modifiers: 0 }, {}), "backspace");
  assert.deepEqual(await browserLayout({ getLayoutMap: async () => { throw Error("Denied"); } }), {});
});

function client(t, id = "player") {
  const storage = new Map();
  const win = new EventTarget();
  Object.defineProperty(globalThis, "localStorage", { value: {
    getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  }, configurable: true });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  t.after(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });
  return { win, obr: { room: { id: "room" }, player: { id } } };
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

test("Owlbear shortcuts refresh and release displaced map keys", async (t) => {
  const { obr, win } = client(t);
  const tools = new Map();
  const errors = [];
  obr.tool = {
    create: async (tool) => { tools.set(tool.id.split(".").at(-1), tool); },
    remove: async (id) => { tools.delete(id.split(".").at(-1)); },
  };
  setupSceneKeys(obr, { keyboard() {}, "hotbar-toggle"() {}, "hotbar-mode"() {} }, (error) => errors.push(error));
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  await tick();
  assert.equal(tools.get("keyboard-fixed").shortcut, "F10");
  assert.equal(tools.get("hotbar-toggle").shortcut, "=");
  const { overrides } = keyboardProfile(obr);
  writeKeyboard(obr, {
    overrides: assignBinding(overrides, "hotbar-toggle", { code: "Minus", modifiers: 0 }),
    layout: { Minus: "ß" },
  });
  const changed = new Event("storage");
  Object.defineProperty(changed, "key", { value: bindingStorageKey(obr) });
  win.dispatchEvent(changed);
  await tick();
  assert.equal(tools.get("hotbar-toggle").shortcut, "ß");
  assert.equal(tools.get("hotbar-mode").shortcut, undefined);
  assert.deepEqual(errors, []);
});
