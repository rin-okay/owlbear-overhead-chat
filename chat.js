import OBR from "./obr.js";
import { ABOVE_FOG, AVATAR, HABBO_MODE, RUMBLE_DICE, SPEECH, canSpeak, isPublicToken, parseSpeech } from "./rules.js";

import {
  openSessionChannel, savedAvatar, saveAvatar, savedAvatarSlots, savedAvatarMode, savedAvatarArtSlots,
  savedAppearance, saveAppearance,
} from "./session.js";

import { drawBubble } from "./appearance.js";
import { setupDiscordPanel } from "./discord-panel.js";
import { setupAvatarPanel } from "./avatar-panel.js";

import { rollSpans, validateRollSpans } from "./dice.js";
import { rollWithRumble } from "./rumble.js";
import { rollWithNativeDice } from "./native-dice.js";

const transcript = document.querySelector("#transcript");
const entries = document.querySelector("#entries");
const empty = document.querySelector("#empty");
const form = document.querySelector("form");
const speaker = document.querySelector("#speaker");
const input = document.querySelector("#message");
const send = form.querySelector("[type=submit]");
const moveButton = form.querySelector("#move-avatar");
const moveModeLabel = form.querySelector("#move-mode-label");
const status = document.querySelector("#status");

let avatar = null;
let selectedAvatarId = null;
let observedToken = null;
let avatarState = "";
let sending = false;
let rollInProgress = false;
let refreshVersion = 0;
let tokenControl;
let movingAvatar = false;
let modeExitKey;
let refreshAvatarPanel;
const SLOT_DOUBLE_TAP_MS = 500;

const movementKeys = {
  arrowleft: { offset: [-1, 0] }, a: { offset: [-1, 0] },
  arrowright: { offset: [1, 0] }, d: { offset: [1, 0] },
  arrowup: { offset: [0, -1] }, w: { offset: [0, -1] },
  arrowdown: { offset: [0, 1] }, s: { offset: [0, 1] },
  q: { rotation: -15 }, ",": { rotation: -15 },
  e: { rotation: 15 }, ".": { rotation: 15 },
  r: { mirror: true },
};

function appendLine(entry, target) {
  const line = document.createElement("li");
  if (entry.id) line.dataset.entryId = entry.id;
  if (entry.rolling || entry.rollError) {
    line.className = "roll-status";
    line.textContent = entry.rolling ? `${entry.name} is rolling…` : `${entry.name} couldn’t roll: ${entry.rollError}`;
    target.append(line);
    return;
  }

  const heading = document.createElement("div");
  heading.className = "message-heading";

  const name = document.createElement("strong");
  name.className = "name";
  name.textContent = entry.name;
  heading.append(name);

  if (!entry.standaloneRoll && Number.isFinite(entry.receivedAt)) {
    const stamp = new Date(entry.receivedAt);
    const hours = String(stamp.getHours()).padStart(2, "0");
    const minutes = String(stamp.getMinutes()).padStart(2, "0");
    const time = document.createElement("time");
    time.dateTime = stamp.toISOString();
    time.textContent = `${hours}:${minutes}`;
    heading.append(time);
  }

  const message = document.createElement(entry.standaloneRoll ? "span" : "div");
  message.className = "message-text";
  for (const part of entry.parts ?? [entry.text]) {
    if (typeof part === "string") {
      message.append(part);
      continue;
    }

    const result = document.createElement("span");
    result.className = "chat-roll";
    result.tabIndex = 0;
    result.title = `${part.notation}\n${part.detail}\nTotal: ${part.total}`;
    result.setAttribute("aria-label", result.title);
    result.textContent = entry.standaloneRoll ? String(part.total) : `${part.notation}: ${part.total}`;
    message.append(result);
  }
  if (entry.standaloneRoll) {
    line.className = "roll-message";
    heading.className = "roll-heading";
    heading.append(` rolled ${entry.parts[0].notation}: `, message);
    line.append(heading);
  } else {
    line.append(heading, message);
  }
  target.append(line);
}

function scrollToLatest() {
  transcript.scrollTop = transcript.scrollHeight;
}

