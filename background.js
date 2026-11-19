import OBR, { buildBillboard, buildLabel } from "./obr.js";
import { AVATAR, SPEECH, BUBBLE_MS, canSpeak, isPublicToken, parseSpeech } from "./rules.js";

import { drawBubble, fonts, normalizeAppearance } from "./appearance.js";
import { openSessionChannel, saveAvatar } from "./session.js";

const transcript = [];
let transcriptChannel;

const active = new Map();
let pending = Promise.resolve();
let sceneVersion = 0;

async function removeBubble(tokenId, bubble) {
  if (active.get(tokenId) !== bubble) return;

  clearTimeout(bubble.timer);
  active.delete(tokenId);
  await OBR.scene.local.deleteItems([bubble.id]);
}

function report(error) {
  console.error("Overhead Chat background", error);
}

async function showSpeech(event, speech, version) {
  if (version !== sceneVersion || !await OBR.scene.isReady()) return;

  const [items, permissions, connectionId, role, party] = await Promise.all([
    OBR.scene.items.getItems([speech.tokenId]),
    OBR.room.getPermissions(),
    OBR.player.getConnectionId(),
    OBR.player.getRole(),
    OBR.party.getPlayers(),
  ]);
  const sender = event.connectionId === connectionId
    ? { id: OBR.player.id, role }
    : party.find((player) => player.connectionId === event.connectionId);
  const [token] = items;
  if (version !== sceneVersion || !canSpeak(sender, token, permissions)) return;

  const { tokenId, text } = speech;
  const appearance = normalizeAppearance(event.data.appearance);
  const entry = { name: appearance.name || token.name || "Character", text, own: event.connectionId === connectionId };
  transcript.push(entry);
  transcriptChannel?.postMessage({ type: "line", entry });

  const bounds = await OBR.scene.items.getItemBounds([tokenId]);
  if (version !== sceneVersion || !Number.isFinite(bounds?.min?.y) ||
      !Number.isFinite(bounds?.max?.y) ||
      !Number.isFinite(bounds?.center?.x)) return;

  const previous = active.get(tokenId);
  if (previous) await removeBubble(tokenId, previous);
  if (version !== sceneVersion) return;

  const gap = Math.min(16, Math.max(4, (bounds.max.y - bounds.min.y) * 0.07));
  const position = { x: bounds.center.x, y: bounds.min.y - gap };
  const canvas = drawBubble(text, appearance);
  const bubbleBuilder = buildBillboard({
    url: canvas.toDataURL("image/png"), mime: "image/png", width: canvas.width, height: canvas.height,
  }, { dpi: 300, offset: { x: canvas.width / 2, y: canvas.height } });

  const attach = (builder) => {
    const item = builder.position(position).attachedTo(tokenId).layer("TEXT").locked(true).build();
    item.disableHit = true;
    item.disableAttachmentBehavior = ["COPY", "ROTATION", "SCALE", "LOCKED"];
    return item;
  };

  let label = attach(bubbleBuilder);
  try {
    await OBR.scene.local.addItems([label]);
  } catch {
    if (version !== sceneVersion) return;
    label = attach(buildLabel()
      .plainText(text).fontFamily(fonts[appearance.font]).fontSize(appearance.size)
      .width(canvas.width / 2).padding(8).textAlign("CENTER").fillColor(appearance.color)
      .backgroundColor(appearance.fill).cornerRadius(8)
      .pointerWidth(12).pointerHeight(7).pointerDirection("DOWN"));
    await OBR.scene.local.addItems([label]);
  }
  if (version !== sceneVersion) {
    if (await OBR.scene.isReady()) await OBR.scene.local.deleteItems([label.id]);
    return;
  }

  const bubble = { id: label.id, timer: null };
  active.set(tokenId, bubble);
  bubble.timer = setTimeout(() => {
    removeBubble(tokenId, bubble).catch(report);
  }, BUBBLE_MS);
}

function queueSpeech(event) {
  const speech = parseSpeech(event.data);
  if (!speech) return;
  const version = sceneVersion;

  // Validate messages in receive order so the transcript reads in order.
  pending = pending.then(() => showSpeech(event, speech, version)).catch(report);
}

OBR.onReady(() => {
  OBR.broadcast.onMessage(SPEECH, queueSpeech);
  openSessionChannel().then((channel) => {
    transcriptChannel = channel;
    channel.onmessage = ({ data }) => {
      if (data?.type === "request") channel.postMessage({ type: "history", entries: transcript });
    };
    channel.postMessage({ type: "ready" });
  }).catch(report);
  OBR.scene.onReadyChange((ready) => {
    if (ready) return;
    ++sceneVersion;
    for (const bubble of active.values()) clearTimeout(bubble.timer);
    active.clear();
    pending = Promise.resolve();
  });

  OBR.scene.items.onChange((items) => {
    if (!active.size) return;
    const publicTokens = new Set(items.filter(isPublicToken).map((item) => item.id));
    for (const [tokenId, bubble] of active) {
      if (!publicTokens.has(tokenId)) removeBubble(tokenId, bubble).catch(report);
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
