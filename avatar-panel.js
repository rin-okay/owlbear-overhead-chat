import OBR from "./obr.js";
import { canSpeak } from "./rules.js";
import {
  savedAvatarSlots, saveAvatarSlot, savedAvatarMode, saveAvatarMode,
  savedAvatarArtSlots, saveAvatarArtSlot,
} from "./session.js";

export function setupAvatarPanel(panel) {
  const list = panel.querySelector("#avatar-slots");
  const talkPanel = panel.querySelector("#avatar-talk-panel");
  const changePanel = panel.querySelector("#avatar-change-panel");
  const talkButton = panel.querySelector("#avatar-talk");
  const changeButton = panel.querySelector("#avatar-change");
  const status = talkPanel.querySelector("[role=status]");
  const selects = Array.from({ length: 9 }, (_, index) => {
    const row = document.createElement("label");
    row.append(String(index + 1));
    const select = document.createElement("select");
    select.disabled = true;
    select.addEventListener("change", () => saveAvatarSlot(index, select.value));
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
    void load();
  }

  for (const [button, mode] of [[talkButton, "talk"], [changeButton, "change"]]) {
    button.addEventListener("click", () => {
      saveAvatarMode(mode);
      showMode(mode);
    });
  }
  showMode(savedAvatarMode());
  return load;

  async function load(items) {
    if (panel.hidden || talkPanel.hidden) return;
    const requested = ++revision;
    try {
      const ready = await OBR.scene.isReady();
      const [role, permissions, tokens] = ready ? await Promise.all([
        OBR.player.getRole(), OBR.room.getPermissions(), items ?? OBR.scene.items.getItems(),
      ]) : [null, [], []];
      if (requested !== revision || panel.hidden || talkPanel.hidden) return;
      const choices = tokens.filter((token) => !token.locked && canSpeak({ id: OBR.player.id, role }, token, permissions))
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
      choose.disabled = true;
      clear.disabled = true;
      status.textContent = "";
      try {
        const [asset] = await OBR.assets.downloadImages(false, undefined, "CHARACTER");
        if (!asset) return;
        if (asset.type !== "CHARACTER") throw new Error("Choose an image from Characters.");
        if (!saveAvatarArtSlot(index, asset)) throw new Error("This artwork couldn’t be saved.");
      } catch (error) {
        status.textContent = error?.message || "Couldn’t open the character artwork picker.";
      } finally {
        choose.disabled = false;
        render();
      }
    });

    clear.addEventListener("click", () => {
      saveAvatarArtSlot(index, null);
      status.textContent = "";
      render();
    });
  });
}
