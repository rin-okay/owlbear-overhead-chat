import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SKILLS } from "../skills.js";
import { setupSkillPanel } from "../skill-panel.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);

test("each skill has exactly one hotkey control in the popover", () => {
  for (const id of Object.keys(SKILLS)) {
    const control = "skill-bind-" + id;
    assert.equal(ids.filter((id) => id === control).length, 1, control);
    assert.ok(html.includes('<select id="' + control + '"'), control);
  }
});

function startPanel(t, markupIds) {
  const node = { add() {}, addEventListener() {} };
  const querySelector = (selector) => selector.startsWith("#") && !markupIds.includes(selector.slice(1)) ? null : node;
  node.querySelector = querySelector;
  const document = { querySelector };
  const obr = { broadcast: { onMessage() {} }, party: { onChange() {} } };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "Option", { value: function () {}, configurable: true });
  t.after(() => {
    delete globalThis.document;
    delete globalThis.Option;
  });
  return setupSkillPanel(obr, () => null, (key) => typeof key === "string" && /^[a-z]$/.test(key), () => {});
}

test("the complete popover initializes all three new hotkeys", (t) => {
  const panel = startPanel(t, ids);
  assert.equal(panel.skillForKey("u"), "eldritch-blast");
  assert.equal(panel.skillForKey("i"), "misty-step");
  assert.equal(panel.skillForKey("o"), "shatter");
});

test("stale popover markup cannot abort skill panel startup", (t) => {
  const staleIds = ids.filter((id) => id !== "skill-bind-eldritch-blast");
  assert.equal(typeof startPanel(t, staleIds).refresh, "function");
});