function connectTranscript() {
  openSessionChannel().then((channel) => {
    const requestHistory = () => channel.postMessage({ type: "request" });
    channel.onmessage = ({ data }) => {
      if (data?.type === "ready") requestHistory();
      if (data?.type === "discord-status") document.querySelector("#discord-status").textContent = data.message;
      if (data?.type === "history") {
        const fragment = document.createDocumentFragment();
        data.entries.forEach((entry) => appendLine(entry, fragment));
        entries.replaceChildren(fragment);
        empty.hidden = data.entries.length > 0;
        scrollToLatest();
      }
      if (data?.type === "line" || data?.type === "replace") {
        const nearBottom = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 32;
        empty.hidden = true;
        const previous = data.type === "replace"
          ? Array.from(entries.children).find((line) => line.dataset.entryId === data.entry.id)
          : null;
        if (previous) {
          const fragment = document.createDocumentFragment();
          appendLine(data.entry, fragment);
          previous.replaceWith(fragment);
        } else {
          appendLine(data.entry, entries);
        }
        if (nearBottom || (data.entry.own && data.type === "line")) scrollToLatest();
      }
    };
    window.addEventListener("pagehide", () => channel.close(), { once: true });
    requestHistory();
  }).catch((error) => console.error("Overhead Chat transcript unavailable", error));
}

function updateControls() {
  input.disabled = !avatar;
  send.disabled = !avatar || sending;
  moveButton.disabled = !avatar || avatar.locked || sending;
}

async function getAvatar() {
  if (!await OBR.scene.isReady()) return { hint: "Open a scene to start chatting." };

  const [metadata, role, permissions] = await Promise.all([
    OBR.player.getMetadata(),
    OBR.player.getRole(),
    OBR.room.getPermissions(),
  ]);
  const current = metadata[AVATAR]?.tokenId;
  const tokenId = current ?? savedAvatar();
  if (current) saveAvatar(current);
  const choose = "Select a character token and choose Set as avatar.";

  if (!tokenId) return { hint: choose };
  const [token] = await OBR.scene.items.getItems([tokenId]);
  if (!canSpeak({ role, id: OBR.player.id }, token, permissions)) {
    return { tokenId, observed: token, hint: choose };
  }

  return { tokenId, observed: token, token, hint: "" };
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const { token, tokenId, observed, hint } = await getAvatar();
    if (version !== refreshVersion) return;

    const shouldFocus = token && token.id !== avatar?.id;
    if (tokenControl && !tokenControl.switching && (token?.id !== tokenControl.tokenId || token.locked)) stopTokenControl();
    avatar = token ?? null;
    selectedAvatarId = tokenId ?? null;
    observedToken = observed ?? null;
    speaker.textContent = token ? `Speaking as ${token.name || "Character"}` : "Pick an avatar";
    status.textContent = hint;
    updateControls();
    if (shouldFocus && !tokenControl) input.focus();
  } catch (error) {
    if (version !== refreshVersion) return;
    console.error("Overhead Chat could not read the avatar", error);
    stopTokenControl();
    avatar = null;
    speaker.textContent = "Pick an avatar";
    status.textContent = "Couldn’t read your avatar. Close and reopen chat to retry.";
    updateControls();
  }
}

function stopTokenControl() {
  if (!tokenControl) return;
  stopRotation(tokenControl);
  tokenControl = undefined;
  input.readOnly = false;
  input.setAttribute("aria-describedby", "status");
  moveModeLabel.hidden = true;
  moveButton.setAttribute("aria-pressed", "false");
}

function toggleTokenControl() {
  if (tokenControl) {
    stopTokenControl();
    input.focus();
  } else {
    if (moveButton.disabled) return;
    tokenControl = { tokenId: avatar.id, actions: [] };
    input.readOnly = true;
    input.setAttribute("aria-describedby", "move-mode-label status");
    moveModeLabel.hidden = false;
    moveButton.setAttribute("aria-pressed", "true");
    moveButton.focus();
  }
}

function queueAvatarAction(mode, action) {
  mode.actions.push(action);
  if (!movingAvatar) void moveAvatar(mode);
}

function stopRotation(mode) {
  if (!mode?.heldRotation) return;
  clearTimeout(mode.heldRotation.timer);
  mode.heldRotation = undefined;
}

function holdRotation(mode, key, action) {
  stopRotation(mode);
  const held = { key };
  mode.heldRotation = held;

  function repeat() {
    if (mode !== tokenControl || mode.heldRotation !== held) return;
    if (!movingAvatar && !mode.switching) queueAvatarAction(mode, action);
    held.timer = setTimeout(repeat, 120);
  }

  held.timer = setTimeout(repeat, 240);
}

