import OBR, { buildBillboard, buildLabel } from "./obr.js";
import { ABOVE_FOG, AVATAR, SPEECH, BUBBLE_MS, canSpeak, isPublicToken, parseSpeech } from "./rules.js";

import { BUBBLE_LINE_HEIGHT, drawBubble, fonts, normalizeAppearance } from "./appearance.js";
import { openSessionChannel, saveAvatar } from "./session.js";
import { queueDiscord } from "./discord.js";

const transcript = [];
let transcriptChannel;

const active = new Map();
let pending = Promise.resolve();
let sceneVersion = 0;

async function removeBubble(tokenId, bubble) {
  if (active.get(tokenId) !== bubble) return;

  clearTimeout(bubble.timer);
  active.delete(tokenId);
  await OBR.scene.local.deleteItems(bubble.ids);
}

function report(error) {
  console.error("Overhead Chat background", error);
}

async function showSpeech(event, speech, version, receivedAt) {
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
  const entry = {
    name: appearance.name || token.name || "Character",
    text,
    receivedAt,
    own: event.connectionId === connectionId,
  };
  transcript.push(entry);
  transcriptChannel?.postMessage({ type: "line", entry });
  queueDiscord(entry, role, (message) => transcriptChannel?.postMessage({ type: "discord-status", message }));

  const [bounds, roomMetadata] = await Promise.all([
    OBR.scene.items.getItemBounds([tokenId]),
    OBR.room.getMetadata().catch(() => ({})),
  ]);
  const layer = roomMetadata[ABOVE_FOG] === true ? "CONTROL" : "TEXT";
  if (version !== sceneVersion || !Number.isFinite(bounds?.min?.y) ||
      !Number.isFinite(bounds?.max?.y) ||
      !Number.isFinite(bounds?.center?.x)) return;

  const previous = active.get(tokenId);
  if (previous) await removeBubble(tokenId, previous);
  if (version !== sceneVersion) return;

  const gap = Math.min(16, Math.max(4, (bounds.max.y - bounds.min.y) * 0.07));
  const position = { x: bounds.center.x, y: bounds.min.y - gap };
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
    if (version !== sceneVersion) return;

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
  if (version !== sceneVersion) {
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
  const version = sceneVersion;
  const receivedAt = Date.now();

  // Validate messages in receive order so the transcript reads in order.
  pending = pending.then(() => showSpeech(event, speech, version, receivedAt)).catch(report);
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
