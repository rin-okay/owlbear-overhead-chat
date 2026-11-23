import { ABILITIES, COMBAT_STATS, abilityModifier, readTokenStats, validAbilityScore, writeTokenStats } from "./stats.js?v=2.8.5";

export function setupStatsEditor(obr, form, { gm = false } = {}) {
  const fields = form.querySelector("fieldset");
  const details = form.querySelector(".stats-details");
  const button = form.querySelector("[type=submit]");
  const status = form.querySelector("[role=status]");
  const editable = form.elements.namedItem("editable");
  const controls = Object.fromEntries(Object.entries(ABILITIES).map(([key, name]) => {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = key;
    caption.title = name;
    const input = document.createElement("input");
    input.type = "number";
    input.name = key;
    input.min = 1;
    input.max = 30;
    input.step = 1;
    input.required = true;
    input.setAttribute("aria-label", name);
    const modifier = document.createElement("output");
    modifier.setAttribute("aria-label", name + " modifier");
    label.append(caption, input, modifier);
    fields.append(label);
    input.addEventListener("input", () => showModifier(input, modifier));
    return [key, { input, modifier }];
  }));

  const combatControls = Object.fromEntries(Object.entries(COMBAT_STATS).map(([key, { label: name, minimum, maximum }]) => {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = key === "ac" ? "ac" : name;
    const input = document.createElement("input");
    input.type = "number";
    input.name = key;
    input.min = minimum;
    if (maximum !== undefined) input.max = maximum;
    input.step = 1;
    input.required = true;
    input.setAttribute("aria-label", name);
    label.append(caption, input);
    details.append(label);
    return [key, input];
  }));

  let tokenId;
  let baseline;
  let permission = false;
  let busy = false;
  let revision = 0;

  function showModifier(input, output) {
    const score = input.valueAsNumber;
    const modifier = validAbilityScore(score) ? abilityModifier(score) : undefined;
    output.value = modifier === undefined ? "—" : modifier >= 0 ? "+" + modifier : String(modifier);
  }

  function updateControls() {
    const locked = busy || !permission;
    for (const { input } of Object.values(controls)) input.readOnly = locked;
    for (const input of Object.values(combatControls)) input.readOnly = locked;
    if (editable) editable.disabled = locked;
    button.disabled = locked;
  }

  function show(token, allowed = true) {
    const stats = readTokenStats(token);
    const id = token?.id;
    const signature = id ? JSON.stringify(stats) : undefined;
    const nextPermission = Boolean(id && allowed && (gm || stats.editable));
    if (id !== tokenId || signature !== baseline || nextPermission !== permission) {
      const changedToken = id !== tokenId;
      const changedPermission = nextPermission !== permission;
      if (changedToken || changedPermission) revision++;
      tokenId = id;
      baseline = signature;
      permission = nextPermission;
      for (const [key, { input, modifier }] of Object.entries(controls)) {
        input.value = id ? stats.scores[key] : "";
        showModifier(input, modifier);
      }
      for (const [key, input] of Object.entries(combatControls)) input.value = id ? stats.details[key] : "";
      if (editable) editable.checked = stats.editable;
      if (changedToken || changedPermission) status.textContent = "";
    }
    fields.hidden = details.hidden = !id;
    if (editable) editable.closest("label").hidden = !id;
    button.hidden = !id || (!gm && !permission);
    updateControls();
    if (!id) status.textContent = gm ? "Choose a token to view its stats." : "Set an avatar to view its stats.";
    else if (!gm && !permission) status.textContent = "The GM controls this token’s stats.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!permission || busy || !tokenId || !form.reportValidity()) return;
    const expected = baseline;
    const id = tokenId;
    const at = revision;
    const current = () => at === revision && id === tokenId;
    const scores = Object.fromEntries(Object.entries(controls).map(([key, { input }]) => [key, input.valueAsNumber]));
    const values = Object.fromEntries(Object.entries(combatControls).map(([key, input]) => [key, input.valueAsNumber]));
    busy = true;
    updateControls();
    try {
      await writeTokenStats(obr, id, scores, { gm, editable: editable?.checked, expected, current, details: values });
      if (current()) status.textContent = "Stats saved.";
    } catch (error) {
      if (current()) status.textContent = error.message || "Couldn’t save stats.";
    } finally {
      busy = false;
      updateControls();
    }
  });

  show();
  return show;
}
