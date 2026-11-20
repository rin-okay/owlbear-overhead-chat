import OBR from "./obr.js";
import { canSpeak } from "./rules.js";
import { savedAvatarSlots, saveAvatarSlot } from "./session.js";

export function setupAvatarPanel(panel) {
  const list = panel.querySelector("#avatar-slots");
  const status = panel.querySelector("[role=status]");
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

  return async function load(items) {
    if (panel.hidden) return;
    const requested = ++revision;
    try {
      const ready = await OBR.scene.isReady();
      const [role, permissions, tokens] = ready ? await Promise.all([
        OBR.player.getRole(), OBR.room.getPermissions(), items ?? OBR.scene.items.getItems(),
      ]) : [null, [], []];
      if (requested !== revision || panel.hidden) return;
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
  };
}
