import OBR from "./obr.js";
import { CATALOG_BACKUP, TOKEN_BACKUP, catalogSnapshot, importCatalog, importToken, readBackup, saveBackup, tokenSnapshot } from "./assignment-backup.js?v=3.2.6";
import { DEFAULT_WEAPON_DELAY, validWeaponDelay } from "./weapon-timing.js?v=3.2.2";
import { ASSIGNMENT_MODAL } from "./assignment-window.js?v=3.2.6";
import { CUSTOM_ID, DAMAGE_MODIFIERS, DAMAGE_TYPES, customSkill, isAbility, isWeapon, parseDamageDice } from "./combat-catalog.js?v=3.1.0";
import { weaponDefinition } from "./melee-damage.js?v=3.1.0";
import { areaSound, motifSoundEffects } from "./motif-cues.js?v=3.2.6";
import {
  DEFAULT_WEAPON, FRIENDLY_FIRE_MODES, RANGED_WEAPONS, SKILLS, SKILL_CHANGED, SPELLS, TEAMS, WEAPONS,
  availableCustomSkills, availableRangedWeapons, availableSpells, availableWeapons, friendlyFireMode,
  readSkills, skillConnections, spellParameter, tokenTeams, validSpellParameter, weaponNames, writeSkills,
} from "./skills.js?v=3.1.0";
import { ABILITIES, TOKEN_STATS, readTokenStats, writeTokenStats } from "./stats.js?v=3.1.0";
import { setupStatsEditor } from "./stats-panel.js?v=3.1.0";

const labels = { spell: "Spell", weapon: "Weapon", "ranged-weapon": "Ranged weapon", skill: "Skill", ability: "Special ability" };
const parameterFields = ["parameter", "targetLimit"];
const catalogFields = { spell: "spellsByToken", weapon: "weaponsByToken", "ranged-weapon": "rangedWeaponsByToken",
  skill: "customSkillsByToken", ability: "customSkillsByToken" };
const isCharacter = (item) => item?.type === "IMAGE" && item.layer === "CHARACTER";
const byId = (id) => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const button = (text, handler, className) => {
  const element = make("button", text, className);
  element.type = "button";
  element.addEventListener("click", handler);
  return element;
};
const choices = (select, options) => select.replaceChildren(...options.map(([id, name]) => new Option(name, id)));

export function catalogEntries(config) {
  return [
    ...SPELLS.map((id) => ({
      id, kind: "spell", category: id === "heart" || id === "sleep" ? "skill" : "spell",
      name: SKILLS[id].name, fields: parameterFields.filter((field) => SKILLS[id][field]),
      always: id === "sleep",
    })),
    ...["weapon", "ranged-weapon"].flatMap((kind) => Object.entries(weaponNames(config, kind))
      .map(([id, name]) => ({ id, kind, name }))),
    ...Object.entries(config.catalog ?? {}).flatMap(([id, definition]) => CUSTOM_ID.test(id) && customSkill(definition)
      ? [{ id, kind: definition.kind, name: definition.name }] : []),
  ];
}

function grantedIds(config, kind, token) {
  if (kind === "spell") return availableSpells(config, token);
  if (kind === "weapon") return availableWeapons(config.weaponsByToken?.[token], config);
  if (kind === "ranged-weapon") return availableRangedWeapons(config.rangedWeaponsByToken?.[token], config);
  return availableCustomSkills(config, token);
}

export function updateGrant(config, token, entry, grant, parameters) {
  const ids = new Set(grantedIds(config, entry.kind, token));
  const added = grant && !ids.has(entry.id);
  if (grant) ids.add(entry.id);
  else ids.delete(entry.id);
  const field = catalogFields[entry.kind];
  config[field] = { ...config[field], [token]: [...ids].filter((id) => id !== DEFAULT_WEAPON) };
  if (entry.fields?.length && (parameters || !grant)) {
    const tokenParameters = { ...config.spellParametersByToken?.[token] };
    delete tokenParameters[entry.id];
    if (parameters && Object.keys(parameters).length) tokenParameters[entry.id] = parameters;
    config.spellParametersByToken = { ...config.spellParametersByToken, [token]: tokenParameters };
  }
  return added ? { kind: entry.kind, variant: entry.id, name: entry.name, tokenId: token, id: crypto.randomUUID() } : {};
}