async function moveAvatar(mode) {
  movingAvatar = true;
  try {
    while (mode === tokenControl && !mode.switching && mode.actions.length) {
      const tokenId = mode.tokenId;
      const { offset, rotation, mirror, artwork, onApplied } = mode.actions.shift();
      const [{ token }, step] = await Promise.all([getAvatar(), offset ? OBR.scene.grid.getDpi() : 0]);
      if (mode !== tokenControl || mode.switching || tokenId !== mode.tokenId) return;
      if (token?.id !== tokenId || token.locked) {
        stopTokenControl();
        await refresh();
        return;
      }
      if (offset && (!Number.isFinite(step) || step <= 0)) throw new Error("Scene grid size unavailable.");

      let applied = false;
      await OBR.scene.items.updateItems([tokenId], ([item]) => {
        if (mode !== tokenControl || mode.switching || tokenId !== mode.tokenId || !isPublicToken(item) || item.locked) return;
        if (artwork) {
          item.image = artwork.image;
          item.grid = artwork.grid;
          applied = true;
        } else if (offset) {
          const [x, y] = offset;
          item.position.x += x * step;
          item.position.y += y * step;
        } else if (mirror) {
          item.scale.x = -item.scale.x;
        } else {
          item.rotation = ((item.rotation + rotation) % 360 + 360) % 360;
        }
      });
      if (applied) onApplied();
    }
  } catch (error) {
    if (mode !== tokenControl) return;
    console.error("Overhead Chat token movement failed", error);
    stopTokenControl();
    status.textContent = "Couldn’t update your avatar.";
  } finally {
    movingAvatar = false;
    if (tokenControl?.actions.length && !tokenControl.switching) void moveAvatar(tokenControl);
  }
}

async function switchAvatarSlot(mode, index, onApplied) {
  if (mode.switching) return;
  const tokenId = savedAvatarSlots()[index];
  if (!tokenId) {
    status.textContent = `Assign avatar ${index + 1} in the avatar tab first.`;
    return;
  }

  mode.switching = true;
  stopRotation(mode);
  mode.actions.length = 0;
  try {
    const [role, permissions, [token]] = await Promise.all([
      OBR.player.getRole(), OBR.room.getPermissions(), OBR.scene.items.getItems([tokenId]),
    ]);
    if (mode !== tokenControl) return;
    if (!canSpeak({ id: OBR.player.id, role }, token, permissions) || token.locked) {
      status.textContent = `Avatar ${index + 1} is unavailable in this scene.`;
      return;
    }
    await OBR.player.setMetadata({ [AVATAR]: { tokenId } });
    saveAvatar(tokenId);
    mode.tokenId = tokenId;
    mode.switching = false;
    await refresh();
    if (avatar?.id === tokenId) onApplied();
  } catch {
    if (mode === tokenControl) status.textContent = "Couldn’t switch avatars.";
  } finally {
    mode.switching = false;
  }
}

function useAvatarSlot(mode, key) {
  const index = Number(key) - 1;
  const now = performance.now();
  const previous = mode.slotTap;
  if (previous?.index === index && now - previous.time <= SLOT_DOUBLE_TAP_MS) {
    previous.returnToChat = true;
    modeExitKey = key;
    if (previous.applied) toggleTokenControl();
    return;
  }
  if (mode.switching) return;

  const tap = { index, time: now, applied: false, returnToChat: false };
  mode.slotTap = tap;
  function onApplied() {
    if (mode !== tokenControl || mode.slotTap !== tap) return;
    tap.applied = true;
    if (tap.returnToChat) toggleTokenControl();
  }

  if (savedAvatarMode() === "talk") {
    void switchAvatarSlot(mode, index, onApplied);
    return;
  }
  const artwork = savedAvatarArtSlots()[index];
  if (!artwork) {
    status.textContent = `Choose artwork for slot ${index + 1} in the avatar tab first.`;
    return;
  }
  status.textContent = "";
  queueAvatarAction(mode, { artwork, onApplied });
}

moveButton.addEventListener("blur", stopTokenControl);
window.addEventListener("blur", stopTokenControl);
document.addEventListener("pointerdown", (event) => {
  if (event.target !== input && !moveButton.contains(event.target)) stopTokenControl();
});
moveButton.addEventListener("click", toggleTokenControl);
form.addEventListener("keyup", (event) => {
  if (event.key === modeExitKey) {
    modeExitKey = undefined;
    event.preventDefault();
  }
  if (tokenControl?.heldRotation?.key === (event.code || event.key.toLowerCase())) stopRotation(tokenControl);
});

