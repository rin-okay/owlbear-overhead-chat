import OBR, { buildBillboard, buildImage, buildLabel } from "./obr.js";
import {
  ABOVE_FOG, AVATAR, HABBO_MODE, SPEECH, BUBBLE_MS, GENERAL_CHAT_ROOM, canSpeak, isChatRoom, isPublicToken, parseSpeech,
} from "./rules.js";

import { BUBBLE_LINE_HEIGHT, drawBubble, drawFloatingBubble, fonts, normalizeAppearance } from "./appearance.js?v=2.4.0";
import { FLOAT_LINE, placeFloatingBubbles } from "./floating-layout.js";
import { openSessionChannel, saveAvatar } from "./session.js";
import { chatParts, isRollCommand, rollSpans } from "./dice.js";
import { queueDiscord } from "./discord.js?v=2.3.9";
import { parseTray } from "./dice-replay.js";
import { queueDicePopup, resetDicePopups } from "./dice-popup.js";

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
  const removed = floating.filter(({ id }) => !targets.has(id)).map(({ id }) => id);
  const moved = floating.filter(({ id, y }) => targets.has(id) && targets.get(id).y !== y).map(({ id }) => id);
  if (removed.length) await OBR.scene.local.deleteItems(removed);
  if (version !== sceneVersion) return;
  if (moved.length) {
    await OBR.scene.local.updateItems(moved, (items) => {
      for (const item of items) item.position.y = targets.get(item.id).y;
    });
  }
  if (version === sceneVersion) floating = next;
}

async function showFloating(text, appearance, tokenId, position, layer, version, current) {
  const dpi = await OBR.scene.grid.getDpi();
  if (!current() || !Number.isFinite(dpi) || dpi <= 0) return;
  const { canvas, width, height } = drawFloatingBubble(text, appearance);
  const item = buildImage({
    url: canvas.toDataURL("image/png"), mime: "image/png", width: canvas.width, height: canvas.height,
  }, { dpi: dpi * 2, offset: { x: canvas.width / 2, y: canvas.height } })
    .position(position).layer(layer).locked(true).build();
  item.disableHit = true;
  const bubble = { id: item.id, tokenId, width, height, x: position.x, y: position.y, originY: position.y };
  const placed = placeFloatingBubbles([bubble, ...floating]);
  await updateFloating(placed.slice(1), version);
  if (!current()) return;
  await OBR.scene.local.addItems([item]);
  if (!current()) {
    if (await OBR.scene.isReady()) await OBR.scene.local.deleteItems([item.id]);
    return;
  }
  floating.unshift(bubble);
  scheduleFloatingStep();
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
  const id = phase ? `${event.connectionId}:${rollId}` : `message:${sequence + 1}`;
  const previousRoll = phase ? transcript.get(id) : undefined;
  while (settledRolls.size && settledRolls.values().next().value <= receivedAt) {
    settledRolls.delete(settledRolls.keys().next().value);
  }
  if (settledRolls.has(id) || (previousRoll &&
      (phase === "pending" || previousRoll.rollPhase !== "pending" ||
       previousRoll.tokenId !== tokenId || previousRoll.roomId !== roomId))) return;
  const parts = chatParts(speech.text, event.data.rolls);
  const text = parts.map((part) => typeof part === "string" ? part : `${part.notation}: ${part.total}`).join("");
  const appearance = normalizeAppearance(event.data.appearance);
  const entry = {
    name: appearance.name || token.name || "Character",
    text,
    parts,
    id,
    tokenId,
    roomId,
    rollPhase: phase,
    sequence: previousRoll?.sequence ?? ++sequence,
    rolling: phase === "pending",
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
  const bounds = await OBR.scene.items.getItemBounds([tokenId]);
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

  const { canvas, lines } = drawBubble(text, appearance);
  const bubbleBuilder = buildBillboard({
    url: canvas.toDataURL("image/png"), mime: "image/png", width: canvas.width, height: canvas.height,
  }, { dpi: 300, offset: { x: canvas.width / 2, y: canvas.height } });

  const attach = (builder) => {
    const item = builder.position(position).attachedTo(tokenId).layer(layer).locked(true).build();
    item.disableHit = true;
    item.disableAttachmentBehavior = ["COPY", "ROTATION", "SCALE", "LOCKED"];
    return item;
  };

  let labels = [attach(bubbleBuilder)];
  try {
    await OBR.scene.local.addItems(labels);
  } catch {
    if (!current()) return;

    const nativeLabel = () => buildLabel()
      .plainText(lines.join("\n")).width("AUTO").fontFamily(fonts[appearance.font].face).fontSize(appearance.size)
      .lineHeight(BUBBLE_LINE_HEIGHT).textAlign("CENTER").pointerDirection("DOWN");
    // Owlbear's native label has no border style. Stack two matching labels
    // with extra padding on the back layer to draw the rim. Both pointer
    // tips share an anchor. Extend the inner pointer to inset its body.
    labels = [
      attach(nativeLabel().padding(10).fillColor(appearance.border)
        .backgroundColor(appearance.border).cornerRadius(10)
        .pointerWidth(16).pointerHeight(7)),
      attach(nativeLabel().padding(8).fillColor(appearance.color)
        .backgroundColor(appearance.fill).cornerRadius(8)
        .pointerWidth(12).pointerHeight(9)),
    ];
    labels.forEach((item, index) => {
      item.zIndex = index;
      item.disableAutoZIndex = true;
    });
    await OBR.scene.local.addItems(labels);
  }

  const ids = labels.map((item) => item.id);
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
  openSessionChannel().then((channel) => {
    transcriptChannel = channel;
    channel.onmessage = ({ data }) => {
      if (data?.type === "request" && typeof data.requestId === "string") publishHistory(data);
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

  OBR.contextMenu.create({
    id: "chat.overhead.set-avatar.v1",
    icons: [{
      icon: new URL("./toolbar-chat.svg", import.meta.url).href,
      label: "Set as avatar",
      filter: {
        min: 1,
        max: 1,
        permissions: ["UPDATE"],
        every: [
          { key: "type", value: "IMAGE" },
          { key: "layer", value: "CHARACTER" },
          { key: "visible", value: true },
        ],
      },
    }],
    async onClick({ items }) {
      const [token] = items;
      try {
        const [role, permissions] = await Promise.all([
          OBR.player.getRole(),
          OBR.room.getPermissions(),
        ]);
        if (items.length !== 1 || !canSpeak({ role, id: OBR.player.id }, token, permissions)) {
          await OBR.notification.show("Choose a visible character token you can update.");
          return;
        }

        saveAvatar(token.id);
        await OBR.player.setMetadata({ [AVATAR]: { tokenId: token.id } });
        await OBR.action.open();
      } catch (error) {
        report(error);
        await OBR.notification.show("Couldn’t set your chat avatar. Try again.");
      }
    },
  }).catch(report);
});
