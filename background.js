import { setupAssignmentMenu } from "./assignment-window.js?v=3.2.4";
import OBR, { buildImage, buildLabel, buildPath, Command } from "./obr.js?v=2.5.1";
import {
  ABOVE_FOG, AVATAR, HABBO_MODE, HABBO_SCALE, SPEECH, BUBBLE_MS, GENERAL_CHAT_ROOM,
  canSpeak, isChatRoom, isPublicToken, normalizeHabboScale, parseSpeech,
} from "./rules.js?v=2.5.1";

import { BUBBLE_LINE_HEIGHT, drawBubble, drawFloatingBubble, fonts, normalizeAppearance, prepareBubbleFont } from "./appearance.js?v=2.7.9";
import { canvasPaths } from "./bubble-paths.js?v=2.5.1";
import { FLOAT_LINE, placeFloatingBubbles } from "./floating-layout.js?v=2.5.1";
import { ABILITIES, readTokenStats } from "./stats.js?v=3.1.0";
import { openSessionChannel, savedAvatar, saveAvatar } from "./session.js?v=2.11.17";
import { chatParts, isRollCommand, rollSpans } from "./dice.js";
import { queueDiscord } from "./discord.js?v=2.3.9";
import { parseTray } from "./dice-replay.js";
import { queueDicePopup, resetDicePopups } from "./dice-popup.js";
import { setupSkillHost } from "./skill-host.js?v=3.2.3";
import { setupHotbar } from "./hotbar.js?v=3.2.7";
import { resetCombatLogPopover, setupCombatLog } from "./combat-log.js?v=3.2.7";
import { SKILL_CHANGED, skillConnections, skillGrantLabel } from "./skills.js?v=3.1.0";
import { EMOTE, floatEmote, parseEmote } from "./emotes.js?v=2.7.22";
import { setupHeartProjectiles } from "./heart-spells.js?v=2.11.12";
import { setupHitMarkers } from "./hit-markers.js?v=3.1.0";
import { requestChatShortcut } from "./chat-shortcut.js?v=2.11.0";
import { setupChatRecovery } from "./chat-recovery.js?v=2.6.6";
import { setupCameraFollow } from "./avatar-viewport.js?v=2.11.16";

const HISTORY_LIMIT = 1000;
const HISTORY_PAGE_SIZE = 100;
const ROLL_TIMEOUT_MS = 70_000;
const transcript = new Map();
const rollingEntries = new Map();
const settledRolls = new Map();
let sequence = 0;
let transcriptChannel;

const active = new Map();
const queuedBubbles = new Map();
let floating = [];
let floatingTimer;
let pendingBubbles = Promise.resolve();
let pendingSpeech = Promise.resolve();
let sceneVersion = 0;
let sceneReady;
let sceneItems;
let permissions;
let role;
let party;
let roomMetadata;
let connectionId;
let initialState;
let combatLog;

async function removeBubble(tokenId, bubble) {
  if (active.get(tokenId) !== bubble) return;

  clearTimeout(bubble.timer);
  active.delete(tokenId);
  await OBR.scene.local.deleteItems(bubble.ids);
}

function report(error) {
  console.error("Overhead Chat background", error);
}

function queueScene(task) {
  const version = sceneVersion;
  pendingBubbles = pendingBubbles.then(() => {
    if (version === sceneVersion) return task(version);
  }).catch(report);
}

function scheduleFloatingStep() {
  if (!floating.length || floatingTimer !== undefined) return;
  floatingTimer = setTimeout(() => {
    floatingTimer = undefined;
    queueScene(async (version) => {
      try {
        await updateFloating(placeFloatingBubbles(floating, FLOAT_LINE), version);
      } finally {
        if (version === sceneVersion) scheduleFloatingStep();
      }
    });
  }, 720);
}

async function updateFloating(next, version) {
  const targets = new Map(next.map((bubble) => [bubble.id, bubble]));
  const removed = floating.filter(({ id }) => !targets.has(id)).flatMap(({ ids }) => ids);
  const moved = new Map();
  for (const { id, ids, y } of floating) {
    const newY = targets.get(id)?.y;
    if (newY === undefined || newY === y) continue;
    for (const itemId of ids) moved.set(itemId, newY);
  }
  if (removed.length) await OBR.scene.local.deleteItems(removed);
  if (version !== sceneVersion) return;
  if (moved.size) {
    await OBR.scene.local.updateItems([...moved.keys()], (items) => {
      for (const item of items) item.position.y = moved.get(item.id);
    });
  }
  if (version === sceneVersion) floating = next;
}

