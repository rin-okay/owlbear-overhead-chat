import OBR from "./obr.js";
import { isPublicToken } from "./rules.js";
import {
  savedAvatarSlots, saveAvatarSlot, savedAvatarMode, saveAvatarMode,
  savedAvatarArtSlots, saveAvatarArtSlot,
} from "./session.js?v=2.7.8";

export function setupAvatarPanel(panel) {
  const list = panel.querySelector("#avatar-slots");
  const talkPanel = panel.querySelector("#avatar-talk-panel");
  const changePanel = panel.querySelector("#avatar-change-panel");
  const talkButton = panel.querySelector("#avatar-talk");
  const changeButton = panel.querySelector("#avatar-change");
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

  setupArtSlots(changePanel);

  function showMode(mode) {
    const change = mode === "change";
    talkButton.setAttribute("aria-pressed", String(!change));
    changeButton.setAttribute("aria-pressed", String(change));
    talkPanel.hidden = change;
    changePanel.hidden = !change;
  }

  for (const [button, mode] of [[talkButton, "talk"], [changeButton, "change"]]) {
    button.addEventListener("click", () => {
      if (!canTalk) return;
      saveAvatarMode(mode);
      showMode(mode);
      void loadTokens();
    });
  }
  return (items, role) => {
    const gm = role === "GM";
    if (gm !== canTalk) {
      canTalk = gm;
      talkButton.hidden = !gm;
      showMode(gm ? savedAvatarMode() : "change");
      ++revision;
    }
    return loadTokens(items);
  };

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

function setupArtSlots(panel) {
  const list = panel.querySelector("#avatar-art-slots");
  const status = panel.querySelector("[role=status]");
  const slots = savedAvatarArtSlots();
  const picker = panel.querySelector("#avatar-scene-art");
  const source = panel.querySelector("#avatar-art-source");
  const use = panel.querySelector("#avatar-art-use");
  const cancel = panel.querySelector("#avatar-art-cancel");
  let pending;
  let opening = false;

  function closeScenePicker(restoreFocus = false) {
    const previous = pending;
    pending = undefined;
    picker.hidden = true;
    source.replaceChildren();
    if (restoreFocus) previous?.button.focus();
  }

  async function openScenePicker(index, button, render) {
    if (!await OBR.scene.isReady()) {
      status.textContent = "open a scene to choose artwork from one of your tokens.";
      return;
    }
    const tokens = await OBR.scene.items.getItems((item) =>
      isPublicToken(item) && item.createdUserId === OBR.player.id);
    if (panel.closest("[hidden]")) return;
    if (!tokens.length) {
      status.textContent = "the characters picker is unavailable. add your artwork as a token from the characters dock, or ask the gm to place it and assign you as its owner.";
      return;
    }
    tokens.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    source.replaceChildren(...tokens.map((token) => new Option(token.name || "unnamed token", token.id)));
    pending = { index, button, render, tokens };
    picker.hidden = false;
    status.textContent = "choose scene artwork for slot " + (index + 1) + ".";
    source.focus();
  }

  use.addEventListener("click", () => {
    if (!pending) return;
    const token = pending.tokens.find(({ id }) => id === source.value);
    if (!token || !saveAvatarArtSlot(pending.index, token)) {
      status.textContent = "this token’s artwork couldn’t be saved. choose another token.";
      return;
    }
    pending.render();
    closeScenePicker(true);
    status.textContent = "";
  });

  cancel.addEventListener("click", () => {
    closeScenePicker(true);
    status.textContent = "";
  });

  slots.forEach((_, index) => {
    const slot = index + 1;
    const row = document.createElement("div");
    row.className = "avatar-art-slot";
    const number = document.createElement("span");
    number.textContent = slot;
    const choose = document.createElement("button");
    choose.type = "button";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "clear";
    clear.setAttribute("aria-label", `clear artwork from slot ${slot}`);

    function render() {
      const name = slots[index]?.name;
      choose.textContent = name ?? "choose art";
      choose.title = name ?? "choose character artwork";
      choose.setAttribute("aria-label", name ? `change art in slot ${slot}: ${name}` : `choose art for slot ${slot}`);
      clear.disabled = !name;
    }
    render();
    row.append(number, choose, clear);
    list.append(row);

    choose.addEventListener("click", async () => {
      if (opening) return;
      opening = true;
      closeScenePicker();
      choose.disabled = true;
      clear.disabled = true;
      status.textContent = "";
      try {
        let assets;
        try {
          assets = await OBR.assets.downloadImages(false, undefined, "CHARACTER");
        } catch {
          await openScenePicker(index, choose, render);
          return;
        }
        const [asset] = assets;
        if (!asset) return;
        if (asset.type !== "CHARACTER") throw new Error("choose an image from characters.");
        if (!saveAvatarArtSlot(index, asset)) throw new Error("this artwork couldn’t be saved.");
      } catch (error) {
        status.textContent = error?.message || "couldn’t load character artwork.";
      } finally {
        opening = false;
        choose.disabled = false;
        render();
      }
    });

    clear.addEventListener("click", () => {
      if (pending?.index === index) closeScenePicker();
      saveAvatarArtSlot(index, null);
      status.textContent = "";
      render();
    });
  });
}
