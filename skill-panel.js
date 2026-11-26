import {
  KEY_ACTIONS, actionForChord, assignBinding, bindingLabel, bindingStorageKey,
  eventChord, keyboardProfile, keyIdentity, writeKeyboard,
} from "./key-bindings.js?v=2.11.9";
import { setupStatsEditor } from "./stats-panel.js?v=2.8.5";
import { isPublicToken } from "./rules.js";
import { isProjectileToken } from "./projectile-collision.js?v=2.9.10";
import { spellDamageFormula } from "./spell-damage.js?v=2.9.13";
import { readTokenStats } from "./stats.js?v=2.8.5";
import {
  DEFAULT_WEAPON, FACINGS, FRIENDLY_FIRE_MODES, RANGED_WEAPONS, SKILLS, SKILL_CHANGED, SKILL_REQUEST, SKILL_RESULT, SPELLS, TEAMS, WEAPONS,
  aimsAtLocation, availableRangedWeapons, availableSpells, availableWeapons, friendlyFireMode, readSkills, skillConnections, spellParameter, tokenTeams, validSpellParameter, writeSkills,
} from "./skills.js?v=2.11.0";

function characterLabel(token) {
  return token.name || "unnamed character";
}

function facingFor(settings, token) {
  const facing = settings.facings?.[token?.image?.url];
  return FACINGS.some(([angle]) => angle === facing) ? facing : 0;
}