function initialize(obr) {
  const token = byId("token");
  const tokenInput = new URLSearchParams(location.search).get("token");
  const results = byId("results");
  const customize = byId("customize");
  const editor = byId("definition");
  const spellEditor = byId("spell-sounds");
  const fields = editor.elements;
  const feedback = byId("feedback");
  const menu = byId("entry-menu");
  const menuEdit = menu.querySelector("button");
  const template = byId("create-template");
  const views = [...document.querySelectorAll("nav button")];
  const enable = byId("enable-skills");
  const friendly = byId("friendly-fire");
  const teams = byId("teams");
  let config = {};
  let tokens = new Map();
  let allowed = false;
  let saving = false;
  let editing;
  let editingSpell;
  let customEntry;
  let menuEntry;
  let revision = 0;
  let scene = 0;
  let firstLoad = true;
  let roster;

  const showStats = setupStatsEditor(obr, byId("stats").querySelector("form"), { gm: true });
  const close = () => void obr.modal.close(ASSIGNMENT_MODAL).catch(console.error);
  byId("close").addEventListener("click", close);
  const closeMenu = () => { menu.hidden = true; menuEntry = undefined; };
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!menu.hidden) {
      const origin = menuEntry?.trigger;
      closeMenu();
      origin?.focus();
    } else close();
  });
  document.addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) closeMenu(); });

  const showView = (name) => {
    for (const tab of views) {
      const active = tab.getAttribute("aria-controls") === name;
      tab.setAttribute("aria-pressed", String(active));
      byId(tab.getAttribute("aria-controls")).hidden = !active;
    }
    closeMenu();
  };
  for (const tab of views) tab.addEventListener("click", () => {
    const view = tab.getAttribute("aria-controls");
    if (view === "create" && editingSpell) startDefinition();
    showView(view);
  });

  choices(friendly, FRIENDLY_FIRE_MODES.map((mode) => [mode, mode === "aoe" ? "Area effects only" : mode === "enabled" ? "Enabled" : "Disabled"]));
  choices(fields.damageType, DAMAGE_TYPES.map((type) => [type, type]));
  choices(fields.modifier, Object.entries(DAMAGE_MODIFIERS));
  choices(fields.saveAbility, [["", "None"], ...Object.entries(ABILITIES)]);
  const teamControls = new Map(TEAMS.map((name) => {
    const label = make("label", undefined, "check");
    const input = make("input");
    input.type = "checkbox";
    label.append(input, name);
    teams.append(label);
    input.addEventListener("change", () => {
      const checked = input.checked;
      void save((next, id) => {
        const assigned = new Set(tokenTeams(next, id));
        if (checked) assigned.add(name);
        else assigned.delete(name);
        next.teamsByToken = { ...next.teamsByToken, [id]: [...assigned] };
      }, { tokenRequired: true });
    });
    return [name, input];
  }));
  function render() {
    enable.disabled = friendly.disabled = token.disabled = !allowed || saving;
    enable.checked = config.enabled === true;
    friendly.value = friendlyFireMode(config);
    for (const [name, input] of teamControls) {
      input.disabled = !allowed || !token.value || saving;
      input.checked = tokenTeams(config, token.value).includes(name);
    }
    byId("save-definition").disabled = byId("save-spell-sounds").disabled = saving || !allowed;
    showStats(tokens.get(token.value), allowed);
    for (const input of customize.elements) input.disabled = saving || !allowed;
    byId("token-backup").hidden = !allowed || !token.value;
    for (const id of ["export-catalog", "import-catalog", "export-token", "import-token"]) byId(id).disabled = !allowed || saving;
    renderResults();
  }

  function renderResults() {
    const filter = document.querySelector('input[name="filter"]:checked').value;
    const search = byId("search").value.trim().toLowerCase().split(/\s+/);
    const entries = catalogEntries(config)
      .filter(({ id, kind, category = kind, name }) => (!filter || filter === category || filter === "skill" && kind === "ability") &&
        search.every((word) => [name, labels[category], id].join(" ").toLowerCase().includes(word)))
      .sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
    byId("empty").hidden = entries.length > 0;
    const focused = document.activeElement?.closest?.("li[data-entry]");
    const target = focused && { id: focused.dataset.entry, control: document.activeElement.dataset.control };
    const rows = entries.map((entry) => {
      const { id, kind, name, category = kind } = entry;
      const row = make("li");
      row.dataset.entry = kind + ":" + id;
      const assigned = entry.always || grantedIds(config, kind, token.value).includes(id);
      const fixed = entry.always || id === DEFAULT_WEAPON;
      const saved = config.spellParametersByToken?.[token.value]?.[id];
      const styled = Boolean(entry.fields?.length && assigned &&
        (typeof saved === "number" ? saved !== SKILLS[id].parameter?.defaultValue :
          entry.fields.some((field) => saved?.[field] !== undefined && saved[field] !== SKILLS[id][field].defaultValue)));
      const check = make("input");
      check.type = "checkbox";
      check.dataset.control = "grant";
      check.checked = Boolean(token.value && assigned);
      check.disabled = saving || !allowed || !token.value || fixed;
      check.setAttribute("aria-label", (fixed ? "Always available: " : "Grant ") + name);
      check.addEventListener("change", () => {
        const checked = check.checked;
        void save((next, targetId) => updateGrant(next, targetId, entry, checked), { tokenRequired: true });
      });
      const label = entry.fields?.length
        ? button(name, () => openCustomization(entry), "entry-name")
        : make("div", name, "entry-text");
      label.append(make("small", labels[category]));
      if (entry.fields?.length) {
        label.dataset.control = "options";
        label.disabled = check.disabled;
        label.setAttribute("aria-pressed", String(id === customEntry?.id));
        label.setAttribute("aria-label", "Configure " + name);
        check.title = "Quick grant with default settings";
      }
      row.append(check, label);
      const actions = make("div", undefined, "entry-actions");
      row.append(actions);
      if (styled) {
        const mark = make("span", "✓✧", "configured");
        mark.title = "Granted with custom settings";
        mark.setAttribute("aria-label", mark.title);
        actions.append(mark);
      }
      if (kind === "spell" || isWeapon(kind) || isAbility(kind)) {
        const edit = button("Edit", () => editDefinition(entry), "edit");
        edit.dataset.control = "edit";
        edit.setAttribute("aria-label", "Edit " + name);
        actions.append(edit);
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          menuEntry = { entry, trigger: edit };
          template.hidden = !isWeapon(kind);
          menu.hidden = false;
          menu.style.left = Math.max(0, Math.min(event.clientX || edit.getBoundingClientRect().left, innerWidth - menu.offsetWidth - 4)) + "px";
          menu.style.top = Math.max(0, Math.min(event.clientY || edit.getBoundingClientRect().bottom, innerHeight - menu.offsetHeight - 4)) + "px";
          menuEdit.focus();
        });
      }
      return row;
    });
    results.replaceChildren(...rows);
    if (target?.control) rows.find((row) => row.dataset.entry === target.id)
      ?.querySelector('[data-control="' + target.control + '"]')?.focus({ preventScroll: true });
  }

  function hideCustomization() {
    customEntry = undefined;
    customize.replaceChildren();
    customize.hidden = true;
    byId("rules").hidden = false;
  }

  function openCustomization(entry) {
    customEntry = entry;
    customize.replaceChildren(make("h2", entry.name));
    for (const field of entry.fields) {
      const parameter = SKILLS[entry.id][field];
      const label = make("label", parameter.label);
      const input = make("input");
      input.name = field;
      input.type = "number";
      input.step = parameter.integer ? "1" : "any";
      input.min = parameter.min;
      input.placeholder = String(parameter.defaultValue);
      input.value = spellParameter(config, token.value, entry.id, field);
      label.append(input);
      customize.append(label);
    }
    const actions = make("div", undefined, "form-actions");
    const submit = make("button", "Grant");
    submit.type = "submit";
    actions.append(submit, button("Cancel", () => { hideCustomization(); renderResults(); }));
    customize.append(actions);
    customize.hidden = false;
    byId("rules").hidden = true;
    renderResults();
    customize.querySelector("input")?.focus({ preventScroll: true });
  }

  customize.addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = customEntry;
    if (!entry) return;
    const parameters = {};
    for (const field of entry.fields) {
      const input = customize.elements.namedItem(field);
      if (!input.value) continue;
      if (!validSpellParameter(entry.id, input.valueAsNumber, field)) {
        feedback.textContent = "Check the numbers for " + entry.name + ".";
        return;
      }
      if (input.valueAsNumber !== SKILLS[entry.id][field].defaultValue) parameters[field] = input.valueAsNumber;
    }
    void save((next, id) => updateGrant(next, id, entry, true, parameters), {
      tokenRequired: true, after: () => { if (customEntry === entry) hideCustomization(); },
    });
  });

  function soundChoices(select, selected) {
    const cues = motifSoundEffects();
    if (selected && !cues.has(selected)) cues.set(selected, selected + " (unavailable)");
    choices(select, [["", "None"], ...cues]);
    select.value = selected ?? "";
  }

  const editorTabs = [...editor.querySelectorAll(".editor-tabs button")];
  function selectEditorPane(active) {
    for (const tab of editorTabs) {
      const id = tab.getAttribute("aria-controls");
      tab.setAttribute("aria-pressed", String(id === active));
      byId(id).hidden = id !== active;
    }
  }
  for (const tab of editorTabs) tab.addEventListener("click", () => selectEditorPane(tab.getAttribute("aria-controls")));
  editor.addEventListener("invalid", (event) => {
    const panel = event.target.closest("#definition-stats, #definition-effects");
    if (panel?.hidden) selectEditorPane(panel.id);
  }, true);

  function editorType(animation) {
    const kind = fields.kind.value;
    const weapon = isWeapon(kind);
    const usesWeapon = !weapon && fields.uses.value !== "none";
    byId("weapon-fields").hidden = byId("weapon-fields").disabled = !weapon;
    byId("weapon-timing-help").hidden = !weapon;
    byId("weapon-effects").hidden = byId("weapon-effects").disabled = !weapon;
    byId("skill-effects").hidden = byId("skill-effects").disabled = weapon;
    byId("skill-fields").hidden = byId("skill-fields").disabled = weapon;
    byId("cast-range").hidden = usesWeapon;
    fields.range.disabled = usesWeapon;
    byId("damage-type").hidden = usesWeapon;
    byId("additional-damage").hidden = !usesWeapon;
    fields.dice.required = weapon;
    if (!weapon) return;
    const options = Object.entries(kind === "weapon" ? WEAPONS : RANGED_WEAPONS);
    choices(fields.animation, options);
    fields.animation.value = options.some(([id]) => id === animation) ? animation : options[0][0];
  }

  function startDefinition(entry, fromTemplate = false) {
    editing = fromTemplate ? undefined : entry;
    editingSpell = undefined;
    editor.hidden = false;
    spellEditor.hidden = true;
    editor.reset();
    selectEditorPane("definition-stats");
    const definition = entry && (isWeapon(entry.kind) ? weaponDefinition(config, entry.kind, entry.id) : config.catalog?.[entry.id]);
    fields.kind.disabled = Boolean(editing);
    fields.kind.value = definition?.kind ?? "weapon";
    byId("editor-title").textContent = fromTemplate ? "Create from " + definition.name :
      definition ? "Edit " + definition.name : "Create a definition";
    fields.name.value = fromTemplate ? definition.name.slice(0, 75) + " copy" : definition?.name ?? "";
    fields.dice.value = definition?.dice ? definition.dice.count + "d" + definition.dice.sides : "";
    fields.damageType.value = definition?.damageType ?? "slashing";
    fields.modifier.value = definition?.modifier ?? "str";
    fields.damageBonus.value = definition?.damageBonus ?? 0;
    fields.hitBonus.value = definition?.hitBonus ?? 0;
    fields.hitDelay.value = definition?.hitDelay ?? DEFAULT_WEAPON_DELAY;
    fields.swingDelay.value = definition?.swingDelay ?? definition?.soundDelay ?? DEFAULT_WEAPON_DELAY;
    fields.missDelay.value = definition?.missDelay ?? DEFAULT_WEAPON_DELAY;
    fields.castDelay.value = definition?.castDelay ?? 0;
    fields.skillMissDelay.value = definition && !isWeapon(definition.kind) ? definition.missDelay ?? 0 : 0;
    soundChoices(fields.swingSound, definition?.swingSound ?? definition?.sound);
    soundChoices(fields.hitSound, definition?.hitSound);
    soundChoices(fields.missSound, definition?.missSound);
    soundChoices(fields.castSound, definition?.castSound);
    soundChoices(fields.skillHitSound, definition?.hitSound);
    soundChoices(fields.skillMissSound, definition?.missSound);
    fields.uses.value = definition?.uses ?? "none";
    fields.saveAbility.value = definition?.saveAbility ?? "";
    fields.range.value = definition?.range ?? 6;
    editorType(definition?.animation);
  }
  function editDefinition(entry) {
    if (entry.kind === "spell") {
      editingSpell = entry;
      editor.hidden = true;
      spellEditor.hidden = false;
      const saved = config.spellSounds?.[entry.id];
      for (const key of ["castSound", "hitSound", "missSound", "loopSound"]) soundChoices(spellEditor.elements[key], saved?.[key]);
      spellEditor.elements.castDelay.value = saved?.castDelay ?? 0;
      spellEditor.elements.missDelay.value = saved?.missDelay ?? 0;
      const area = areaSound(SKILLS[entry.id]);
      byId("spell-miss-label").textContent = area ? "AoE" : "On miss";
      byId("spell-miss-delay-label").textContent = area ? "AoE delay after burst (ms)" : "On miss delay after impact (ms)";
      byId("spell-sound-title").textContent = "Edit " + entry.name + " sounds";
      showView("create");
      spellEditor.elements.castSound.focus();
      return;
    }
    startDefinition(entry);
    showView("create");
    fields.name.focus();
  }
  byId("back-to-skills").addEventListener("click", () => { startDefinition(); showView("skills"); });
  spellEditor.addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = editingSpell;
    if (!entry || !SPELLS.includes(entry.id)) return;
    const { castSound, castDelay, hitSound, missSound, missDelay, loopSound } = spellEditor.elements;
    const delays = [castDelay.valueAsNumber, missDelay.valueAsNumber];
    if (!delays.every((value) => Number.isInteger(value) && value >= 0 && value <= 10000)) return;
    const sounds = { castSound: castSound.value, castDelay: delays[0],
      hitSound: hitSound.value, missSound: missSound.value, missDelay: delays[1], loopSound: loopSound.value };
    void save((next) => { next.spellSounds = { ...next.spellSounds, [entry.id]: sounds }; },
      { message: entry.name + " sounds saved." });
  });
  menuEdit.addEventListener("click", () => { if (menuEntry) editDefinition(menuEntry.entry); });
  template.addEventListener("click", () => {
    const entry = menuEntry?.entry;
    if (!isWeapon(entry?.kind)) return;
    startDefinition(entry, true);
    showView("create");
    fields.name.focus();
    fields.name.select();
  });
  byId("new-definition").addEventListener("click", () => { startDefinition(); fields.name.focus(); });
  fields.kind.addEventListener("change", () => {
    if (fields.kind.value === "ranged-weapon") {
      fields.modifier.value = "dex";
      fields.damageType.value = "piercing";
    } else if (fields.kind.value === "weapon") {
      fields.modifier.value = "str";
      fields.damageType.value = "slashing";
    }
    editorType();
  });
  fields.uses.addEventListener("change", () => editorType());
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = editing;
    const kind = fields.kind.value;
    const name = fields.name.value.trim();
    let definition;
    try {
      if (!name || !Object.hasOwn(labels, kind) || kind === "spell") throw Error("Enter a name and choose a definition type.");
      const weapon = isWeapon(kind);
      const dice = parseDamageDice(fields.dice.value, !weapon);
      definition = { name, kind, dice, damageType: fields.damageType.value };
      if (weapon) {
        const modifier = fields.modifier.value;
        const damageBonus = fields.damageBonus.valueAsNumber;
        const hitBonus = fields.hitBonus.valueAsNumber;
        const animation = fields.animation.value;
        if (![damageBonus, hitBonus].every((value) => Number.isInteger(value) && Math.abs(value) <= 99) ||
            !Object.hasOwn(DAMAGE_MODIFIERS, modifier) || !Object.hasOwn(kind === "weapon" ? WEAPONS : RANGED_WEAPONS, animation)) {
          throw Error("Choose an animation and enter whole-number bonuses from −99 to 99.");
        }
        const hitDelay = fields.hitDelay.valueAsNumber;
        const swingDelay = fields.swingDelay.valueAsNumber;
        const missDelay = fields.missDelay.valueAsNumber;
        if (![hitDelay, swingDelay, missDelay].every(validWeaponDelay)) throw Error("Enter whole percentages from 0 to 100 for attack delays.");
        Object.assign(definition, { modifier, damageBonus, hitBonus, animation, hitDelay,
          swingDelay, missDelay, swingSound: fields.swingSound.value, hitSound: fields.hitSound.value, missSound: fields.missSound.value });
      } else {
        Object.assign(definition, {
          castSound: fields.castSound.value, castDelay: fields.castDelay.valueAsNumber,
          hitSound: fields.skillHitSound.value, missSound: fields.skillMissSound.value, missDelay: fields.skillMissDelay.valueAsNumber,
          uses: fields.uses.value, saveAbility: fields.saveAbility.value || undefined,
          ...(fields.uses.value === "none" ? { range: fields.range.valueAsNumber } : {}),
        });
        if (!customSkill(definition)) throw Error("Set a valid range and add damage or a saving throw for a standalone skill.");
      }
    } catch (error) {
      feedback.textContent = error.message;
      return;
    }
    const id = entry?.id ?? "custom-" + crypto.randomUUID();
    void save((next) => {
      next.catalog = { ...next.catalog, [id]: definition };
    }, { after: () => { if (editing === entry) startDefinition({ id, kind, name }); }, message: name + " saved." });
  });

  async function save(change, { tokenRequired = false, beforeWrite, after, message = "Saved." } = {}) {
    if (saving || !allowed) return;
    const id = token.value;
    const version = scene;
    const current = () => scene === version && allowed && token.value === id;
    saving = true;
    feedback.textContent = "";
    render();
    try {
      const { self, gm } = await skillConnections(obr);
      if (self.role !== "GM" || gm?.connectionId !== self.connectionId) throw Error("The active skills GM must save changes.");
      const [item] = tokenRequired && id ? await obr.scene.items.getItems([id]) : [];
      if (tokenRequired && !isCharacter(item)) throw Error("Choose a character in the open scene.");
      if (!current()) throw Error("The scene or your GM access changed.");
      const next = readSkills(obr, "gm");
      const grant = change(next, id);
      const undo = beforeWrite ? await beforeWrite(item, current) : undefined;
      try {
        if (!current()) throw Error("The scene or your GM access changed.");
        writeSkills(obr, "gm", next);
      } catch (error) {
        if (undo) await undo().catch(console.error);
        throw error;
      }
      config = next;
      after?.();
      await obr.broadcast.sendMessage(SKILL_CHANGED, grant?.id ? { grant } : {}, { destination: "ALL" }).catch(console.error);
      feedback.textContent = message;
    } catch (error) {
      feedback.textContent = error.message || "Couldn’t save changes.";
    } finally {
      saving = false;
      render();
    }
  }

  function setupBackup(kind, type) {
    const fileInput = byId(kind + "-file");
    const isToken = type === TOKEN_BACKUP;
    byId("export-" + kind).addEventListener("click", () => {
      if (!allowed || saving) return;
      try {
        const source = readSkills(obr, "gm");
        if (isToken) {
          const item = tokens.get(token.value);
          if (!item) throw Error("Choose a token to export.");
          const slug = (item.name || "token").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 50);
          saveBackup(type, tokenSnapshot(source, item), "overhead-chat-" + slug);
        } else saveBackup(type, catalogSnapshot(source), "overhead-chat-catalog");
        feedback.textContent = "Backup exported.";
      } catch (error) { feedback.textContent = error.message || "Couldn’t export the backup."; }
    });
    byId("import-" + kind).addEventListener("click", () => {
      if (allowed && !saving) fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      const [file] = fileInput.files;
      fileInput.value = "";
      if (!file) return;
      const version = scene;
      const selected = token.value;
      try {
        const data = await readBackup(file, type);
        if (saving || !allowed || version !== scene || isToken && selected !== token.value) {
          throw Error("The selection changed. Choose the backup again.");
        }
        if (isToken && !selected) throw Error("Choose a character to receive the backup.");
        let stats;
        await save((next, id) => {
          if (isToken) stats = importToken(next, id, data);
          else importCatalog(next, data);
        }, {
          tokenRequired: isToken,
          beforeWrite: isToken ? async (item, current) => {
            const previous = item.metadata[TOKEN_STATS];
            await writeTokenStats(obr, item.id, stats.scores, {
              gm: true, ...stats, expected: JSON.stringify(readTokenStats(item)), current,
            });
            const restored = JSON.stringify(stats);
            return () => obr.scene.items.updateItems([item.id], ([latest]) => {
              if (current() && JSON.stringify(latest?.metadata[TOKEN_STATS]) === restored) {
                if (previous === undefined) delete latest.metadata[TOKEN_STATS];
                else latest.metadata[TOKEN_STATS] = previous;
              }
            });
          } : undefined,
          after: () => { if (isToken) hideCustomization(); else startDefinition(); },
          message: isToken ? "Token stats and assignments imported." : "Catalog imported.",
        });
      } catch (error) { feedback.textContent = error.message || "Couldn’t import the backup."; }
    });
  }

  setupBackup("catalog", CATALOG_BACKUP);
  setupBackup("token", TOKEN_BACKUP);

  async function refresh() {
    const requested = ++revision;
    try {
      const [{ self, gm }, ready] = await Promise.all([skillConnections(obr), obr.scene.isReady()]);
      if (requested !== revision) return;
      allowed = self.role === "GM" && gm?.connectionId === self.connectionId && ready;
      byId("access").hidden = allowed;
      byId("workspace").hidden = !allowed;
      if (!allowed) {
        tokens.clear();
        roster = undefined;
        token.replaceChildren();
        showStats(undefined, false);
        byId("access").textContent = self.role !== "GM" ? "GM access required."
          : !ready ? "Open a scene to assign skills and equipment." : "Another connected GM is handling skills.";
        return;
      }
      const [items, selection] = await Promise.all([
        obr.scene.items.getItems(isCharacter), firstLoad && !tokenInput ? obr.player.getSelection() : [],
      ]);
      if (requested !== revision) return;
      const selected = firstLoad ? tokenInput || (selection?.length === 1 ? selection[0] : "") : token.value;
      firstLoad = false;
      config = readSkills(obr, "gm");
      tokens = new Map(items.sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((item) => [item.id, item]));
      const options = [...tokens.values()].map(({ id, name }) => [id, name || "Unnamed character"]);
      const nextRoster = JSON.stringify(options);
      if (roster !== nextRoster) {
        choices(token, [["", "Choose a character"], ...options]);
        roster = nextRoster;
      }
      token.value = tokens.has(selected) ? selected : "";
      if (!token.value) hideCustomization();
      render();
    } catch (error) {
      if (requested !== revision) return;
      allowed = false;
      byId("access").hidden = false;
      byId("access").textContent = "Couldn’t load the assignment window.";
      byId("workspace").hidden = true;
      console.error(error);
    }
  }
  const reload = () => void refresh();
  enable.addEventListener("change", () => {
    const checked = enable.checked;
    void save((next) => { next.enabled = checked; });
  });
  friendly.addEventListener("change", () => {
    const mode = friendly.value;
    if (FRIENDLY_FIRE_MODES.includes(mode)) void save((next) => { next.friendlyFire = mode; });
  });
  token.addEventListener("change", () => { hideCustomization(); feedback.textContent = ""; render(); });
  byId("search").addEventListener("input", renderResults);
  document.querySelector(".filters").addEventListener("change", renderResults);
  obr.player.onChange(({ role }) => { if (role !== "GM" || !allowed) reload(); });
  obr.party.onChange(reload);
  obr.scene.onReadyChange(() => { scene++; hideCustomization(); reload(); });
  obr.scene.items.onChange((items) => {
    if (!allowed) return;
    const characters = items.filter(isCharacter);
    const rosterChanged = characters.length !== tokens.size ||
      characters.some(({ id, name }) => !tokens.has(id) || tokens.get(id).name !== name);
    if (rosterChanged) reload();
    else {
      tokens = new Map(characters.map((item) => [item.id, item]));
      showStats(tokens.get(token.value), allowed);
    }
  });
  startDefinition();
  reload();
}

OBR.onReady(() => initialize(OBR));
