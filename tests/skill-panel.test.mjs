import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SKILLS } from "../skills.js";
import { KEY_ACTIONS, resolveBindings } from "../key-bindings.js";
import { setupSkillPanel } from "../skill-panel.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);

test("every skill is available to the shared editor, including Sleep", () => {
  for (const [id, skill] of Object.entries(SKILLS)) {
    const actionId = "skill-" + id;
    assert.equal(KEY_ACTIONS[actionId].skill, id);
    assert.equal(resolveBindings()[actionId]?.code, skill.key ? "Key" + skill.key.toUpperCase() : undefined);
  }
  assert.equal(ids.filter((id) => id === "edit-skill-keys").length, 1);
  assert.equal(ids.filter((id) => id === "open-keyboard").length, 1);
});

function startPanel(t, markupIds) {
  const node = { add() {}, addEventListener() {} };
  const querySelector = (selector) => selector.startsWith("#") && !markupIds.includes(selector.slice(1)) ? null : node;
  node.querySelector = querySelector;
  const obr = { broadcast: { onMessage() {} }, party: { onChange() {} } };
  Object.defineProperty(globalThis, "document", { value: { querySelector }, configurable: true });
  Object.defineProperty(globalThis, "Option", { value: function () {}, configurable: true });
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  t.after(() => {
    delete globalThis.document;
    delete globalThis.Option;
    delete globalThis.window;
  });
  return setupSkillPanel(obr, () => null, () => {});
}

test("the loadout initializes with the new keyboard summary", (t) => {
  assert.equal(typeof startPanel(t, ids).refresh, "function");
});

test("older popover markup without a keyboard summary can still initialize", (t) => {
  assert.equal(typeof startPanel(t, ids.filter((id) => id !== "skill-key-summary")).refresh, "function");
});
