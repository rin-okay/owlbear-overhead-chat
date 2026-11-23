import OBR from "./obr.js";
import {
  ABOVE_FOG, AVATAR, GENERAL_CHAT_ROOM, HABBO_MODE, HABBO_SCALE, MELEE_HIT_TIMING, RUMBLE_DICE, SPEECH,
  canSpeak, isPublicToken, normalizeHabboScale, normalizeMeleeHitTiming, parseSpeech,
} from "./rules.js?v=2.6.16";

import {
  openSessionChannel, savedAvatar, saveAvatar, savedAvatarSlots, savedAvatarMode, savedQuickbarSlots,
  savedAppearance, saveAppearance,
} from "./session.js?v=2.7.21";

import { drawBubble, normalizeAppearance, prepareBubbleFont } from "./appearance.js?v=2.7.9";
import { setupDiscordPanel } from "./discord-panel.js?v=2.8.5";
import { setupAvatarPanel } from "./avatar-panel.js?v=2.8.3";
import { setupSkillGrants, setupSkillPanel } from "./skill-panel.js?v=2.8.5";
import { setupStatsEditor } from "./stats-panel.js?v=2.8.5";
import { EMOTE } from "./emotes.js?v=2.7.21";
import { setupTargeting } from "./targeting.js?v=2.7.17";
import { listenForChatShortcut } from "./chat-shortcut.js?v=2.6.4";
import { cameraFollowPreference, centerAvatar, prepareKeyboardPan } from "./avatar-viewport.js?v=2.7.9";

import { readMovementGrid, stepAvatar, turnAvatar } from "./movement.js?v=2.7.5";
import { rollSpans, validateRollSpans } from "./dice.js";
import { rollWithRumble } from "./rumble.js";
import { rollWithNativeDice } from "./native-dice.js";

const transcript = document.querySelector("#transcript");
const chatRoom = document.querySelector("#chat-room");
const entries = document.querySelector("#entries");
const empty = document.querySelector("#empty");
const form = document.querySelector("form");
const speaker = document.querySelector("#speaker");
const input = document.querySelector("#message");
const send = form.querySelector("[type=submit]");
const moveButton = form.querySelector("#move-avatar");
const moveModeLabel = form.querySelector("#move-mode-label");
const moveWarning = form.querySelector("#move-warning");
const status = document.querySelector("#status");

let avatar = null;
let selectedAvatarId = null;
let observedToken = null;
let avatarState = "";
let playerRole;
let sending = false;
let rollInProgress = false;
let refreshVersion = 0;
let tokenControl;
let pendingChatShortcut;
let sendChatNotice;
let movingAvatar = false;
let modeExitKey;
let refreshAvatarPanel;
let skillPanel;
let showPlayerStats;
let targeting;
let showSkillsForRole;
let moveWarningTimer;
let moveWarningFade;
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
  line.dataset.sequence = entry.sequence;
  if (entry.localNotice) {
    line.className = "roll-status";
    line.textContent = entry.text;
    target.append(line);
    return line;
  }
  if (entry.rolling || entry.rollError) {
    line.className = "roll-status";
    line.textContent = entry.rolling ? `${entry.name} is rolling…` : `${entry.name} couldn’t roll: ${entry.rollError}`;
    target.append(line);
    return line;
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
  return line;
}

function scrollToLatest() {
  transcript.scrollTop = transcript.scrollHeight;
}

