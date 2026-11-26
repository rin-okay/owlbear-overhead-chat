import OBR from "./obr.js";
import { AVATAR, canSpeak, isPublicToken } from "./rules.js";
import { savedAvatar, savedAvatarMode, savedAvatarSlots, savedQuickbarSlots } from "./session.js?v=2.9.16";
import { SKILLS, SKILL_CHANGED, SKILL_REQUEST, SKILL_RESULT, skillConnections } from "./skills.js?v=2.11.0";
import { hotbarMode, MIN_HOTBAR_SLOTS, resizeHotbar, sendHotbarCommand } from "./hotbar.js?v=2.11.4";
import { BUILTIN_EMOTES } from "./emotes.js?v=2.7.21";

import { bindingLabel, keyboardProfile } from "./key-bindings.js?v=2.11.4";
import { handleRoomKey, openKeyboard } from "./keyboard-shortcuts.js?v=2.11.4";

const PRIORITY = "fghjklxcvbnmtyuiop";
const ICONS = {
  spear: "⚔", ranged: "🏹", bless: "✧", shield: "🛡", heart: "♥",
  sleep: "💤", missile: "✴", "burning-hands": "♨", "fire-bolt": "🔥",
  "eldritch-blast": "✷", "misty-step": "☁", shatter: "💥", fireball: "☄",
};
const SHORT_NAMES = { spear: "melee attack", ranged: "ranged attack" };
const list = document.querySelector("#hotbar");
const params = new URLSearchParams(location.search);
const left = params.get("position") === "left";
const compact = params.get("labels") === "off";
document.documentElement.classList.toggle("left", left);
document.documentElement.classList.toggle("compact", compact);

function skillSlot(key, id, unavailable = false) {
  return { key, name: SHORT_NAMES[id] ?? SKILLS[id].name, icon: ICONS[id] ?? "✦", unavailable };
}

function skillSlots(available, label) {
  const slots = [{ key: label("target"), name: "target", icon: "⊕" }];
  const order = (id) => SKILLS[id].key ? PRIORITY.indexOf(SKILLS[id].key) : PRIORITY.length;
  const ordered = Object.keys(SKILLS).sort((leftId, rightId) => order(leftId) - order(rightId));
  for (const id of ordered) {
    const key = label("skill-" + id);
    if (key && available.includes(id)) slots.push(skillSlot(key, id));
  }
  while (slots.length < MIN_HOTBAR_SLOTS) slots.push({});
  return slots;
}

function quickbarSlots(available, talkIds, tokens, label) {
  return savedQuickbarSlots().map((slot, index) => {
    const key = label("slot-" + (index + 1) % 10);
    if (talkIds && index < 9) {
      const id = talkIds[index];
      const token = tokens.get(id);
      return id ? { key, name: token?.name || "avatar", icon: "♙", image: token?.image?.url, unavailable: !token } : { key };
    }
    if (slot?.kind === "spell" && Object.hasOwn(SKILLS, slot.skill)) {
      return skillSlot(key, slot.skill, !available.includes(slot.skill));
    }
    if (slot?.kind === "emote") {
      return { key, name: slot.name || slot.emote.id || "emote", icon: BUILTIN_EMOTES[slot.emote.id] || "☺",
        image: slot.emote.image?.url };
    }
    if (slot?.kind === "avatar") {
      return { key, name: slot.artwork.name, icon: "♙", image: slot.artwork.image.url };
    }
    return { key };
  });
}

function render(available, role, tokens) {
  const quickbar = hotbarMode(OBR) === "quickbar";
  const talkIds = role === "GM" && savedAvatarMode() === "talk" ? savedAvatarSlots() : null;
  const { bindings, layout } = keyboardProfile(OBR);
  const label = (id) => bindings[id] ? bindingLabel(bindings[id], layout) : "";
  const slots = quickbar ? quickbarSlots(available, talkIds, tokens, label) : skillSlots(available, label);
  list.style.setProperty("--slot-count", slots.length);
  list.setAttribute("aria-label", quickbar ? "Quickbar slots" : "Skill hotbar");
  list.replaceChildren(...slots.map(({ key, name, icon, image, unavailable }) => {
    const slot = document.createElement("li");
    slot.className = "slot" + (!name ? " empty" : unavailable ? " unavailable" : "");
    slot.setAttribute("aria-label", name ? (key ? key + " " : "") + name + (unavailable ? ", unavailable" : "")
      : key ? key + " empty" : "empty");
    if (key) {
      const label = document.createElement("kbd");
      label.textContent = key;
      slot.append(label);
    }
    const graphic = document.createElement("span");
    graphic.className = "icon";
    graphic.setAttribute("aria-hidden", "true");
    if (image) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = image;
      img.addEventListener("error", () => { graphic.textContent = icon; }, { once: true });
      graphic.append(img);
    } else graphic.textContent = icon || "";
    const title = document.createElement("span");
    title.className = "name";
    title.textContent = name || "";
    slot.append(graphic, title);
    return slot;
  }));
  return slots.length;
}

