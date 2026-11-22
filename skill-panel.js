import { isPublicToken } from "./rules.js";
import {
  DEFAULT_WEAPON, FACINGS, FRIENDLY_FIRE_MODES, SKILLS, SKILL_CHANGED, SKILL_REQUEST, SKILL_RESULT, SPELLS, TEAMS, WEAPONS,
  availableSpells, availableWeapons, friendlyFireMode, readSkills, skillConnections, spellParameter, tokenTeams, validSpellParameter, writeSkills,
} from "./skills.js?v=2.7.4";

function characterLabel(token) {
  return token.name || "unnamed character";
}

function facingFor(settings, token) {
  const facing = settings.facings?.[token?.image?.url];
  return FACINGS.some(([angle]) => angle === facing) ? facing : 0;
}

export function setupSkillPanel(obr, getAvatar, keyAllowed) {
  const playerPanel = document.querySelector("#player-skills");
  const playerStatus = document.querySelector("#skill-settings-status");
  const castStatus = document.querySelector("#skill-cast-status");
  const facing = document.querySelector("#skill-facing");
  const weapon = document.querySelector("#skill-weapon");
  const preview = document.querySelector("#skill-avatar-preview");
  const portrait = preview.querySelector("img");
  const arrow = preview.querySelector("span");
  const bindInputs = Object.fromEntries(Object.keys(SKILLS).map((id) =>
    [id, document.querySelector("#skill-bind-" + id)]));
  const pending = new Map();
  let preferences = readSkills(obr, "player");
  let avatar;
  let available = [];
  let weapons = [];
  let enabled = false;
  let castStatusTimer;
  let listRevision = 0;

  function binding(id) {
    const key = preferences.bindings?.[id];
    if (key === "" || keyAllowed(key)) return key;
    const defaultKey = SKILLS[id].key;
    return Object.keys(SKILLS).some((other) => preferences.bindings?.[other] === defaultKey) ? "" : defaultKey;
  }

  function selectedWeapon(tokenId) {
    const selected = preferences.weaponsByToken?.[tokenId];
    return tokenId === avatar?.id && weapons.includes(selected) ? selected : DEFAULT_WEAPON;
  }

  function setCastStatus(text) {
    clearTimeout(castStatusTimer);
    castStatus.textContent = text;
    if (text) castStatusTimer = setTimeout(() => { castStatus.textContent = ""; }, 4200);
  }

  function render() {
    facing.disabled = !avatar;
    facing.value = String(facingFor(preferences, avatar));
    arrow.style.transform = `rotate(${facing.value}deg)`;
    const options = weapons.length ? weapons : [DEFAULT_WEAPON];
    weapon.replaceChildren(...options.map((id) => new Option(WEAPONS[id], id)));
    weapon.value = selectedWeapon(avatar?.id);
    weapon.disabled = !enabled;
    for (const [id, select] of Object.entries(bindInputs)) {
      select.closest("label").hidden = !available.includes(id);
      select.value = binding(id);
      select.disabled = !enabled;
    }
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
  for (const [id, select] of Object.entries(bindInputs)) {
    select.add(new Option("unbound", ""));
    for (const key of "abcdefghijklmnopqrstuvwxyz") {
      if (keyAllowed(key)) select.add(new Option(key.toUpperCase(), key));
    }
    select.addEventListener("change", () => {
      const key = select.value;
      const other = Object.keys(SKILLS).find((other) => key && other !== id && binding(other) === key);
      if (other && available.includes(other)) {
        playerStatus.textContent = "That key is already bound to a skill.";
        render();
        return;
      }
      const bindings = { ...preferences.bindings, [id]: key };
      if (other) bindings[other] = "";
      savePreferences({ ...preferences, bindings });
    });
  }

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

  async function request(type, token, id, revision) {
    const [{ gm, self }, selection] = await Promise.all([
      skillConnections(obr), type === "cast" ? obr.player.getSelection().catch(() => undefined) : undefined,
    ]);
    const candidates = selection?.filter((itemId) => itemId !== token.id);
    const targetId = candidates?.length === 1 ? candidates[0] : undefined;
    if (type === "list" && revision !== listRevision) return;
    const showStatus = type === "cast" ? setCastStatus : (text) => { playerStatus.textContent = text; };
    if (!gm) {
      showStatus("The GM needs to be connected to use skills.");
      return;
    }
    const requestId = crypto.randomUUID();
    const expected = {
      requestId, gm: gm.connectionId, target: self.connectionId, tokenId: token.id,
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
        ...(type === "cast" ? { skill: id, facing: facingFor(preferences, token) } : {}),
        ...(id === "spear" ? { weapon: selectedWeapon(token.id) } : {}),
        ...(targetId ? { targetId } : {}),
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
      if (type === "cast") setCastStatus(data.error || "");
      if (data.tokenId !== avatar?.id || !Array.isArray(data.skills)) return;
      available = data.skills.filter((id) => Object.hasOwn(SKILLS, id));
      enabled = data.enabled === true;
      weapons = availableWeapons(data.weapons);
      playerStatus.textContent = data.error || (enabled ? "" : "The GM hasn’t enabled skill hotkeys.");
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

  async function cast(id, token) {
    if (pending.has("cast")) return;
    try {
      await request("cast", token, id);
    } catch {
      setCastStatus("Couldn’t send the cast to the GM.");
    }
  }

  return { refresh, cast, skillForKey: (key) => Object.keys(SKILLS).find((id) => binding(id) === key) };
}

export function setupSkillGrants(obr) {
  const enabled = document.querySelector("#skill-enabled");
  const friendlyFire = document.querySelector("#skill-friendly-fire");
  const team = document.querySelector("#grant-team-type");
  const teamGrant = document.querySelector("#skill-grant-team");
  const tokens = document.querySelector("#skill-token");
  const spell = document.querySelector("#grant-spell-type");
  const spellGrant = document.querySelector("#skill-grant-spell");
  const parameterRow = document.querySelector("#skill-spell-parameter-row");
  const parameterLabel = document.querySelector("#skill-spell-parameter-label");
  const parameterField = document.querySelector("#skill-spell-parameter");
  const weapon = document.querySelector("#grant-weapon-type");
  const weaponGrant = document.querySelector("#skill-grant-weapon");
  const status = document.querySelector("#skill-gm-status");
  let revision = 0;
  let allowed = false;
  let saving = false;
  let roster;

  for (const [id, name] of Object.entries(WEAPONS)) {
    if (id !== DEFAULT_WEAPON) weapon.add(new Option(name, id));
  }
  for (const id of SPELLS) spell.add(new Option(SKILLS[id].name, id));
  for (const name of TEAMS) team.add(new Option(name, name));
  for (const mode of FRIENDLY_FIRE_MODES) friendlyFire.add(new Option(mode, mode));

  function render(config) {
    enabled.disabled = !allowed || saving;
    enabled.checked = config.enabled === true;
    friendlyFire.disabled = !allowed || saving;
    friendlyFire.value = friendlyFireMode(config);
    tokens.disabled = !allowed || saving || tokens.options.length <= 1;
    const disableGrants = !allowed || saving || !tokens.value;
    spell.disabled = weapon.disabled = team.disabled = disableGrants;
    teamGrant.disabled = disableGrants || !team.value;
    const assignedTeams = tokenTeams(config, tokens.value);
    teamGrant.checked = assignedTeams.includes(team.value);
    for (const option of team.options) {
      option.text = option.value + (assignedTeams.includes(option.value) ? " (assigned)" : "");
    }
    spellGrant.disabled = disableGrants || !spell.value;
    weaponGrant.disabled = disableGrants || !weapon.value;
    const grantedSpells = availableSpells(config, tokens.value);
    spellGrant.checked = grantedSpells.includes(spell.value);
    const parameter = SKILLS[spell.value]?.parameter;
    parameterRow.hidden = !tokens.value || !parameter;
    parameterField.disabled = disableGrants || !parameter || !spellGrant.checked;
    if (parameter && tokens.value) {
      parameterLabel.textContent = parameter.label;
      parameterField.min = parameter.min;
      parameterField.placeholder = String(parameter.defaultValue);
      parameterField.valueAsNumber = spellParameter(config, tokens.value, spell.value);
    }
    for (const option of spell.options) {
      option.text = SKILLS[option.value].name + (grantedSpells.includes(option.value) ? " (granted)" : "");
    }
    const grantedWeapons = availableWeapons(config.weaponsByToken?.[tokens.value]);
    weaponGrant.checked = grantedWeapons.includes(weapon.value);
    for (const option of weapon.options) {
      option.text = WEAPONS[option.value] + (grantedWeapons.includes(option.value) ? " (granted)" : "");
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
        tokens.replaceChildren(new Option("choose a token", ""));
        status.textContent = allowed ? "Open a scene to grant skills."
          : self.role === "GM" ? "Another connected GM is handling skills." : "";
      } else {
        const [items, selection] = await Promise.all([
          sceneItems ?? obr.scene.items.getItems(isPublicToken), obr.player.getSelection(),
        ]);
        if (requested !== revision) return;
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
    enabled.disabled = tokens.disabled = spell.disabled = spellGrant.disabled =
      parameterField.disabled = weapon.disabled = weaponGrant.disabled =
      friendlyFire.disabled = team.disabled = teamGrant.disabled = true;
    try {
      const { self, gm } = await skillConnections(obr);
      if (self.role !== "GM" || gm?.connectionId !== self.connectionId) throw Error("The connected skills GM must save grants.");
      const config = readSkills(obr, "gm");
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
          if (!Object.hasOwn(WEAPONS, change.weapon) || change.weapon === DEFAULT_WEAPON) return;
          const granted = new Set(availableWeapons(config.weaponsByToken?.[token.id]).filter((id) => id !== DEFAULT_WEAPON));
          if (change.grant) granted.add(change.weapon);
          else granted.delete(change.weapon);
          config.weaponsByToken = { ...config.weaponsByToken, [token.id]: [...granted] };
        } else {
          if (!SPELLS.includes(change.spell)) return;
          const ids = new Set(availableSpells(config, token.id));
          if (Object.hasOwn(change, "parameter")) {
            if (!ids.has(change.spell) || !SKILLS[change.spell].parameter) return;
            const tokenParameters = { ...config.spellParametersByToken?.[token.id] };
            if (change.parameter === null) delete tokenParameters[change.spell];
            else {
              if (!validSpellParameter(change.spell, change.parameter)) {
                throw Error("Enter a number of cells of at least " + SKILLS[change.spell].parameter.min + ".");
              }
              tokenParameters[change.spell] = change.parameter;
            }
            config.spellParametersByToken = { ...config.spellParametersByToken, [token.id]: tokenParameters };
          } else {
            if (change.grant) ids.add(change.spell);
            else ids.delete(change.spell);
            config.spellsByToken = { ...config.spellsByToken, [token.id]: [...ids] };
          }
        }
      } else if (Object.hasOwn(change, "friendlyFire")) {
        if (!FRIENDLY_FIRE_MODES.includes(change.friendlyFire)) return;
        config.friendlyFire = change.friendlyFire;
      } else config.enabled = change.enabled;
      writeSkills(obr, "gm", config);
      status.textContent = "";
      await obr.broadcast.sendMessage(SKILL_CHANGED, {}, { destination: "ALL" });
    } catch (error) {
      status.textContent = error.message || "Couldn’t save skill settings.";
    } finally {
      saving = false;
      render(readSkills(obr, "gm"));
    }
  }
  enabled.addEventListener("change", () => { void save({ enabled: enabled.checked }); });
  friendlyFire.addEventListener("change", () => { void save({ friendlyFire: friendlyFire.value }); });
  tokens.addEventListener("change", () => render(readSkills(obr, "gm")));
  team.addEventListener("change", () => render(readSkills(obr, "gm")));
  teamGrant.addEventListener("change", () => {
    if (tokens.value && team.value) void save({ tokenId: tokens.value, team: team.value, grant: teamGrant.checked });
  });
  spell.addEventListener("change", () => render(readSkills(obr, "gm")));
  spellGrant.addEventListener("change", () => {
    if (tokens.value && spell.value) void save({ tokenId: tokens.value, spell: spell.value, grant: spellGrant.checked });
  });
  parameterField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") parameterField.blur();
  });
  parameterField.addEventListener("change", () => {
    if (parameterField.disabled) return;
    const parameter = !parameterField.value && !parameterField.validity.badInput ? null : parameterField.valueAsNumber;
    void save({ tokenId: tokens.value, spell: spell.value, parameter });
  });
  weapon.addEventListener("change", () => render(readSkills(obr, "gm")));
  weaponGrant.addEventListener("change", () => {
    if (tokens.value && weapon.value) void save({ tokenId: tokens.value, weapon: weapon.value, grant: weaponGrant.checked });
  });
  const isOpen = () => !tokens.closest("[hidden]");
  const rosterKey = (items) => JSON.stringify(items.map((item) => [item.id, item.name]).sort());
  obr.scene.onReadyChange(() => { if (isOpen()) void refresh(); });
  obr.scene.items.onChange((items) => {
    if (!allowed || !isOpen()) return;
    const characters = items.filter(isPublicToken);
    if (roster !== rosterKey(characters)) {
      roster = rosterKey(characters);
      void refresh(characters);
    }
  });
  obr.party.onChange(() => { if (isOpen()) void refresh(); });
  return refresh;
}