export function setupSkillPanel(obr, getAvatar, showSpells, showChatNotice, onBindingsChanged) {
  const playerPanel = document.querySelector("#player-skills");
  const playerStatus = document.querySelector("#skill-settings-status");
  const castStatus = document.querySelector("#skill-cast-status");
  const facing = document.querySelector("#skill-facing");
  const weapon = document.querySelector("#skill-weapon");
  const rangedWeapon = document.querySelector("#skill-ranged-weapon");
  const preview = document.querySelector("#skill-avatar-preview");
  const portrait = preview.querySelector("img");
  const arrow = preview.querySelector("span");
  const bindingsList = playerPanel.querySelector("#skill-key-summary");
  const bindingStatus = playerPanel.querySelector("#skill-binding-status");
  let capture;
  let capturedKey;
  const pending = new Map();
  let preferences = readSkills(obr, "player");
  let avatar;
  let available = [];
  let weapons = [];
  let rangedWeapons = [];
  let enabled = false;
  let castStatusTimer;
  let listRevision = 0;

  function selectedWeapon(tokenId) {
    const selected = preferences.weaponsByToken?.[tokenId];
    return tokenId === avatar?.id && weapons.includes(selected) ? selected : DEFAULT_WEAPON;
  }

  function selectedRangedWeapon(tokenId) {
    if (tokenId !== avatar?.id) return;
    const selected = preferences.rangedWeaponsByToken?.[tokenId];
    return rangedWeapons.includes(selected) ? selected : rangedWeapons[0];
  }

  function setCastStatus(text) {
    clearTimeout(castStatusTimer);
    castStatus.textContent = text;
    if (text) castStatusTimer = setTimeout(() => { castStatus.textContent = ""; }, 4200);
  }

  function render() {
    showSpells(available);
    facing.disabled = !avatar;
    facing.value = String(facingFor(preferences, avatar));
    arrow.style.transform = `rotate(${facing.value}deg)`;
    const options = weapons.length ? weapons : [DEFAULT_WEAPON];
    weapon.replaceChildren(...options.map((id) => new Option(WEAPONS[id], id)));
    weapon.value = selectedWeapon(avatar?.id);
    weapon.disabled = !enabled;
    rangedWeapon.replaceChildren(...rangedWeapons.map((id) => new Option(RANGED_WEAPONS[id], id)));
    rangedWeapon.value = selectedRangedWeapon(avatar?.id) ?? "";
    rangedWeapon.closest("label").hidden = !available.includes("ranged");
    rangedWeapon.disabled = !enabled || !rangedWeapons.length;
    renderBindings();
  }

  function showBindingStatus(message = "") {
    if (bindingStatus) bindingStatus.textContent = message;
  }

  function stopCapture(message) {
    if (!capture) return;
    const { action, button, key } = capture;
    capture = undefined;
    const { bindings, layout } = keyboardProfile(obr);
    button.setAttribute("aria-pressed", "false");
    key.textContent = bindingLabel(bindings[action], layout);
    showBindingStatus(message);
  }

  function renderBindings() {
    if (!bindingsList) return;
    const focusedSkill = document.activeElement?.dataset?.skillBinding;
    stopCapture();
    const { bindings, layout } = keyboardProfile(obr);
    const rows = available.map((id) => {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.skillBinding = id;
      button.setAttribute("aria-pressed", "false");
      const name = document.createElement("span");
      name.textContent = SKILLS[id].name;
      const action = "skill-" + id;
      const key = document.createElement("kbd");
      key.textContent = bindingLabel(bindings[action], layout);
      button.append(name, key);
      button.addEventListener("blur", () => {
        if (capture?.button === button) stopCapture();
      });
      button.addEventListener("click", () => {
        const cancel = capture?.button === button;
        stopCapture();
        if (cancel) return;
        capture = { action, button, key };
        button.focus({ preventScroll: true });
        button.setAttribute("aria-pressed", "true");
        key.textContent = "press a key";
        showBindingStatus("Press a key for " + name.textContent + ". Escape cancels.");
      });
      row.append(button);
      return row;
    });
    bindingsList.replaceChildren(...rows);
    if (focusedSkill) rows[available.indexOf(focusedSkill)]?.firstElementChild.focus({ preventScroll: true });
  }

  if (bindingsList) {
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key === bindingStorageKey(obr)) renderBindings();
    });
    window.addEventListener("blur", () => {
      capturedKey = undefined;
      stopCapture();
    });
    window.addEventListener("keydown", (event) => {
      const physicalKey = keyIdentity(event);
      if (physicalKey && physicalKey === capturedKey && event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!capture || document.activeElement !== capture.button || capture.button.closest("[hidden]")) {
        stopCapture();
        return;
      }
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (physicalKey === "Escape") {
        capturedKey = physicalKey;
        stopCapture("Shortcut assignment canceled.");
        return;
      }
      const next = eventChord(event);
      if (!next || next.modifiers !== 0) {
        showBindingStatus("Press a base key without modifiers. Function keys are fixed.");
        return;
      }

      const { action } = capture;
      const { bindings, overrides, layout } = keyboardProfile(obr);
      const replaced = actionForChord(bindings, next);
      const nextLayout = event.key?.length > 0 && event.key.length < 8 &&
        !["Dead", "Unidentified"].includes(event.key)
        ? { ...layout, [next.code]: event.key === " " ? "Space" : event.key } : layout;
      capturedKey = physicalKey;
      try {
        writeKeyboard(obr, { overrides: assignBinding(overrides, action, next), layout: nextLayout });
      } catch {
        stopCapture("Your browser couldn’t save the binding.");
        return;
      }
      renderBindings();
      const displacement = replaced && replaced.id !== action ? " " + replaced.label + " is now unassigned." : "";
      showBindingStatus(KEY_ACTIONS[action].label + " → " + bindingLabel(next, nextLayout) + "." + displacement);
      onBindingsChanged?.();
    }, true);
    window.addEventListener("keyup", (event) => {
      if (!capturedKey || keyIdentity(event) !== capturedKey) return;
      capturedKey = undefined;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  for (const [angle, label] of FACINGS) facing.add(new Option(label, angle));
  facing.addEventListener("change", () => {
    const url = avatar?.image?.url;
    if (!url) return;
    savePreferences({ ...preferences, facings: { ...preferences.facings, [url]: Number(facing.value) } });
  });
  weapon.addEventListener("change", () => {
    if (!avatar || !weapons.includes(weapon.value)) return;
    savePreferences({ ...preferences, weaponsByToken: { ...preferences.weaponsByToken, [avatar.id]: weapon.value } });
  });
  rangedWeapon.addEventListener("change", () => {
    if (!avatar || !rangedWeapons.includes(rangedWeapon.value)) return;
    savePreferences({
      ...preferences, rangedWeaponsByToken: { ...preferences.rangedWeaponsByToken, [avatar.id]: rangedWeapon.value },
    });
  });
  function savePreferences(next) {
    try {
      writeSkills(obr, "player", next);
      preferences = next;
      playerStatus.textContent = enabled ? "" : playerStatus.textContent;
    } catch {
      playerStatus.textContent = "Couldn’t save skills settings in this browser.";
    }
    render();
  }

  function clearPending(type) {
    clearTimeout(pending.get(type)?.timeout);
    pending.delete(type);
  }

  async function request(type, token, id, revision, location, spellLevel, { chooseCounts, openTarget } = {}) {
    const [{ gm, self }, selection] = await Promise.all([
      skillConnections(obr), type === "cast" ? obr.player.getSelection().catch(() => undefined) : undefined,
    ]);
    const candidates = selection?.filter((itemId) => itemId !== token.id);
    let targetIds = id === "bless" ? selection?.slice(0, 100) : undefined;
    let projectileCounts;
    if ((id === "eldritch-blast" || id === "missile") && !location && candidates?.length > 1 && available.includes(id)) {
      const ids = new Set(candidates);
      const items = await obr.scene.items.getItems((item) => ids.has(item.id) && isProjectileToken(item));
      const byId = new Map(items.map((item) => [item.id, item]));
      const targets = [...ids].filter((id) => byId.has(id)).slice(0, 100).map((id) => byId.get(id));
      targetIds = targets.map(({ id }) => id);
      const level = spellLevel ?? SKILLS[id].spellLevel;
      const count = id === "missile" ? level + 2 : spellDamageFormula(SKILLS[id], token).count;
      if (targets.length > 1 && targets.length < count &&
          (id !== "missile" || level >= 1 && level <= readTokenStats(token).details.spellLevel)) {
        projectileCounts = await chooseCounts(targets, count, id === "missile" ? "missiles" : "beams");
        if (!projectileCounts) return;
      }
    }
    const targetId = candidates?.length === 1 ? candidates[0] : undefined;
    if (type === "list" && revision !== listRevision) return;
    const showStatus = type === "cast" ? setCastStatus : (text) => { playerStatus.textContent = text; };
    if (!gm) {
      showStatus("The GM needs to be connected to use skills.");
      return;
    }
    const requestId = crypto.randomUUID();
    const facing = type === "cast" ? facingFor(preferences, token) : undefined;
    const expected = {
      requestId, gm: gm.connectionId, target: self.connectionId, tokenId: token.id, facing, openTarget,
      timeout: setTimeout(() => {
        if (pending.get(type)?.requestId !== requestId) return;
        clearPending(type);
        showStatus("No reply from the GM’s Overhead Chat. Check that the GM has the updated extension enabled.");
      }, 3000),
    };
    clearPending(type);
    pending.set(type, expected);
    try {
      await obr.broadcast.sendMessage(SKILL_REQUEST, {
        requestId, tokenId: token.id, type,
        ...(type === "cast" ? { skill: id, facing } : {}),
        ...(id === "spear" ? { weapon: selectedWeapon(token.id) } : {}),
        ...(id === "ranged" ? { weapon: selectedRangedWeapon(token.id) } : {}),
        ...(SKILLS[id]?.upcast && spellLevel !== undefined ? { spellLevel } : {}),
        ...(targetIds ? { targetIds } : targetId ? { targetId } : {}),
        ...(projectileCounts ? { projectileCounts } : {}),
        ...(location && aimsAtLocation(id) ? { targetLocation: location } : {}),
      }, { destination: "ALL" });
    } catch (error) {
      if (pending.get(type) === expected) clearPending(type);
      throw error;
    }
  }

  function refresh(token = getAvatar(), force = false) {
    const changed = token?.id !== avatar?.id || token?.image?.url !== avatar?.image?.url;
    if (!changed && !force) return;
    avatar = token;
    const revision = ++listRevision;
    clearPending("list");
    if (changed) {
      available = [];
      weapons = [];
      rangedWeapons = [];
      enabled = false;
    }
    const url = avatar?.image?.url;
    preview.hidden = !url;
    if (url && portrait.getAttribute("src") !== url) portrait.src = url;
    if (!url) portrait.removeAttribute("src");
    render();
    if (!avatar) {
      playerStatus.textContent = "Choose an avatar to view its skills.";
      return;
    }
    playerStatus.textContent = "Checking skills for " + characterLabel(avatar) + "…";
    void request("list", avatar, undefined, revision).catch(() => {
      if (revision === listRevision) playerStatus.textContent = "Couldn’t load this avatar’s skills.";
    });
  }

  obr.broadcast.onMessage(SKILL_RESULT, ({ connectionId, data }) => {
    for (const [type, expected] of pending) {
      if (connectionId !== expected.gm || data?.requestId !== expected.requestId ||
          data.connectionId !== expected.target || data.tokenId !== expected.tokenId) continue;
      clearPending(type);
      const targetingRequested = type === "cast" && data.errorCode === "target-required" && expected.openTarget;
      if (type === "cast") {
        if (targetingRequested) {
          expected.openTarget(expected.facing);
          setCastStatus("");
        } else if (["spell-level", "too-many-targets"].includes(data.errorCode) &&
            typeof data.error === "string" && showChatNotice?.(data.error)) {
          setCastStatus("");
        } else {
          setCastStatus(data.error || "");
        }
      }
      if (data.tokenId !== avatar?.id || !Array.isArray(data.skills)) return;
      available = data.skills.filter((id) => Object.hasOwn(SKILLS, id));
      enabled = data.enabled === true;
      weapons = availableWeapons(data.weapons);
      rangedWeapons = availableRangedWeapons(data.rangedWeapons);
      playerStatus.textContent = (!targetingRequested && data.error) || (enabled ? "" : "The GM hasn’t enabled skill hotkeys.");
      render();
    }
  });
  obr.broadcast.onMessage(SKILL_CHANGED, async ({ connectionId }) => {
    try {
      if ((await skillConnections(obr)).gm?.connectionId === connectionId) refresh(getAvatar(), true);
    } catch (error) {
      console.error("Overhead Chat skills", error);
    }
  });
  obr.party.onChange(() => {
    if (!playerPanel.closest("[hidden]")) refresh(getAvatar(), true);
  });

  async function cast(id, token, location, spellLevel, options) {
    if (pending.has("cast")) return;
    try {
      await request("cast", token, id, undefined, location, spellLevel, options);
    } catch {
      setCastStatus("Couldn’t send the cast to the GM.");
    }
  }

  return {
    refresh, cast, hasSkill: (id) => available.includes(id),
    facingFor: (token) => facingFor(preferences, token),
  };
}

export function setupSkillGrants(obr) {
  const enabled = document.querySelector("#skill-enabled");
  const friendlyFire = document.querySelector("#skill-friendly-fire");
  const team = document.querySelector("#grant-team-type");
  const teamGrant = document.querySelector("#skill-grant-team");
  const tokens = document.querySelector("#skill-token");
  const useSelectedToken = document.querySelector("#skill-use-selected-token");
  const spell = document.querySelector("#grant-spell-type");
  const spellGrant = document.querySelector("#skill-grant-spell");
  const parameterControls = [
    { field: "parameter", id: "skill-spell-parameter" },
    { field: "targetLimit", id: "skill-spell-target-limit" },
  ].map(({ field, id }) => ({
    field,
    row: document.querySelector("#" + id + "-row"),
    label: document.querySelector("#" + id + "-label"),
    input: document.querySelector("#" + id),
  }));
  const weaponGrants = [
    { id: "weapon", field: "weaponsByToken", catalog: WEAPONS, available: availableWeapons, defaultId: DEFAULT_WEAPON },
    { id: "ranged-weapon", field: "rangedWeaponsByToken", catalog: RANGED_WEAPONS, available: availableRangedWeapons },
  ].map((definition) => ({
    ...definition,
    select: document.querySelector("#grant-" + definition.id + "-type"),
    checkbox: document.querySelector("#skill-grant-" + definition.id),
  }));
  const status = document.querySelector("#skill-gm-status");
  const assignTab = document.querySelector("#skill-assign-tab");
  const statsTab = document.querySelector("#skill-grant-stats-tab");
  const assignPanel = document.querySelector("#skill-assign");
  const statsPanel = document.querySelector("#skill-grant-stats");
  const showStats = setupStatsEditor(obr, statsPanel.querySelector("form"), { gm: true });
  let sceneTokens = new Map();

  const showSelectedStats = () => showStats(allowed ? sceneTokens.get(tokens.value) : undefined);
  function selectGrantView(stats) {
    assignPanel.hidden = stats;
    statsPanel.hidden = !stats;
    assignTab.setAttribute("aria-pressed", String(!stats));
    statsTab.setAttribute("aria-pressed", String(stats));
    showSelectedStats();
  }
  assignTab.addEventListener("click", () => selectGrantView(false));
  statsTab.addEventListener("click", () => selectGrantView(true));
  let revision = 0;
  let allowed = false;
  let saving = false;
  let roster;

  for (const { select, catalog, defaultId } of weaponGrants) {
    for (const [id, name] of Object.entries(catalog)) {
      if (id !== defaultId) select.add(new Option(name, id));
    }
  }
  for (const id of SPELLS) {
    if (id !== "sleep") spell.add(new Option(SKILLS[id].name, id));
  }
  for (const name of TEAMS) team.add(new Option(name, name));
  for (const mode of FRIENDLY_FIRE_MODES) friendlyFire.add(new Option(mode, mode));

  function render(config) {
    enabled.disabled = !allowed || saving;
    enabled.checked = config.enabled === true;
    friendlyFire.disabled = !allowed || saving;
    friendlyFire.value = friendlyFireMode(config);
    tokens.disabled = !allowed || saving || tokens.options.length <= 1;
    useSelectedToken.disabled = tokens.disabled;
    showSelectedStats();
    const disableGrants = !allowed || saving || !tokens.value;
    spell.disabled = team.disabled = disableGrants;
    teamGrant.disabled = disableGrants || !team.value;
    const assignedTeams = tokenTeams(config, tokens.value);
    teamGrant.checked = assignedTeams.includes(team.value);
    for (const option of team.options) {
      option.text = option.value + (assignedTeams.includes(option.value) ? " (assigned)" : "");
    }
    spellGrant.disabled = disableGrants || !spell.value;
    const grantedSpells = availableSpells(config, tokens.value);
    spellGrant.checked = grantedSpells.includes(spell.value);
    for (const { field, row, label, input } of parameterControls) {
      const parameter = SKILLS[spell.value]?.[field];
      row.hidden = !tokens.value || !parameter;
      input.disabled = disableGrants || !parameter || !spellGrant.checked;
      if (!parameter || !tokens.value) continue;
      label.textContent = parameter.label;
      input.min = parameter.min;
      input.placeholder = String(parameter.defaultValue);
      input.valueAsNumber = spellParameter(config, tokens.value, spell.value, field);
    }
    for (const option of spell.options) {
      option.text = SKILLS[option.value].name + (grantedSpells.includes(option.value) ? " (granted)" : "");
    }
    for (const { select, checkbox, catalog, field, available } of weaponGrants) {
      select.disabled = disableGrants;
      checkbox.disabled = disableGrants || !select.value;
      const grantedWeapons = available(config[field]?.[tokens.value]);
      checkbox.checked = grantedWeapons.includes(select.value);
      for (const option of select.options) {
        option.text = catalog[option.value] + (grantedWeapons.includes(option.value) ? " (granted)" : "");
      }
    }
  }

  async function refresh(sceneItems) {
    const requested = ++revision;
    try {
      const { self, gm } = await skillConnections(obr);
      if (requested !== revision) return;
      allowed = self.role === "GM" && self.connectionId === gm?.connectionId;
      if (!allowed || !await obr.scene.isReady()) {
        if (requested !== revision) return;
        sceneTokens.clear();
        tokens.replaceChildren(new Option("choose a token", ""));
        status.textContent = allowed ? "Open a scene to grant skills."
          : self.role === "GM" ? "Another connected GM is handling skills." : "";
      } else {
        const [items, selection] = await Promise.all([
          sceneItems ?? obr.scene.items.getItems(isPublicToken), obr.player.getSelection(),
        ]);
        if (requested !== revision) return;
        sceneTokens = new Map(items.map((token) => [token.id, token]));
        roster = rosterKey(items);
        const choice = tokens.value || selection?.[0];
        items.sort((a, b) => characterLabel(a).localeCompare(characterLabel(b)));
        tokens.replaceChildren(new Option("choose a token", ""),
          ...items.map((token) => new Option(characterLabel(token), token.id)));
        tokens.value = items.some((token) => token.id === choice) ? choice : "";
        status.textContent = "";
      }
      render(readSkills(obr, "gm"));
    } catch {
      if (requested === revision) status.textContent = "Couldn’t load skill grants.";
    }
  }

  async function save(change) {
    if (saving) return;
    saving = true;
    enabled.disabled = tokens.disabled = useSelectedToken.disabled = spell.disabled = spellGrant.disabled =
      friendlyFire.disabled = team.disabled = teamGrant.disabled = true;
    for (const { select, checkbox } of weaponGrants) select.disabled = checkbox.disabled = true;
    for (const { input } of parameterControls) input.disabled = true;
    try {
      const { self, gm } = await skillConnections(obr);
      if (self.role !== "GM" || gm?.connectionId !== self.connectionId) throw Error("The connected skills GM must save grants.");
      const config = readSkills(obr, "gm");
      let grant;
      if (change.tokenId) {
        const [token] = await obr.scene.items.getItems([change.tokenId]);
        if (!isPublicToken(token) || change.tokenId !== tokens.value) throw Error("Choose a token in the open scene.");
        if (change.team) {
          if (!TEAMS.includes(change.team)) return;
          const assigned = new Set(tokenTeams(config, token.id));
          if (change.grant) assigned.add(change.team);
          else assigned.delete(change.team);
          config.teamsByToken = { ...config.teamsByToken, [token.id]: [...assigned] };
        } else if (change.weapon) {
          const { id, field, catalog, available, defaultId } = change.weaponGrant;
          if (!Object.hasOwn(catalog, change.weapon) || change.weapon === defaultId) return;
          const granted = new Set(available(config[field]?.[token.id]).filter((id) => id !== defaultId));
          if (change.grant) {
            if (!granted.has(change.weapon)) grant = { kind: id, variant: change.weapon };
            granted.add(change.weapon);
          } else granted.delete(change.weapon);
          config[field] = { ...config[field], [token.id]: [...granted] };
        } else {
          if (change.spell === "sleep" || !SPELLS.includes(change.spell)) return;
          const ids = new Set(availableSpells(config, token.id));
          if (Object.hasOwn(change, "parameter")) {
            const definition = SKILLS[change.spell][change.field];
            if (!ids.has(change.spell) || !definition) return;
            const tokenParameters = { ...config.spellParametersByToken?.[token.id] };
            const saved = tokenParameters[change.spell];
            const values = typeof saved === "number" ? { parameter: saved } : { ...saved };
            if (change.parameter === null) delete values[change.field];
            else {
              if (!validSpellParameter(change.spell, change.parameter, change.field)) {
                throw Error(definition.integer ? "Enter a whole number of at least 1." : "Enter a number of cells of at least 1.");
              }
              values[change.field] = change.parameter;
            }
            tokenParameters[change.spell] = values;
            config.spellParametersByToken = { ...config.spellParametersByToken, [token.id]: tokenParameters };
          } else {
            if (change.grant) {
              if (!ids.has(change.spell)) grant = { kind: "spell", variant: change.spell };
              ids.add(change.spell);
            } else ids.delete(change.spell);
            config.spellsByToken = { ...config.spellsByToken, [token.id]: [...ids] };
          }
        }
      } else if (Object.hasOwn(change, "friendlyFire")) {
        if (!FRIENDLY_FIRE_MODES.includes(change.friendlyFire)) return;
        config.friendlyFire = change.friendlyFire;
      } else config.enabled = change.enabled;
      writeSkills(obr, "gm", config);
      status.textContent = "";
      const data = grant ? { grant: { ...grant, id: crypto.randomUUID(), tokenId: change.tokenId } } : {};
      await obr.broadcast.sendMessage(SKILL_CHANGED, data, { destination: "ALL" });
    } catch (error) {
      status.textContent = error.message || "Couldn’t save skill settings.";
    } finally {
      saving = false;
      render(readSkills(obr, "gm"));
    }
  }
  enabled.addEventListener("change", () => { void save({ enabled: enabled.checked }); });
  friendlyFire.addEventListener("change", () => { void save({ friendlyFire: friendlyFire.value }); });
  tokens.addEventListener("change", () => {
    status.textContent = "";
    render(readSkills(obr, "gm"));
  });
  useSelectedToken.addEventListener("click", async () => {
    const requested = revision;
    try {
      const selection = new Set(await obr.player.getSelection());
      if (requested !== revision || useSelectedToken.disabled || !isOpen()) return;
      const matches = Array.from(tokens.options).filter(({ value }) => value && selection.has(value));
      if (matches.length !== 1) {
        status.textContent = "Select one character token on the map.";
        return;
      }
      tokens.value = matches[0].value;
      status.textContent = "";
      render(readSkills(obr, "gm"));
    } catch {
      if (requested === revision && !useSelectedToken.disabled && isOpen()) {
        status.textContent = "Couldn’t read the map selection.";
      }
    }
  });
  team.addEventListener("change", () => render(readSkills(obr, "gm")));
  teamGrant.addEventListener("change", () => {
    if (tokens.value && team.value) void save({ tokenId: tokens.value, team: team.value, grant: teamGrant.checked });
  });
  spell.addEventListener("change", () => render(readSkills(obr, "gm")));
  spellGrant.addEventListener("change", () => {
    if (tokens.value && spell.value) void save({ tokenId: tokens.value, spell: spell.value, grant: spellGrant.checked });
  });
  for (const { field, input } of parameterControls) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
    input.addEventListener("change", () => {
      if (input.disabled) return;
      const parameter = !input.value && !input.validity.badInput ? null : input.valueAsNumber;
      void save({ tokenId: tokens.value, spell: spell.value, field, parameter });
    });
  }
  for (const weaponGrant of weaponGrants) {
    const { select, checkbox } = weaponGrant;
    select.addEventListener("change", () => render(readSkills(obr, "gm")));
    checkbox.addEventListener("change", () => {
      if (tokens.value && select.value) {
        void save({ tokenId: tokens.value, weapon: select.value, weaponGrant, grant: checkbox.checked });
      }
    });
  }
  const isOpen = () => !tokens.closest("[hidden]");
  const rosterKey = (items) => JSON.stringify(items.map((item) => [item.id, item.name]).sort());
  obr.scene.onReadyChange((ready) => {
    if (!ready) {
      sceneTokens.clear();
      showSelectedStats();
    }
    if (isOpen()) void refresh();
  });
  obr.scene.items.onChange((items) => {
    if (!allowed || !isOpen()) return;
    const characters = items.filter(isPublicToken);
    sceneTokens = new Map(characters.map((token) => [token.id, token]));
    showSelectedStats();
    if (roster !== rosterKey(characters)) {
      roster = rosterKey(characters);
      void refresh(characters);
    }
  });
  obr.party.onChange(() => { if (isOpen()) void refresh(); });
  return refresh;
}