form.addEventListener("keydown", (event) => {
  if (event.target !== input && (event.target !== moveButton || !tokenControl)) return;
  const physicalKey = event.code || event.key.toLowerCase();
  if (event.repeat && tokenControl?.heldRotation?.key === physicalKey) {
    event.preventDefault();
    return;
  }
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === modeExitKey) {
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    modeExitKey = undefined;
  }
  if (event.key === "F2" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    if (!event.repeat) toggleTokenControl();
    return;
  }
  if (tokenControl) {
    const key = event.key.toLowerCase();
    if (key === "escape" || key === " " || key === "enter") {
      event.preventDefault();
      if (event.repeat) return;
      modeExitKey = event.key;
      stopTokenControl();
      input.focus();
    } else if (/^[1-9]$/.test(key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) useAvatarSlot(tokenControl, key);
    } else if (Object.hasOwn(movementKeys, key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (tokenControl.switching) return;
      const action = movementKeys[key];
      if (event.repeat && (action.rotation || action.mirror || tokenControl.actions.length >= 4)) return;
      queueAvatarAction(tokenControl, action);
      if (action.rotation) holdRotation(tokenControl, physicalKey, action);
    }
    return;
  }
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  form.requestSubmit();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || !avatar || tokenControl) return;

  const draft = input.value;
  const intendedToken = avatar.id;
  const speech = parseSpeech({ tokenId: intendedToken, text: draft });
  if (!speech) return;

  sending = true;
  updateControls();
  try {
    const { token } = await getAvatar();
    if (token?.id !== intendedToken) {
      await refresh();
      status.textContent = "Your avatar changed. Review the speaker and send again.";
      return;
    }

    const spans = rollSpans(speech.text);
    try {
      validateRollSpans(spans);
      if (spans.length && rollInProgress) throw new Error("Your previous roll is still resolving.");
    } catch (error) {
      status.textContent = error.message;
      return;
    }

    const message = { ...speech, appearance: savedAppearance() };
    if (spans.length) {
      message.rollId = crypto.randomUUID();
      await OBR.broadcast.sendMessage(SPEECH, { ...message, rollPhase: "pending" }, { destination: "ALL" });
      rollInProgress = true;
      void finishRoll(message, spans);
    } else {
      await OBR.broadcast.sendMessage(SPEECH, message, { destination: "ALL" });
    }
    if (input.value === draft) input.value = "";
    status.textContent = "";
  } catch (error) {
    console.error("Overhead Chat send failed", error);
    status.textContent = "Couldn’t send your message. Your draft is still here.";
  } finally {
    sending = false;
    updateControls();
  }
});

async function finishRoll(message, spans) {
  let resolution;
  try {
    const useRumble = (await OBR.room.getMetadata())[RUMBLE_DICE] === true;
    if (useRumble) {
      const rolls = [];
      for (const { notation } of spans) rolls.push(await rollWithRumble(notation));
      resolution = { rolls, rollPhase: "resolved" };
    } else {
      resolution = { ...await rollWithNativeDice(spans), rollPhase: "resolved" };
    }
  } catch (error) {
    resolution = { rollPhase: "failed", rollError: String(error.message || "Roll failed.").slice(0, 200) };
  }

  try {
    await OBR.broadcast.sendMessage(SPEECH, { ...message, ...resolution }, { destination: "ALL" });
  } catch (error) {
    console.error("Overhead Chat roll update failed", error);
    status.textContent = "Couldn’t share the completed roll.";
  } finally {
    rollInProgress = false;
  }
}

