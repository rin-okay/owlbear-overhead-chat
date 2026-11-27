import {
  KEY_ACTIONS, actionForChord, assignBinding, bindingLabel, bindingStorageKey,
  eventChord, keyboardProfile, keyIdentity, writeKeyboard,
} from "./key-bindings.js?v=3.1.0";
import { isProjectileToken } from "./projectile-collision.js?v=2.9.10";
import { spellDamageFormula } from "./spell-damage.js?v=2.9.13";
import { readTokenStats } from "./stats.js?v=3.1.0";
import {
  DEFAULT_WEAPON, FACINGS, RANGED_WEAPONS, SKILLS, SKILL_CHANGED, SKILL_REQUEST, SKILL_RESULT, WEAPONS,
  aimsAtLocation, readSkills, rememberCustomSkills, skillConnections, syncClientSkills, writeSkills,
} from "./skills.js?v=3.1.0";

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
  let weaponLabels = {};
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
    weapon.replaceChildren(...options.map((id) => new Option(weaponLabels[id] ?? WEAPONS[id], id)));
    weapon.value = selectedWeapon(avatar?.id);
    weapon.disabled = !enabled;
    rangedWeapon.replaceChildren(...rangedWeapons.map((id) => new Option(weaponLabels[id] ?? RANGED_WEAPONS[id], id)));
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
    const skill = SKILLS[id];
    const melee = id === "spear" || skill?.uses === "weapon";
    const ranged = id === "ranged" || skill?.uses === "ranged-weapon";
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
        ...(melee ? { weapon: selectedWeapon(token.id) } : {}),
        ...(ranged ? { weapon: selectedRangedWeapon(token.id) } : {}),
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
    syncClientSkills(obr);
    avatar = token;
    const revision = ++listRevision;
    clearPending("list");
    if (changed) {
      available = [];
      weapons = [];
      rangedWeapons = [];
      weaponLabels = {};
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
      rememberCustomSkills(obr, data.customSkills);
      available = data.skills.filter((id) => Object.hasOwn(SKILLS, id));
      enabled = data.enabled === true;
      weaponLabels = data.weaponLabels ?? {};
      const isKnown = (catalog, id) => Object.hasOwn(catalog, id) || typeof weaponLabels[id] === "string";
      weapons = (data.weapons ?? []).filter((id) => isKnown(WEAPONS, id));
      rangedWeapons = (data.rangedWeapons ?? []).filter((id) => isKnown(RANGED_WEAPONS, id));
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