function connectTranscript() {
  openSessionChannel().then((channel) => {
    const older = document.querySelector("#older-messages");
    const rows = new Map();
    let request;
    const sendRequest = () => channel.postMessage({ type: "request", ...request });

    function requestHistory(before) {
      request = { requestId: crypto.randomUUID(), roomId: chatRoom.value, before };
      older.disabled = true;
      sendRequest();
    }

    older.addEventListener("click", () => {
      const first = entries.firstElementChild;
      if (!request && first) requestHistory(Number(first.dataset.sequence));
    });
    chatRoom.addEventListener("change", () => {
      rows.clear();
      entries.replaceChildren();
      older.hidden = true;
      empty.hidden = true;
      requestHistory();
    });

    channel.onmessage = ({ data }) => {
      if (data?.type === "ready" && request) sendRequest();
      if (data?.type === "resync") requestHistory();
      if (data?.type === "discord-status") document.querySelector("#discord-status").textContent = data.message;
      if (data?.type === "history" && request && data.requestId === request.requestId) {
        const initial = request.before === undefined;
        request = undefined;
        const oldHeight = transcript.scrollHeight;
        const oldTop = transcript.scrollTop;
        const fragment = document.createDocumentFragment();
        if (initial) rows.clear();
        for (const entry of data.entries) {
          if (!rows.has(entry.id)) rows.set(entry.id, appendLine(entry, fragment));
        }
        if (initial) entries.replaceChildren(fragment);
        else entries.prepend(fragment);
        empty.hidden = rows.size > 0;
        older.hidden = !data.hasOlder;
        older.disabled = false;
        if (initial) scrollToLatest();
        else transcript.scrollTop = oldTop + transcript.scrollHeight - oldHeight;
      }
      if (data?.type === "line" || data?.type === "replace") {
        const nearBottom = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 32;
        const { entry, oldestSequence } = data;
        const inSelectedRoom = (entry.roomId ?? GENERAL_CHAT_ROOM) === chatRoom.value;
        if (inSelectedRoom) {
          const previous = rows.get(entry.id);
          if (previous) {
            const fragment = document.createDocumentFragment();
            rows.set(entry.id, appendLine(entry, fragment));
            previous.replaceWith(fragment);
          } else if (data.type === "line") {
            rows.set(entry.id, appendLine(entry, entries));
          }
        }
        while (Number(entries.firstElementChild?.dataset.sequence) < oldestSequence) {
          const first = entries.firstElementChild;
          rows.delete(first.dataset.entryId);
          first.remove();
        }
        if (Number(entries.firstElementChild?.dataset.sequence) === oldestSequence) older.hidden = true;
        empty.hidden = rows.size > 0;
        if (inSelectedRoom && (nearBottom || (entry.own && data.type === "line"))) scrollToLatest();
      }
    };
    sendChatNotice = (text) => {
      channel.postMessage({ type: "local-notice", roomId: chatRoom.value, text });
      return true;
    };
    window.addEventListener("pagehide", () => {
      sendChatNotice = undefined;
      channel.close();
    }, { once: true });
    requestHistory();
  }).catch((error) => console.error("Overhead Chat transcript unavailable", error));
}

function updateControls() {
  input.disabled = !avatar;
  send.disabled = !avatar || sending;
  moveButton.disabled = !tokenControl && (!avatar || avatar.locked || sending);
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

  return { tokenId, observed: token, token, role, hint: "" };
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const { token, tokenId, observed, hint } = await getAvatar();
    if (version !== refreshVersion) return;

    const shouldFocus = token && token.id !== avatar?.id;
    if (tokenControl && !tokenControl.switching && tokenId && tokenId !== tokenControl.tokenId) stopTokenControl();
    avatar = token ?? null;
    selectedAvatarId = tokenId ?? null;
    observedToken = observed ?? null;
    speaker.textContent = token ? `Speaking as ${token.name || "Character"}` : "Pick an avatar";
    status.textContent = hint;
    skillPanel?.refresh(avatar);
    showPlayerStats?.(avatar);
    updateControls();
    const shortcut = pendingChatShortcut;
    pendingChatShortcut = undefined;
    if (shortcut === "move" && !moveButton.disabled) startTokenControl();
    else if ((shortcut || shouldFocus) && !tokenControl && !input.disabled) input.focus();
  } catch (error) {
    if (version !== refreshVersion) return;
    pendingChatShortcut = undefined;
    console.error("Overhead Chat could not read the avatar", error);
    if (tokenControl) {
      warnMoveFailed();
      return;
    }
    avatar = null;
    skillPanel?.refresh(null);
    showPlayerStats?.();
    speaker.textContent = "Pick an avatar";
    status.textContent = "Couldn’t read your avatar. Close and reopen chat to retry.";
    updateControls();
  }
}