function setupRoomToggle(id, key) {
  const setting = document.getElementById(id);
  const checkbox = setting.querySelector("input");
  const feedback = setting.querySelector("[role=status]");
  let saved = false;
  let revision = 0;

  function sync(metadata) {
    revision++;
    saved = metadata[key] === true;
    checkbox.checked = saved;
    checkbox.disabled = false;
    feedback.textContent = "";
  }

  function showForRole(role) {
    setting.hidden = role !== "GM";
  }

  OBR.player.getRole().then(showForRole).catch(() => showForRole("PLAYER"));
  OBR.player.onChange(({ role }) => showForRole(role));
  OBR.room.onMetadataChange(sync);
  const initialRevision = revision;
  OBR.room.getMetadata().then((metadata) => {
    if (revision === initialRevision) sync(metadata);
  }).catch(() => {
    if (revision === initialRevision) feedback.textContent = "Couldn’t load room settings.";
  });

  checkbox.addEventListener("change", async () => {
    const requested = checkbox.checked;
    checkbox.disabled = true;
    try {
      if (await OBR.player.getRole() !== "GM") return;
      await OBR.room.setMetadata({ [key]: requested });
      saved = requested;
      feedback.textContent = "";
    } catch {
      feedback.textContent = "Couldn’t save the room setting.";
    } finally {
      checkbox.checked = saved;
      checkbox.disabled = false;
    }
  });
}

function setupSettings() {
  const chatTab = document.querySelector("#chat-tab");
  const settingsTab = document.querySelector("#settings-tab");
  const avatarTab = document.querySelector("#avatar-tab");
  const chatPanel = document.querySelector("#chat-panel");
  const settingsPanel = document.querySelector("#settings-panel");
  const avatarPanel = document.querySelector("#avatar-panel");
  refreshAvatarPanel = setupAvatarPanel(avatarPanel);
  const fields = settingsPanel.querySelector("form");
  const preview = settingsPanel.querySelector("#bubble-preview");

  function drawPreview(style) {
    const { canvas: bubble } = drawBubble("see you in the tavern!", style);
    bubble.setAttribute("aria-label", "speech bubble preview");
    preview.replaceChildren(bubble);
  }

  function showAppearance(style) {
    for (const [key, value] of Object.entries(style)) fields.elements.namedItem(key).value = value;
    drawPreview(style);
  }

  showAppearance(savedAppearance());
  settingsPanel.querySelector("#reset-appearance").addEventListener("click", () => {
    showAppearance(saveAppearance());
  });
  settingsPanel.querySelector("#export-appearance").addEventListener("click", () => {
    const { border, fill, color, font, size } = savedAppearance();
    const json = JSON.stringify({ border, fill, color, font, size }, null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "overhead-chat-colors.json";
    settingsPanel.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const views = [
    { tab: chatTab, panel: chatPanel },
    { tab: settingsTab, panel: settingsPanel },
    { tab: document.querySelector("#gm-tab"), panel: document.querySelector("#gm-panel") },
    { tab: avatarTab, panel: avatarPanel },
  ];

  function select(index) {
    views.forEach(({ tab, panel }, view) => {
      tab.setAttribute("aria-pressed", String(index === view));
      panel.hidden = index !== view;
    });
    if (index === 0) scrollToLatest();
  }

  chatTab.addEventListener("click", () => select(0));
  settingsTab.addEventListener("click", () => select(1));
  avatarTab.addEventListener("click", () => {
    select(3);
    void refreshAvatarPanel();
  });
  setupDiscordPanel(() => select(0), () => select(2));
  fields.addEventListener("submit", (event) => event.preventDefault());
  fields.addEventListener("input", () => {
    const values = Object.fromEntries(new FormData(fields));
    values.size = Number(values.size);
    drawPreview(saveAppearance(values));
  });
}

OBR.onReady(() => {
  setupSettings();
  setupRoomToggle("gm-fog-settings", ABOVE_FOG);
  setupRoomToggle("gm-rumble-settings", RUMBLE_DICE);
  setupRoomToggle("gm-habbo-settings", HABBO_MODE);
  connectTranscript();
  OBR.player.onChange(({ metadata, role }) => {
    const state = JSON.stringify([metadata[AVATAR]?.tokenId, role]);
    if (state === avatarState) return;
    avatarState = state;
    void refresh();
    void refreshAvatarPanel();
  });
  OBR.scene.onReadyChange((ready) => {
    if (!ready) stopTokenControl();
    void refresh();
    void refreshAvatarPanel();
  });
  OBR.scene.items.onChange((items) => {
    void refreshAvatarPanel(items);
    if (!selectedAvatarId) return;
    const next = items.find((item) => item.id === selectedAvatarId) ?? null;
    const fields = ["id", "name", "visible", "locked", "type", "layer", "createdUserId"];
    if (fields.some((field) => next?.[field] !== observedToken?.[field])) {
      observedToken = next;
      void refresh();
    }
  });
  OBR.room.onPermissionsChange(() => {
    void refresh();
    void refreshAvatarPanel();
  });
  void refresh();
});