async function showFloating(text, appearance, tokenId, position, layer, version, current) {
  const scale = normalizeHabboScale(roomMetadata?.[HABBO_SCALE]);
  const drawing = drawFloatingBubble(text, appearance);
  const ids = await addBubbleDrawing(drawing, appearance, position, layer, undefined, scale, current);
  if (!ids.length) return;
  const bubble = {
    id: ids[0], ids, tokenId, scale, width: drawing.width * scale, height: drawing.height * scale,
    x: position.x, y: position.y, originY: position.y,
  };
  const placed = placeFloatingBubbles([bubble, ...floating]);
  try {
    await updateFloating(placed.slice(1), version);
  } catch (error) {
    if (await OBR.scene.isReady()) await OBR.scene.local.deleteItems(ids);
    throw error;
  }
  if (!current()) {
    if (await OBR.scene.isReady()) await OBR.scene.local.deleteItems(ids);
    return;
  }
  floating.unshift(bubble);
  scheduleFloatingStep();
}

async function addBubbleDrawing(drawing, appearance, position, layer, tokenId, scale, current) {
  const attach = (builder) => {
    builder.position(position).layer(layer).locked(true);
    if (tokenId) builder.attachedTo(tokenId);
    const item = builder.build();
    item.disableHit = true;
    if (tokenId) item.disableAttachmentBehavior = ["COPY", "ROTATION", "SCALE", "LOCKED"];
    return item;
  };
  const colors = drawing.colors ?? [appearance.border, appearance.fill, appearance.color];
  try {
    const paths = canvasPaths(drawing.canvas, colors, Command).map(({ color, commands }) =>
      attach(buildPath().commands(commands).fillColor(color).strokeOpacity(0).scale({ x: scale, y: scale })));
    if (paths.length) {
      await OBR.scene.local.addItems(paths);
      return paths.map(({ id }) => id);
    }
  } catch (error) {
    console.warn("Overhead Chat could not draw the bubble paths", error);
  }
  if (!current()) return [];
  const labelScale = tokenId ? 1 : scale;
  const font = fonts[appearance.font];
  const nativeLabel = (borderWidth = 0) => buildLabel()
    .plainText(drawing.lines.join("\n")).width(tokenId ? drawing.width + borderWidth : "AUTO")
    .fontFamily(font.nativeFace ?? font.face)
    .fontSize(appearance.size * labelScale)
    .lineHeight(BUBBLE_LINE_HEIGHT).textAlign("CENTER").pointerDirection("DOWN");
  const labels = [
    attach(nativeLabel(4).padding(10 * labelScale).fillColor(colors[0]).backgroundColor(colors[0])
      .cornerRadius(tokenId ? 10 : 2).pointerWidth(16 * labelScale).pointerHeight(7 * labelScale)),
    attach(nativeLabel().padding(8 * labelScale).fillColor(colors.at(-1)).backgroundColor(colors[1])
      .cornerRadius(tokenId ? 8 : 0).pointerWidth(12 * labelScale).pointerHeight(9 * labelScale)),
  ];
  labels.forEach((item, index) => {
    item.zIndex = index;
    item.disableAutoZIndex = true;
  });
  await OBR.scene.local.addItems(labels);
  return labels.map(({ id }) => id);
}

function storeEntry(entry, type) {
  transcript.set(entry.id, entry);
  if (transcript.size > HISTORY_LIMIT) {
    const oldest = transcript.keys().next().value;
    clearTimeout(rollingEntries.get(oldest));
    rollingEntries.delete(oldest);
    transcript.delete(oldest);
  }
  transcriptChannel?.postMessage({
    type, entry, oldestSequence: transcript.values().next().value.sequence,
  });
}