OBR.onReady(() => {
  let available = [];
  let role;
  let tokens = new Map();
  let expected;
  let avatarId;
  let activeGM;
  let partyGms;
  let revision = 0;
  let appliedLength = MIN_HOTBAR_SLOTS;
  let resizing = Promise.resolve();
  let closed = false;
  const redraw = () => {
    const length = render(available, role, tokens);
    resizing = resizing.then(async () => {
      if (closed || appliedLength === length) return;
      await resizeHotbar(OBR, left, length, compact);
      appliedLength = length;
    }).catch(console.error);
  };
  window.addEventListener("pagehide", () => { closed = true; }, { once: true });

  async function refresh() {
    const current = ++revision;
    expected = undefined;
    if (!await OBR.scene.isReady()) {
      if (current !== revision) return;
      avatarId = undefined;
      activeGM = undefined;
      available = [];
      tokens.clear();
      redraw();
      return;
    }
    const [metadata, permissions, { gm, self }, items] = await Promise.all([
      OBR.player.getMetadata(), OBR.room.getPermissions(), skillConnections(OBR),
      OBR.scene.items.getItems(isPublicToken),
    ]);
    if (current !== revision) return;
    role = self.role;
    activeGM = gm?.connectionId;
    tokens = new Map(items.map((token) => [token.id, token]));
    const candidate = tokens.get(metadata[AVATAR]?.tokenId ?? savedAvatar());
    const avatar = canSpeak(self, candidate, permissions) && !candidate.locked ? candidate : undefined;
    if (avatarId !== avatar?.id || !gm) available = [];
    avatarId = avatar?.id;
    redraw();
    if (!avatar || !gm) return;
    expected = { gm: gm.connectionId, requestId: crypto.randomUUID(), tokenId: avatar.id };
    await OBR.broadcast.sendMessage(SKILL_REQUEST, {
      type: "list", requestId: expected.requestId, tokenId: avatar.id,
    }, { destination: "ALL" });
  }

  const reload = () => { void refresh().catch(console.error); };
  OBR.broadcast.onMessage(SKILL_RESULT, ({ connectionId, data }) => {
    if (!expected || connectionId !== expected.gm || data?.requestId !== expected.requestId ||
        data.tokenId !== expected.tokenId || !Array.isArray(data.skills)) return;
    expected = undefined;
    available = data.skills;
    redraw();
  });
  OBR.broadcast.onMessage(SKILL_CHANGED, ({ connectionId }) => { if (connectionId === activeGM) reload(); });
  let playerState;
  OBR.player.onChange(({ metadata, role: nextRole }) => {
    const state = JSON.stringify([metadata[AVATAR]?.tokenId, nextRole]);
    if (state === playerState) return;
    playerState = state;
    reload();
  });
  OBR.party.onChange((players) => {
    const gm = players.filter((p) => p.role === "GM").map(({ connectionId }) => connectionId).sort().join();
    if (gm === partyGms) return;
    partyGms = gm;
    reload();
  });
  OBR.scene.onReadyChange(reload);
  OBR.room.onPermissionsChange(reload);
  OBR.scene.items.onChange((items) => {
    const next = new Map(items.filter(isPublicToken).map((token) => [token.id, token]));
    const before = tokens.get(avatarId);
    const after = next.get(avatarId);
    const previous = tokens;
    tokens = next;
    if (before?.locked !== after?.locked || Boolean(before) !== Boolean(after)) reload();
    else if (role === "GM" && hotbarMode(OBR) === "quickbar" && savedAvatarMode() === "talk" &&
      savedAvatarSlots().some((id) => previous.get(id)?.name !== next.get(id)?.name ||
        previous.get(id)?.image?.url !== next.get(id)?.image?.url)) redraw();
  });
  window.addEventListener("storage", redraw);
  const roomKeys = {
    "hotbar-toggle": () => sendHotbarCommand(OBR, "toggle"),
    "hotbar-mode": () => sendHotbarCommand(OBR, "mode"),
    keyboard: () => openKeyboard(OBR),
  };
  document.addEventListener("keydown", (event) => handleRoomKey(OBR, event, roomKeys));
  redraw();
  reload();
});