function stopTokenControl() {
  if (!tokenControl) return;
  stopRotation(tokenControl);
  tokenControl = undefined;
  if (targeting?.editing()) targeting.clear();
  input.readOnly = false;
  input.setAttribute("aria-describedby", "status");
  moveModeLabel.hidden = true;
  moveButton.setAttribute("aria-pressed", "false");
  updateControls();
}

function startTokenControl() {
  if (moveButton.disabled) return;
  if (!tokenControl) {
    tokenControl = { tokenId: avatar.id, actions: [] };
    input.readOnly = true;
    input.setAttribute("aria-describedby", "move-mode-label status");
    updateMoveModeLabel();
    moveModeLabel.hidden = false;
    moveButton.setAttribute("aria-pressed", "true");
  }
  moveButton.focus();
}

function toggleTokenControl() {
  if (!tokenControl) startTokenControl();
  else {
    stopTokenControl();
    input.focus();
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

function warnMoveFailed() {
  clearTimeout(moveWarningTimer);
  moveWarningFade?.cancel();
  moveWarning.textContent = "Couldn’t update your avatar.";
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    moveWarningFade = moveWarning.animate([
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.85 },
      { opacity: 0 },
    ], 3200);
  }
  moveWarningTimer = setTimeout(() => { moveWarning.textContent = ""; }, 3200);
}

async function moveAvatar(mode) {
  movingAvatar = true;
  try {
    while (mode === tokenControl && !mode.switching && mode.actions.length) {
      const tokenId = mode.tokenId;
      const { offset, rotation, mirror, artwork, onApplied, skill, targetLocation, spellLevel, emote } = mode.actions.shift();
      const [{ token }, grid, pan] = await Promise.all([
        getAvatar(),
        offset ? (mode.movementGrid ??= readMovementGrid(OBR.scene.grid)) : undefined,
        offset ? prepareKeyboardPan(OBR, tokenId).catch(() => undefined) : undefined,
      ]);
      if (mode !== tokenControl || mode.switching || tokenId !== mode.tokenId) return;
      if (token?.id !== tokenId || token.locked) throw new Error("Avatar is unavailable or locked.");
      if (offset && (!Number.isFinite(grid.dpi) || grid.dpi <= 0)) throw new Error("Scene grid size unavailable.");
      if (skill) {
        await skillPanel.cast(skill, token, targetLocation, spellLevel);
        continue;
      }

      if (emote) {
        await OBR.broadcast.sendMessage(EMOTE, { tokenId, emote }, { destination: "ALL" });
        continue;
      }

      let applied = false;
      const changeToken = ([item]) => {
        if (mode !== tokenControl || mode.switching || tokenId !== mode.tokenId || !isPublicToken(item) || item.locked) return;
        if (artwork) {
          item.image = artwork.image;
          item.grid = artwork.grid;
        } else if (offset) {
          item.position = stepAvatar(item.position, offset, grid);
        } else if (mirror) {
          item.scale.x = -item.scale.x;
        } else {
          item.rotation = turnAvatar(item.rotation, rotation);
        }
        applied = true;
      };
      if (pan) {
        const next = stepAvatar(token.position, offset, grid);
        await pan({ x: next.x - token.position.x, y: next.y - token.position.y },
          () => OBR.scene.items.updateItems([token], changeToken));
      } else {
        await OBR.scene.items.updateItems([tokenId], changeToken);
      }
      if (mode !== tokenControl || mode.switching || tokenId !== mode.tokenId) return;
      if (!applied) throw new Error("Avatar changed before the update.");
      onApplied?.();
    }
  } catch (error) {
    if (mode !== tokenControl) return;
    console.error("Overhead Chat token movement failed", error);
    mode.actions.length = 0;
    mode.movementGrid = undefined;
    stopRotation(mode);
    warnMoveFailed();
  } finally {
    movingAvatar = false;
    if (tokenControl?.actions.length && !tokenControl.switching) void moveAvatar(tokenControl);
  }
}