function publishHistory({ requestId, roomId = GENERAL_CHAT_ROOM, before = Infinity }) {
  if (!isChatRoom(roomId)) return;
  const entries = [];
  for (const entry of transcript.values()) {
    if (entry.sequence >= before) break;
    if (entry.roomId === roomId) entries.push(entry);
  }
  transcriptChannel.postMessage({
    type: "history", requestId, entries: entries.slice(-HISTORY_PAGE_SIZE),
    hasOlder: entries.length > HISTORY_PAGE_SIZE,
  });
}

function mergeRecoveredEntries(entries) {
  let changed = false;
  for (const entry of entries) {
    const previous = transcript.get(entry.id);
    if (previous && !previous.rolling) continue;
    clearTimeout(rollingEntries.get(entry.id));
    rollingEntries.delete(entry.id);
    transcript.set(entry.id, previous ? { ...entry, receivedAt: previous.receivedAt } : entry);
    if (entry.rollPhase) settledRolls.set(entry.id, Date.now() + ROLL_TIMEOUT_MS);
    changed = true;
  }
  if (!changed) return;

  const ordered = [...transcript.values()].sort((a, b) => a.receivedAt - b.receivedAt).slice(-HISTORY_LIMIT);
  transcript.clear();
  for (const entry of ordered) {
    // Keep the stored object so an existing pending-roll timer can still recognize it.
    entry.sequence = ++sequence;
    transcript.set(entry.id, entry);
  }
  for (const [id, timer] of rollingEntries) {
    if (transcript.has(id)) continue;
    clearTimeout(timer);
    rollingEntries.delete(id);
  }
  while (settledRolls.size > HISTORY_LIMIT) settledRolls.delete(settledRolls.keys().next().value);
  transcriptChannel?.postMessage({ type: "resync" });
}

async function acceptSpeech(event, speech, version, receivedAt) {
  await initialState;
  if (version !== sceneVersion || !sceneReady) return;

  const itemsBeforeLookup = sceneItems;
  const [fetchedToken] = await OBR.scene.items.getItems([speech.tokenId]);
  const token = sceneItems === itemsBeforeLookup ? fetchedToken : sceneItems?.find((item) => item.id === speech.tokenId);
  const sender = event.connectionId === connectionId
    ? { id: OBR.player.id, role }
    : party?.get(event.connectionId);
  if (version !== sceneVersion || !canSpeak(sender, token, permissions ?? [])) return;

  const { tokenId, roomId } = speech;
  const phase = event.data.rollPhase;
  const rollId = event.data.rollId;
  if (phase && (typeof rollId !== "string" || !/^[a-f0-9-]{36}$/i.test(rollId) ||
      !["pending", "resolved", "failed"].includes(phase) || !rollSpans(speech.text).length)) return;
  const messageId = typeof event.data.messageId === "string" && /^[a-f0-9-]{36}$/i.test(event.data.messageId)
    ? event.data.messageId : undefined;
  const id = phase ? `${event.connectionId}:${rollId}`
    : messageId ? `${event.connectionId}:message:${messageId}` : `message:${sequence + 1}`;
  if (!phase && transcript.has(id)) return;
  const previousRoll = phase ? transcript.get(id) : undefined;
  while (settledRolls.size && settledRolls.values().next().value <= receivedAt) {
    settledRolls.delete(settledRolls.keys().next().value);
  }
  if (settledRolls.has(id) || (previousRoll &&
      (phase === "pending" || previousRoll.rollPhase !== "pending" ||
       previousRoll.tokenId !== tokenId || previousRoll.roomId !== roomId))) return;
  const parts = chatParts(speech.text, event.data.rolls);
  const combatRoll = phase === "pending" ? event.data.combatRoll : previousRoll?.combatRoll;
  const saveAbility = phase && Object.hasOwn(ABILITIES, event.data.saveAbility) ? event.data.saveAbility : undefined;
  const saveModifier = combatRoll && saveAbility
    ? previousRoll?.saveModifier ?? readTokenStats(token).modifiers[saveAbility] : undefined;
  const saveMode = phase === "pending" ? event.data.saveMode : previousRoll?.saveMode;
  const text = parts.map((part) => typeof part === "string" ? part : `${part.notation}: ${part.total}`).join("");
  const appearance = normalizeAppearance(event.data.appearance, sender.role ?? null);
  const entry = {
    name: appearance.name || token.name || "Character",
    text,
    parts,
    id,
    senderId: (phase || messageId) ? sender.id : undefined,
    tokenId,
    roomId,
    rollPhase: phase,
    sequence: previousRoll?.sequence ?? ++sequence,
    rolling: phase === "pending",
    saveAbility,
    combatRoll,
    saveModifier,
    saveMode,
    rollError: phase === "failed" ? String(event.data.rollError || "Roll failed.").slice(0, 200) : undefined,
    standaloneRoll: isRollCommand(speech.text) && typeof parts[0] === "object",
    receivedAt: previousRoll?.receivedAt ?? receivedAt,
    own: event.connectionId === connectionId,
  };
  clearTimeout(rollingEntries.get(id));
  rollingEntries.delete(id);
  storeEntry(entry, previousRoll ? "replace" : "line");
  if (entry.rolling) {
    const timer = setTimeout(() => {
      rollingEntries.delete(id);
      if (transcript.get(id) !== entry) return;
      const expired = { ...entry, rolling: false, rollError: "The roll timed out." };
      storeEntry(expired, "replace");
    }, ROLL_TIMEOUT_MS);
    rollingEntries.set(id, timer);
  } else if (phase) {
    settledRolls.set(id, receivedAt + ROLL_TIMEOUT_MS);
    if (settledRolls.size > HISTORY_LIMIT) settledRolls.delete(settledRolls.keys().next().value);
  }
  if (combatRoll) {
    await combatLog?.acceptRoll({
      id: combatRoll.id, kind: combatRoll.kind, tokenId, notation: rollSpans(speech.text)[0]?.notation,
      roll: parts[0], phase, chatId: id, saveAbility, modifier: saveModifier, mode: saveMode,
    }).catch(report);
    if (version !== sceneVersion) return;
  }
  if (entry.rolling || entry.rollError) return;
  if (phase === "resolved" && parts.some((part) => typeof part === "object")) {
    const tray = parseTray(event.data.tray);
    if (tray) queueDicePopup(entry, tray, appearance);
  }
  queueDiscord(entry, role, (message) => transcriptChannel?.postMessage({ type: "discord-status", message }));
  queueBubble({ tokenId, text, appearance, itemsAtValidation: sceneItems });
}

