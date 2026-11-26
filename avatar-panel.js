import OBR from "./obr.js";
import { BUILTIN_EMOTES } from "./emotes.js?v=2.7.21";
import { SKILLS, SPELLS } from "./skills.js?v=2.11.12";
import { isPublicToken } from "./rules.js";
import {
  savedAvatarSlots, saveAvatarSlot, savedAvatarMode, saveAvatarMode,
  savedQuickbarSlots, saveQuickbarSlot,
} from "./session.js?v=2.9.16";

export function setupAvatarPanel(panel, openDialog = (open) => open()) {
  const list = panel.querySelector("#avatar-slots");
  const talkPanel = panel.querySelector("#avatar-talk-panel");
  const changePanel = panel.querySelector("#avatar-change-panel");
  const talkButton = panel.querySelector("#avatar-talk");
  const changeButton = panel.querySelector("#avatar-change");
  const views = [
    ["talk", talkButton, talkPanel],
    ["change", changeButton, changePanel],
  ];
  // A cached popover can still have the two-tab markup after the JavaScript updates.
  const bindingsButton = panel.querySelector("#avatar-bindings");
  const bindingsPanel = panel.querySelector("#avatar-bindings-panel");
  if (bindingsButton && bindingsPanel) views.push(["bindings", bindingsButton, bindingsPanel]);

  const status = talkPanel.querySelector("[role=status]");
  let canTalk = false;
  const selects = Array.from({ length: 9 }, (_, index) => {
    const row = document.createElement("label");
    row.append(String(index + 1));
    const select = document.createElement("select");
    select.disabled = true;
    select.addEventListener("change", () => {
      if (canTalk) saveAvatarSlot(index, select.value);
    });
    row.append(select);
    list.append(row);
    return select;
  });
  let revision = 0;
  let lastChoices;

  const showSpells = setupQuickbar(changePanel, openDialog);

  let activeView = "change";
  function selectView(mode) {
    activeView = mode;
    for (const [id, button, view] of views) {
      button.setAttribute("aria-pressed", String(id === mode));
      view.hidden = id !== mode;
    }
  }

  for (const [mode, button] of views) {
    button.addEventListener("click", () => {
      if (mode === "talk" && !canTalk) return;
      if (canTalk && mode !== "bindings") saveAvatarMode(mode);
      selectView(mode);
      if (mode === "talk") void loadTokens();
    });
  }
  const refresh = (items, role) => {
    const gm = role === "GM";
    if (gm !== canTalk) {
      canTalk = gm;
      talkButton.hidden = !gm;
      if (activeView !== "bindings") selectView(gm ? savedAvatarMode() : "change");
      ++revision;
    }
    return loadTokens(items);
  };
  return { refresh, showSpells };

  async function loadTokens(items) {
    if (!canTalk || panel.hidden || talkPanel.hidden) return;
    const requested = ++revision;
    try {
      const ready = await OBR.scene.isReady();
      const tokens = ready ? (items ?? await OBR.scene.items.getItems()) : [];
      if (requested !== revision || panel.hidden || talkPanel.hidden) return;
      const choices = tokens.filter((token) => isPublicToken(token) && !token.locked)
        .map(({ id, name }) => ({ id, name: name || "Unnamed token" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      status.textContent = ready ? "" : "Open a scene to assign avatars.";
      const signature = JSON.stringify([ready, choices, savedAvatarSlots()]);
      if (signature === lastChoices) return;
      lastChoices = signature;
      for (const [index, select] of selects.entries()) {
        const saved = savedAvatarSlots()[index];
        select.replaceChildren(new Option("No avatar", ""));
        if (saved && !choices.some(({ id }) => id === saved)) {
          select.add(new Option("Unavailable token", saved));
        }
        for (const { id, name } of choices) select.add(new Option(name, id));
        select.value = saved;
        select.disabled = !ready;
      }
    } catch {
      if (requested === revision) status.textContent = "Couldn’t load scene tokens.";
    }
  }
}

function setupQuickbar(panel, openDialog) {
  const list = panel.querySelector("#avatar-art-slots");
  const status = panel.querySelector("[role=status]");
  const slots = savedQuickbarSlots();
  const picker = panel.querySelector("#avatar-scene-art");
  const source = panel.querySelector("#avatar-art-source");
  const use = panel.querySelector("#avatar-art-use");
  const cancel = panel.querySelector("#avatar-art-cancel");
  let spells = [];
  let pending;
  let opening = false;

  function closePicker(restoreFocus = false) {
    const previous = pending;
    pending = undefined;
    picker.hidden = true;
    source.replaceChildren();
    if (restoreFocus) previous?.control.focus();
  }

  function assignImage(index, kind, asset) {
    const value = kind === "avatar" ? { kind, artwork: asset }
      : { kind, emote: { image: asset.image }, name: asset.name };
    if (!saveQuickbarSlot(index, value)) throw Error("This image couldn’t be saved. Choose another asset.");
  }

  async function chooseImage(index, kind, control, render) {
    if (opening) { render(); return; }
    opening = true;
    closePicker();
    control.disabled = true;
    status.textContent = "";
    try {
      let assets;
      try {
        assets = await openDialog(() =>
          OBR.assets.downloadImages(false, undefined, kind === "avatar" ? "CHARACTER" : undefined));
      } catch {
        if (!await OBR.scene.isReady()) throw Error("Open a scene to choose an image from one of your tokens.");
        const tokens = await OBR.scene.items.getItems((item) => item.type === "IMAGE" &&
          item.visible === true && item.createdUserId === OBR.player.id && (kind === "emote" || isPublicToken(item)));
        if (panel.closest("[hidden]")) return;
        if (!tokens.length) throw Error("The assets picker is unavailable. Place the image in the scene first, or ask the GM to assign you as its owner.");
        tokens.sort((left, right) => (left.name || "").localeCompare(right.name || ""));
        source.replaceChildren(...tokens.map((token) => new Option(token.name || "unnamed image", token.id)));
        pending = { index, kind, control, render, tokens };
        picker.hidden = false;
        status.textContent = "Choose an image for slot " + ((index + 1) % 10) + ".";
        source.focus();
        return;
      }
      const [asset] = assets;
      if (!asset) return;
      if (kind === "avatar" && asset.type !== "CHARACTER") throw Error("Choose an image from Characters.");
      assignImage(index, kind, asset);
    } catch (error) {
      status.textContent = error?.message || "Couldn’t load this image.";
    } finally {
      opening = false;
      control.disabled = false;
      render();
    }
  }

  use.addEventListener("click", () => {
    if (!pending) return;
    try {
      const { index, kind, render, tokens } = pending;
      const token = tokens.find(({ id }) => id === source.value);
      if (!token) return;
      assignImage(index, kind, token);
      render();
      closePicker(true);
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  cancel.addEventListener("click", () => {
    closePicker(true);
    status.textContent = "";
  });

  const renderSpells = slots.map((saved, index) => {
    const key = (index + 1) % 10;
    const number = document.createElement("span");
    number.textContent = key;
    const row = document.createElement("div");
    row.className = "avatar-art-slot";
    const type = document.createElement("select");
    type.setAttribute("aria-label", "slot " + key + " type");
    for (const [id, name] of [["", "empty"], ["avatar", "avatar"], ["emote", "emote"], ["spell", "spell"]]) {
      type.add(new Option(name, id));
    }
    type.value = saved?.kind ?? "";
    const art = document.createElement("button");
    art.type = "button";
    const emote = document.createElement("select");
    emote.setAttribute("aria-label", "slot " + key + " emote");
    const spell = document.createElement("select");
    spell.setAttribute("aria-label", "slot " + key + " spell");
    const updateSpells = () => {
      const current = slots[index]?.skill;
      spell.replaceChildren(new Option(spells.length ? "choose spell" : "no granted spells", ""),
        ...spells.map((id) => new Option(SKILLS[id].name, id)));
      if (current && !spells.includes(current) && Object.hasOwn(SKILLS, current)) {
        spell.add(new Option(SKILLS[current].name + " (unavailable)", current));
      }
      spell.value = current || "";
    };
    function render() {
      const value = slots[index];
      art.hidden = type.value !== "avatar";
      emote.hidden = type.value !== "emote";
      spell.hidden = type.value !== "spell";
      art.textContent = value?.artwork?.name ?? "choose art";
      art.title = art.textContent;
      emote.replaceChildren(new Option("choose emote", ""),
        ...Object.entries(BUILTIN_EMOTES).map(([id, glyph]) => new Option(glyph + " " + id, id)),
        new Option("choose asset…", "custom"));
      if (value?.emote?.image) emote.add(new Option(value.name || "custom image", "image"));
      emote.value = value?.emote?.id ?? (value?.emote?.image ? "image" : "");
      updateSpells();
    }
    type.addEventListener("change", () => {
      if (opening) { type.value = slots[index]?.kind ?? ""; return; }
      if (pending?.index === index) closePicker();
      saveQuickbarSlot(index, null);
      render();
    });
    art.addEventListener("click", () => void chooseImage(index, "avatar", art, render));
    emote.addEventListener("change", () => {
      if (emote.value === "custom") {
        void chooseImage(index, "emote", emote, render);
        return;
      }
      if (Object.hasOwn(BUILTIN_EMOTES, emote.value)) {
        if (pending?.index === index) closePicker();
        saveQuickbarSlot(index, { kind: "emote", emote: { id: emote.value } });
      }
      render();
    });
    spell.addEventListener("change", () => {
      if (spells.includes(spell.value)) saveQuickbarSlot(index, { kind: "spell", skill: spell.value });
      updateSpells();
    });
    render();
    row.append(number, type, art, emote, spell);
    list.append(row);
    return updateSpells;
  });
  return (available) => {
    const next = SPELLS.filter((id) => available.includes(id));
    if (next.join() === spells.join()) return;
    spells = next;
    renderSpells.forEach((update) => update());
  };
}