async function switchAvatarSlot(mode, index, onApplied) {
  if (mode.switching || playerRole !== "GM") return;
  const tokenId = savedAvatarSlots()[index];
  if (!tokenId) {
    status.textContent = `Assign avatar ${index + 1} in the avatar tab first.`;
    return;
  }

  mode.switching = true;
  stopRotation(mode);
  mode.actions.length = 0;
  try {
    const [role, [token]] = await Promise.all([
      OBR.player.getRole(), OBR.scene.items.getItems([tokenId]),
    ]);
    if (mode !== tokenControl || role !== "GM" || playerRole !== "GM") return;
    if (!isPublicToken(token) || token.locked) {
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
  const talking = playerRole === "GM" && savedAvatarMode() === "talk";
  const quickbar = talking ? undefined : savedQuickbarSlots()[index];
  if (quickbar?.kind === "spell" || quickbar?.kind === "emote") {
    mode.slotTap = undefined;
    if (!mode.switching && mode.actions.length < 4) {
      status.textContent = "";
      queueAvatarAction(mode, quickbar.kind === "spell"
        ? { skill: quickbar.skill, targetLocation: targeting?.location() } : { emote: quickbar.emote });
    }
    return;
  }
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

  if (talking) {
    void switchAvatarSlot(mode, index, onApplied);
    return;
  }
  const artwork = quickbar?.artwork;
  if (!artwork) {
    status.textContent = `Assign slot ${index + 1} in the quickbar first.`;
    return;
  }
  status.textContent = "";
  queueAvatarAction(mode, { artwork, onApplied });
}

function updateMoveModeLabel() {
  moveModeLabel.textContent = tokenControl?.missileLevelPending ? "magic missile level · 1–9, esc to cancel"
    : targeting?.editing() ? "set target · wasd, space to set"
    : targeting?.location() ? "move mode · target set" : "move mode enabled";
}

function handleMissileLevelKey(event) {
  const mode = tokenControl;
  if (!mode?.missileLevelPending) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.repeat) return true;

  const digit = event.code ? /^Digit([1-9])$/.exec(event.code)?.[1] : /^[1-9]$/.exec(event.key)?.[0];
  if (digit || event.key === "Escape") {
    mode.missileLevelPending = false;
    updateMoveModeLabel();
    if (digit && !mode.switching) {
      queueAvatarAction(mode, { skill: "missile", targetLocation: targeting?.location(), spellLevel: Number(digit) });
    }
  }
  return true;
}

function handleTargetKey(event) {
  const mode = tokenControl;
  if (!mode || mode.switching || !targeting || event.ctrlKey || event.altKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    if (!event.repeat) {
      stopRotation(mode);
      targeting.toggle(mode.tokenId);
    }
    return true;
  }
  if (!targeting.editing()) return false;
  if (/^[wasd]$/.test(key)) targeting.move(movementKeys[key].offset);
  else if (!event.repeat && key === " ") {
    modeExitKey = event.key;
    void targeting.confirm();
  } else if (!event.repeat && key === "escape") targeting.clear();
  return true;
}

moveButton.addEventListener("blur", (event) => {
  stopRotation(tokenControl);
  if (event.relatedTarget) stopTokenControl();
});
window.addEventListener("blur", () => {
  stopRotation(tokenControl);
  if (!tokenControl?.missileLevelPending) return;
  tokenControl.missileLevelPending = false;
  updateMoveModeLabel();
});
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
  if (handleMissileLevelKey(event) || handleTargetKey(event)) {
    event.preventDefault();
    return;
  }
  if (event.key === modeExitKey) {
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    modeExitKey = undefined;
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
      let action = movementKeys[key];
      const { offset, rotation, mirror } = action;
      if (event.repeat && (rotation || mirror || tokenControl.actions.length >= 4)) return;
      if (event.shiftKey && offset) {
        action = { offset: [offset[0] / 2, offset[1] / 2] };
      } else if (event.shiftKey && (key === "q" || key === "e")) {
        action = { rotation: Math.sign(rotation) * 90 };
      }
      queueAvatarAction(tokenControl, action);
      if (action.rotation) holdRotation(tokenControl, physicalKey, action);
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey) {
      const skill = skillPanel?.skillForKey(key);
      if (!skill || tokenControl.switching || (event.shiftKey && skill !== "missile")) return;
      event.preventDefault();
      if (event.repeat || tokenControl.actions.length >= 4) return;
      if (event.shiftKey) {
        stopRotation(tokenControl);
        tokenControl.missileLevelPending = true;
        updateMoveModeLabel();
      } else {
        queueAvatarAction(tokenControl, { skill, targetLocation: targeting?.location() });
      }
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
  const speech = parseSpeech({ tokenId: intendedToken, text: draft, roomId: chatRoom.value });
  if (!speech) return;

  sending = true;
  updateControls();
  try {
    const { token, role } = await getAvatar();
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

    const message = { ...speech, appearance: normalizeAppearance(savedAppearance(), role ?? null), messageId: crypto.randomUUID() };
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
  const checkbox = setting.querySelector('input[type="checkbox"]');
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

function setupHabboScale() {
  const input = document.querySelector("#habbo-scale");
  const feedback = document.querySelector("#habbo-scale-status");
  let saved = normalizeHabboScale();
  input.valueAsNumber = saved;
  let revision = 0;
  function sync(metadata) {
    revision++;
    saved = normalizeHabboScale(metadata[HABBO_SCALE]);
    if (document.activeElement !== input) input.valueAsNumber = saved;
  }
  OBR.room.onMetadataChange(sync);
  OBR.room.getMetadata().then((metadata) => {
    if (!revision) sync(metadata);
    input.disabled = false;
  }).catch(() => {
    if (!revision) feedback.textContent = "Couldn’t load bubble scale.";
    input.disabled = false;
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
  input.addEventListener("change", async () => {
    if (!input.validity.valid) {
      feedback.textContent = "Enter a scale from 0.5 to 5 in steps of 0.1.";
      input.valueAsNumber = saved;
      return;
    }
    const requested = input.valueAsNumber;
    input.disabled = true;
    try {
      if (await OBR.player.getRole() !== "GM") return;
      await OBR.room.setMetadata({ [HABBO_SCALE]: requested });
      saved = requested;
      feedback.textContent = "";
    } catch {
      feedback.textContent = "Couldn’t save bubble scale.";
    } finally {
      input.valueAsNumber = saved;
      input.disabled = false;
    }
  });
}

function setupMeleeHitTiming() {
  const timing = document.querySelector("#melee-hit-timing");
  const value = document.querySelector("#melee-hit-timing-value");
  const status = document.querySelector("#melee-hit-timing-status");
  let saved = normalizeMeleeHitTiming();
  let receivedMetadata = false;

  function render(percent) {
    timing.valueAsNumber = percent;
    value.textContent = percent + "%";
  }

  function sync(metadata) {
    const previous = saved;
    saved = normalizeMeleeHitTiming(metadata[MELEE_HIT_TIMING]);
    if (!receivedMetadata || saved !== previous) render(saved);
    receivedMetadata = true;
  }
  OBR.room.onMetadataChange(sync);
  OBR.room.getMetadata().then((metadata) => {
    if (!receivedMetadata) sync(metadata);
    timing.disabled = false;
  }).catch(() => {
    if (!receivedMetadata) status.textContent = "couldn’t load melee hit timing.";
    render(saved);
    timing.disabled = false;
  });

  timing.addEventListener("input", () => {
    value.textContent = timing.value + "%";
  });
  timing.addEventListener("change", async () => {
    const requested = normalizeMeleeHitTiming(timing.valueAsNumber);
    timing.disabled = true;
    try {
      if (await OBR.player.getRole() !== "GM") return;
      await OBR.room.setMetadata({ [MELEE_HIT_TIMING]: requested });
      saved = requested;
      status.textContent = "";
    } catch {
      status.textContent = "couldn’t save melee hit timing.";
    } finally {
      render(saved);
      timing.disabled = false;
    }
  });
}

function setupSettings() {
  const chatTab = document.querySelector("#chat-tab");
  const settingsTab = document.querySelector("#settings-tab");
  const avatarTab = document.querySelector("#avatar-tab");
  const skillsTab = document.querySelector("#skills-tab");
  const chatPanel = document.querySelector("#chat-panel");
  const settingsPanel = document.querySelector("#settings-panel");
  const followCamera = settingsPanel.querySelector("#follow-camera");
  const cameraFollow = cameraFollowPreference(OBR, (enabled) => { followCamera.checked = enabled; });
  followCamera.addEventListener("change", () => cameraFollow.set(followCamera.checked));
  const avatarPanel = document.querySelector("#avatar-panel");
  const skillsPanel = document.querySelector("#skills-panel");
  const tutorialPanel = document.querySelector("#tutorial-panel");
  const tutorialButton = document.querySelector("#open-tutorial");
  const doneButton = document.querySelector("#tutorial-done");
  const { refresh: updateAvatarPanel, showSpells } = setupAvatarPanel(avatarPanel);
  refreshAvatarPanel = (items) => updateAvatarPanel(items, playerRole);
  skillPanel = setupSkillPanel(OBR, () => avatar, (key) =>
    typeof key === "string" && /^[a-z]$/.test(key) && key !== "z" && !Object.hasOwn(movementKeys, key),
    showSpells, (text) => sendChatNotice?.(text));
  const refreshSkillGrants = setupSkillGrants(OBR);
  const loadoutTab = document.querySelector("#skill-loadout-tab");
  const statsTab = document.querySelector("#skill-stats-tab");
  const grantsTab = document.querySelector("#skill-grants-tab");
  const loadout = document.querySelector("#player-skills");
  const stats = document.querySelector("#player-stats");
  const grants = document.querySelector("#gm-skills");
  showPlayerStats = setupStatsEditor(OBR, stats.querySelector("form"));
  const skillViews = [
    { tab: loadoutTab, panel: loadout },
    { tab: statsTab, panel: stats },
    { tab: grantsTab, panel: grants },
  ];
  let skillView = 0;
  function selectSkillView(index) {
    skillView = skillViews[index].tab.hidden ? 0 : index;
    skillViews.forEach(({ tab, panel }, i) => {
      panel.hidden = i !== skillView;
      tab.setAttribute("aria-pressed", String(!panel.hidden));
    });
    if (skillsPanel.hidden) return;
    if (skillView === 2) void refreshSkillGrants();
    else if (skillView === 0) skillPanel.refresh(avatar, true);
  }
  showSkillsForRole = (role) => {
    grantsTab.hidden = role !== "GM";
    if (grantsTab.hidden && skillView === 2) selectSkillView(0);
  };
  skillViews.forEach(({ tab }, index) => tab.addEventListener("click", () => selectSkillView(index)));
  const fields = settingsPanel.querySelector("form");
  const preview = settingsPanel.querySelector("#bubble-preview");
  const fontPicker = fields.elements.namedItem("font");
  const interOption = new Option("Inter", "inter");
  const visibleAppearance = () => normalizeAppearance(savedAppearance(), playerRole ?? null);

  let previewRevision = 0;
  async function drawPreview(style) {
    const revision = ++previewRevision;
    await prepareBubbleFont(style);
    if (revision !== previewRevision) return;
    const { canvas: bubble } = drawBubble("see you in the tavern!", style);
    bubble.setAttribute("aria-label", "speech bubble preview");
    preview.replaceChildren(bubble);
  }

  function showAppearance(style) {
    for (const [key, value] of Object.entries(style)) fields.elements.namedItem(key).value = value;
    drawPreview(style);
  }

  function updateFontRole(role) {
    const gm = role === "GM";
    if (gm === (interOption.parentElement === fontPicker)) return;
    if (gm) fontPicker.add(interOption);
    else interOption.remove();
    const style = visibleAppearance();
    fontPicker.value = style.font;
    drawPreview(style);
  }

  showAppearance(visibleAppearance());
  settingsPanel.querySelector("#reset-appearance").addEventListener("click", () => {
    showAppearance(saveAppearance());
  });
  settingsPanel.querySelector("#export-appearance").addEventListener("click", () => {
    const { border, fill, color, font, size } = visibleAppearance();
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
    { tab: skillsTab, panel: skillsPanel },
  ];

  function select(index) {
    tutorialPanel.hidden = true;
    if (index !== 0) pendingChatShortcut = undefined;
    views.forEach(({ tab, panel }, view) => {
      tab.setAttribute("aria-pressed", String(index === view));
      panel.hidden = index !== view;
    });
    if (index === 0) scrollToLatest();
    if (index === 4) selectSkillView(skillView);
  }

  function showTutorial() {
    select(-1);
    tutorialPanel.hidden = false;
    tutorialPanel.querySelector("h2").focus();
  }
  tutorialButton.addEventListener("click", showTutorial);
  doneButton.addEventListener("click", () => {
    select(0);
    if (!input.disabled) input.focus();
  });
  const welcome = new URLSearchParams(location.search).has("welcome");
  if (welcome) showTutorial();

  chatTab.addEventListener("click", () => select(0));
  settingsTab.addEventListener("click", () => select(1));
  avatarTab.addEventListener("click", () => {
    select(3);
    void refreshAvatarPanel();
    skillPanel.refresh(avatar, true);
  });
  skillsTab.addEventListener("click", () => select(4));
  function openFromShortcut(mode) {
    select(0);
    if (mode === "chat") stopTokenControl();
    pendingChatShortcut = mode;
    void refresh();
  }
  document.addEventListener("keydown", (event) => {
    if (!["F1", "F2", "F3", "F4"].includes(event.key) || event.ctrlKey || event.altKey ||
        event.metaKey || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === "F4") void cameraFollow.toggle().catch(console.error);
    else if (event.key === "F3") void centerAvatar(OBR).catch(console.error);
    else openFromShortcut(event.key === "F1" ? "chat" : "move");
  }, true);
  if (!welcome) listenForChatShortcut(OBR, openFromShortcut);
  setupDiscordPanel(() => select(0), () => select(2));
  fields.addEventListener("submit", (event) => event.preventDefault());
  fields.addEventListener("input", () => {
    const values = Object.fromEntries(new FormData(fields));
    values.size = Number(values.size);
    drawPreview(saveAppearance(normalizeAppearance(values, playerRole ?? null)));
  });
  return updateFontRole;
}

OBR.onReady(() => {
  targeting = setupTargeting(OBR, updateMoveModeLabel);
  const updateFontRole = setupSettings();
  setupMeleeHitTiming();
  setupRoomToggle("gm-fog-settings", ABOVE_FOG);
  setupRoomToggle("gm-rumble-settings", RUMBLE_DICE);
  setupRoomToggle("gm-habbo-settings", HABBO_MODE);
  setupHabboScale();
  connectTranscript();
  let mapSelection;
  OBR.player.onChange(({ metadata, role, selection }) => {
    const nextSelection = JSON.stringify(selection ?? []);
    if (nextSelection !== mapSelection) {
      mapSelection = nextSelection;
      if (tokenControl && selection?.some((id) => id !== tokenControl.tokenId)) {
        moveButton.focus({ preventScroll: true });
      }
    }
    playerRole = role;
    updateFontRole(role);
    showSkillsForRole(role);
    const state = JSON.stringify([metadata[AVATAR]?.tokenId, role]);
    if (state === avatarState) return;
    avatarState = state;
    void refresh();
    void refreshAvatarPanel();
  });
  void OBR.player.getRole().then((role) => {
    if (playerRole !== undefined) return;
    playerRole = role;
    updateFontRole(role);
    showSkillsForRole(role);
    return refreshAvatarPanel();
  }).catch(console.error);
  OBR.scene.grid.onChange(() => {
    if (tokenControl) tokenControl.movementGrid = undefined;
  });
  OBR.scene.onReadyChange((ready) => {
    if (!ready) {
      stopTokenControl();
      showPlayerStats?.();
    }
    void refresh();
    void refreshAvatarPanel();
  });
  OBR.scene.items.onChange((items) => {
    void refreshAvatarPanel(items);
    if (!selectedAvatarId) return;
    const next = items.find((item) => item.id === selectedAvatarId) ?? null;
    const fields = ["id", "name", "visible", "locked", "type", "layer", "createdUserId"];
    if (fields.some((field) => next?.[field] !== observedToken?.[field]) || next?.image?.url !== observedToken?.image?.url) {
      observedToken = next;
      showPlayerStats?.();
      void refresh();
    } else if (avatar?.id === next?.id) {
      showPlayerStats?.(next);
    }
  });
  OBR.room.onPermissionsChange(() => {
    void refresh();
    void refreshAvatarPanel();
  });
  void refresh();
});