function queueBubble(message) {
  if (roomMetadata?.[HABBO_MODE] === true) {
    queueScene((version) => showBubble(message, version, true));
    return;
  }
  const { tokenId } = message;
  const alreadyQueued = queuedBubbles.has(tokenId);
  queuedBubbles.set(tokenId, message);
  if (alreadyQueued) return;
  queueScene((version) => {
    const latest = queuedBubbles.get(tokenId);
    queuedBubbles.delete(tokenId);
    return showBubble(latest, version, false);
  });
}

async function showBubble({ tokenId, text, appearance, itemsAtValidation }, version, floatingMode) {
  const current = () => version === sceneVersion &&
    floatingMode === (roomMetadata?.[HABBO_MODE] === true) &&
    (floatingMode || !queuedBubbles.has(tokenId)) &&
    (sceneItems === itemsAtValidation || sceneItems?.some((item) => item.id === tokenId && isPublicToken(item)));
  if (!current()) return;
  const [bounds] = await Promise.all([
    OBR.scene.items.getItemBounds([tokenId]), prepareBubbleFont(appearance),
  ]);
  const layer = roomMetadata?.[ABOVE_FOG] === true ? "CONTROL" : "TEXT";
  if (!current() || !Number.isFinite(bounds?.min?.y) ||
      !Number.isFinite(bounds?.max?.y) ||
      !Number.isFinite(bounds?.center?.x)) return;

  const gap = Math.min(16, Math.max(4, (bounds.max.y - bounds.min.y) * 0.07));
  const position = { x: bounds.center.x, y: bounds.min.y - gap };
  if (floatingMode) {
    if (active.size) await Promise.all([...active].map(([id, bubble]) => removeBubble(id, bubble)));
    if (current()) await showFloating(text, appearance, tokenId, position, layer, version, current);
    return;
  }
  if (floating.length) await updateFloating([], version);
  const previous = active.get(tokenId);
  if (previous) await removeBubble(tokenId, previous);
  if (!current()) return;

  const zoom = await OBR.viewport.getScale().catch(() => 1);
  if (!current()) return;
  const scale = Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1;
  const ids = await addBubbleDrawing(drawBubble(text, appearance), appearance, position, layer, tokenId, scale, current);
  if (!ids.length) return;
  if (!current()) {
    if (await OBR.scene.isReady()) await OBR.scene.local.deleteItems(ids);
    return;
  }

  const bubble = { ids, timer: null };
  active.set(tokenId, bubble);
  bubble.timer = setTimeout(() => {
    removeBubble(tokenId, bubble).catch(report);
  }, BUBBLE_MS);
}

