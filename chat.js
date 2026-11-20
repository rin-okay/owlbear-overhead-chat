import OBR from "./obr.js";
import { ABOVE_FOG, AVATAR, RUMBLE_DICE, SPEECH, canSpeak, parseSpeech } from "./rules.js";

import { openSessionChannel, savedAvatar, saveAvatar, savedAppearance, saveAppearance } from "./session.js";

import { drawBubble } from "./appearance.js";
import { setupDiscordPanel } from "./discord-panel.js";

import { rollSpans, validateRollSpans } from "./dice.js";
import { rollWithRumble } from "./rumble.js";
import { rollWithNativeDice } from "./native-dice.js";

const transcript = document.querySelector("#transcript");
const entries = document.querySelector("#entries");
const empty = document.querySelector("#empty");
const form = document.querySelector("form");
const speaker = document.querySelector("#speaker");
const input = document.querySelector("#message");
const send = form.querySelector("button");
const status = document.querySelector("#status");

let avatar = null;
let selectedAvatarId = null;
let observedToken = null;
let avatarState = "";
let sending = false;
let rollInProgress = false;
let refreshVersion = 0;

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
    avatar = token ?? null;
    selectedAvatarId = tokenId ?? null;
    observedToken = observed ?? null;
    speaker.textContent = token ? `Speaking as ${token.name || "Character"}` : "Pick an avatar";
    status.textContent = hint;
    updateControls();
    if (shouldFocus) input.focus();
  } catch (error) {
    if (version !== refreshVersion) return;
    console.error("Overhead Chat could not read the avatar", error);
    avatar = null;
    speaker.textContent = "Pick an avatar";
    status.textContent = "Couldn’t read your avatar. Close and reopen chat to retry.";
    updateControls();
  }
}

input.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  form.requestSubmit();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || !avatar) return;

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
  const chatPanel = document.querySelector("#chat-panel");
  const settingsPanel = document.querySelector("#settings-panel");
  const fields = settingsPanel.querySelector("form");
  const preview = settingsPanel.querySelector("#bubble-preview");

  function drawPreview(style) {
    const { canvas: bubble } = drawBubble("See you in the tavern!", style);
    bubble.setAttribute("aria-label", "Speech bubble preview");
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

  const views = [
    { tab: chatTab, panel: chatPanel },
    { tab: settingsTab, panel: settingsPanel },
    { tab: document.querySelector("#discord-tab"), panel: document.querySelector("#discord-panel") },
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
  connectTranscript();
  OBR.player.onChange(({ metadata, role }) => {
    const state = JSON.stringify([metadata[AVATAR]?.tokenId, role]);
    if (state === avatarState) return;
    avatarState = state;
    void refresh();
  });
  OBR.scene.onReadyChange(refresh);
  OBR.scene.items.onChange((items) => {
    if (!selectedAvatarId) return;
    const next = items.find((item) => item.id === selectedAvatarId) ?? null;
    const fields = ["id", "name", "visible", "locked", "type", "layer", "createdUserId"];
    if (fields.some((field) => next?.[field] !== observedToken?.[field])) {
      observedToken = next;
      void refresh();
    }
  });
  OBR.room.onPermissionsChange(refresh);
  void refresh();
});