function queueSpeech(event) {
  const speech = parseSpeech(event.data);
  if (!speech) return;
  const receivedAt = Date.now();
  const version = sceneVersion;

  // Validate messages in receive order so the transcript reads in order.
  pendingSpeech = pendingSpeech.then(() => acceptSpeech(event, speech, version, receivedAt)).catch(report);
}

OBR.onReady(() => {
  resetCombatLogPopover(OBR);
  setupHitMarkers(OBR, buildLabel, buildPath, Command);
  setupHeartProjectiles(OBR);
  setupCameraFollow(OBR);
  setupHotbar(OBR);
  let shortcutRevision = 0;
  async function openFromShortcut(mode) {
    const revision = ++shortcutRevision;
    await OBR.action.open();
    if (revision === shortcutRevision) requestChatShortcut(OBR, mode);
  }
  for (const [shortcut, mode, label, icon] of [
    ["F1", "chat", "Focus Overhead Chat (F1)", "./toolbar-chat.svg"],
    ["F2", "move", "Move Chat Avatar (F2)", "./toolbar-move.svg"],
  ]) {
    OBR.tool.create({
      id: "chat.overhead.shortcut." + mode,
      shortcut,
      icons: [{ icon: new URL(icon, import.meta.url).href, label }],
      onClick() {
        void openFromShortcut(mode).catch(report);
        return false;
      },
    }).catch(report);
  }
  combatLog = setupCombatLog(OBR);
  setupSkillHost(OBR, buildImage, combatLog.record);
  setupAssignmentMenu(OBR);
  setupChatRecovery(OBR, function* () {
    for (const entry of transcript.values()) {
      if (!entry.localNotice) yield entry;
    }
  }, mergeRecoveredEntries);
  openSessionChannel().then((channel) => {
    transcriptChannel = channel;
    channel.onmessage = ({ data }) => {
      if (data?.type === "request" && typeof data.requestId === "string") publishHistory(data);
      if (data?.type === "local-notice" && isChatRoom(data.roomId) && typeof data.text === "string" &&
          data.text.length > 0 && data.text.length <= 200) {
        storeEntry({
          id: crypto.randomUUID(), sequence: ++sequence, roomId: data.roomId,
          receivedAt: Date.now(), text: data.text, own: true, localNotice: true,
        }, "line");
      }
    };
    channel.postMessage({ type: "ready" });
  }).catch(report);
  OBR.scene.onReadyChange((ready) => {
    sceneReady = ready;
    if (ready) return;
    ++sceneVersion;
    resetDicePopups();
    for (const bubble of active.values()) clearTimeout(bubble.timer);
    active.clear();
    clearTimeout(floatingTimer);
    floatingTimer = undefined;
    floating = [];
    sceneItems = undefined;
    queuedBubbles.clear();
    pendingSpeech = Promise.resolve();
    pendingBubbles = Promise.resolve();
  });

  OBR.scene.items.onChange((items) => {
    if (!sceneReady) return;
    sceneItems = items;
    if (!active.size && !floating.length) return;
    const publicTokens = new Set(items.filter(isPublicToken).map((item) => item.id));
    for (const [tokenId, bubble] of active) {
      if (!publicTokens.has(tokenId)) removeBubble(tokenId, bubble).catch(report);
    }
    if (floating.some(({ tokenId }) => !publicTokens.has(tokenId))) {
      queueScene((version) => updateFloating(floating.filter(({ tokenId }) => publicTokens.has(tokenId)), version));
    }
  });

  OBR.player.onChange((player) => { role = player.role; });
  OBR.party.onChange((players) => {
    party = new Map(players.map((player) => [player.connectionId, player]));
  });
  OBR.room.onPermissionsChange((value) => { permissions = value; });
  OBR.room.onMetadataChange((metadata) => {
    const wasFloating = roomMetadata?.[HABBO_MODE] === true;
    roomMetadata = metadata;
    const floatingMode = metadata[HABBO_MODE] === true;
    if (wasFloating === floatingMode) return;
    queueScene(async (version) => {
      if (floatingMode) {
        await Promise.all([...active].map(([id, bubble]) => removeBubble(id, bubble)));
      } else if (floating.length) {
        await updateFloating([], version);
      }
    });
  });
  initialState = Promise.allSettled([
    OBR.scene.isReady().then((ready) => { sceneReady ??= ready; }),
    OBR.player.getConnectionId().then((value) => { connectionId = value; }),
    OBR.player.getRole().then((value) => { role ??= value; }),
    OBR.party.getPlayers().then((players) => {
      party ??= new Map(players.map((player) => [player.connectionId, player]));
    }),
    OBR.room.getPermissions().then((value) => { permissions ??= value; }),
    OBR.room.getMetadata().then((value) => { roomMetadata ??= value; }),
  ]).then((results) => {
    for (const result of results) if (result.status === "rejected") report(result.reason);
  });
  OBR.broadcast.onMessage(SPEECH, queueSpeech);
  OBR.broadcast.onMessage(SKILL_CHANGED, async ({ connectionId: sender, data }) => {
    const grant = data?.grant;
    if (typeof grant?.id !== "string" || !/^[a-f0-9-]{36}$/i.test(grant.id) ||
        typeof grant.tokenId !== "string" || !grant.tokenId || grant.tokenId.length > 128) return;
    const label = skillGrantLabel(grant.kind, grant.variant, grant.name);
    if (!label) return;
    const id = "grant:" + grant.id;
    const version = sceneVersion;
    try {
      await initialState;
      if (!sceneReady || version !== sceneVersion || transcript.has(id)) return;
      const { gm } = await skillConnections(OBR);
      if (gm?.connectionId !== sender) return;
      const [token] = await OBR.scene.items.getItems([grant.tokenId]);
      if (!sceneReady || version !== sceneVersion || !isPublicToken(token) || transcript.has(id)) return;
      const name = String(token.name || "Character").slice(0, 80);
      const text = name + " has been granted " + label;
      storeEntry({
        id, sequence: ++sequence, roomId: GENERAL_CHAT_ROOM, receivedAt: Date.now(),
        senderId: gm.id, name, text, parts: [text], own: sender === connectionId, grantNotice: true,
      }, "line");
    } catch (error) {
      report(error);
    }
  });
  const lastEmote = new Map();
  OBR.scene.onReadyChange(() => lastEmote.clear());
  OBR.broadcast.onMessage(EMOTE, async (event) => {
    const emote = parseEmote(event.data?.emote);
    const tokenId = event.data?.tokenId;
    if (!emote || typeof tokenId !== "string" || !tokenId || tokenId.length > 128) return;
    const version = sceneVersion;
    const current = () => sceneReady && version === sceneVersion;
    try {
      await initialState;
      if (!current()) return;
      const sender = event.connectionId === connectionId ? { id: OBR.player.id, role } : party?.get(event.connectionId);
      if (!sender) return;
      const now = Date.now();
      for (const [id, time] of lastEmote) if (now - time >= 650) lastEmote.delete(id);
      if (lastEmote.has(event.connectionId)) return;
      const before = sceneItems;
      const [fetched] = await OBR.scene.items.getItems([tokenId]);
      const token = sceneItems === before ? fetched : sceneItems?.find((item) => item.id === tokenId);
      if (!current() || lastEmote.has(event.connectionId) || token?.locked || !canSpeak(sender, token, permissions ?? [])) return;
      lastEmote.set(event.connectionId, Date.now());
      await floatEmote(OBR, buildImage, buildLabel, tokenId, emote, current);
    } catch (error) {
      if (current()) report(error);
    }
  });
  OBR.broadcast.onMessage("chat.overhead.arrival-guide.v1", async ({ connectionId: sender, data }) => {
    try {
      if (typeof data?.tokenId !== "string" || sender !== await OBR.player.getConnectionId()) return;
      const [token] = await OBR.scene.items.getItems([data.tokenId]);
      if (!isPublicToken(token) || token.createdUserId !== OBR.player.id ||
          !token.metadata?.["chat.overhead.discord-arrivals/token"]) return;
      await OBR.popover.open({
        id: "chat.overhead.arrival-guide.v1",
        url: new URL("./index.html?welcome=1", import.meta.url).href,
        width: 380, height: 440,
        anchorReference: "POSITION", anchorPosition: { left: 12, top: 76 },
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
        transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      });
      if (typeof data.requestId === "string") {
        await OBR.broadcast.sendMessage("chat.overhead.arrival-guide.opened.v1", {
          requestId: data.requestId,
        }, { destination: "LOCAL" });
      } else if (data.closeWelcome) {
        await OBR.modal.close("chat.overhead.discord-arrivals/welcome");
      }
    } catch (error) {
      report(error);
    }
  });

  const avatarMenuId = "chat.overhead.set-avatar.v1";
  const avatarIcon = new URL("./toolbar-chat.svg", import.meta.url).href;
  const activeAvatar = (metadata) => (metadata[AVATAR]?.tokenId ?? savedAvatar()) || null;
  let registeredAvatar;
  let menuRegistered = false;
  let avatarMenuWork = Promise.resolve();

  async function toggleAvatar({ items }) {
    if (items.length !== 1) return;
    const [token] = items;
    let remove = false;
    try {
      remove = activeAvatar(await OBR.player.getMetadata()) === token.id;
      if (remove) {
        // An explicit empty ID also disables the saved-avatar fallback in older panels.
        await OBR.player.setMetadata({ [AVATAR]: { tokenId: "" } });
        saveAvatar(null);
        updateAvatarMenu(null);
        return;
      }

      const [role, permissions] = await Promise.all([OBR.player.getRole(), OBR.room.getPermissions()]);
      if (!canSpeak({ role, id: OBR.player.id }, token, permissions)) {
        await OBR.notification.show("Choose a visible character token you can update.");
        return;
      }

      await OBR.player.setMetadata({ [AVATAR]: { tokenId: token.id } });
      saveAvatar(token.id);
      updateAvatarMenu(token.id);
      await OBR.action.open();
    } catch (error) {
      report(error);
      await OBR.notification.show(remove ? "Couldn’t remove your chat avatar." : "Couldn’t set your chat avatar. Try again.");
    }
  }

  function updateAvatarMenu(tokenId) {
    avatarMenuWork = avatarMenuWork.then(async () => {
      if (menuRegistered && registeredAvatar === tokenId) return;
      if (menuRegistered) {
        await OBR.contextMenu.remove(avatarMenuId);
        menuRegistered = false;
      }
      const setFilter = {
        min: 1, max: 1, permissions: ["UPDATE"],
        every: [
          { key: "type", value: "IMAGE" },
          { key: "layer", value: "CHARACTER" },
          { key: "visible", value: true },
        ],
      };
      if (tokenId) setFilter.every.push({ key: "id", value: tokenId, operator: "!=" });
      const icons = [{ icon: avatarIcon, label: "Set as avatar", filter: setFilter }];
      if (tokenId) icons.push({
        icon: avatarIcon, label: "Remove avatar",
        filter: { min: 1, max: 1, every: [{ key: "id", value: tokenId }] },
      });
      await OBR.contextMenu.create({ id: avatarMenuId, icons, onClick: toggleAvatar });
      menuRegistered = true;
      registeredAvatar = tokenId;
    }).catch(report);
  }

  let avatarObserved = false;
  OBR.player.onChange(({ metadata }) => {
    avatarObserved = true;
    updateAvatarMenu(activeAvatar(metadata));
  });
  void OBR.player.getMetadata().then((metadata) => {
    if (!avatarObserved) updateAvatarMenu(activeAvatar(metadata));
  }).catch(report);
});
