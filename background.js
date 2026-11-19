import OBR, { buildLabel } from "./obr.js";
import { AVATAR, SPEECH, BUBBLE_MS, canSpeak, isPublicToken, parseSpeech } from "./rules.js";

const active = new Map();
const pending = new Map();
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
  if (!canSpeak(sender, items[0], permissions)) return;

  const { tokenId, text } = speech;
  const bounds = await OBR.scene.items.getItemBounds([tokenId]);
  if (version !== sceneVersion || !Number.isFinite(bounds?.min?.y) ||
      !Number.isFinite(bounds?.max?.y) ||
      !Number.isFinite(bounds?.center?.x)) return;

  const previous = active.get(tokenId);
  if (previous) await removeBubble(tokenId, previous);
  if (version !== sceneVersion) return;

  const gap = Math.min(16, Math.max(4, (bounds.max.y - bounds.min.y) * 0.07));
  const label = buildLabel()
    .plainText(text)
    .position({ x: bounds.center.x, y: bounds.min.y - gap })
    .attachedTo(tokenId)
    .layer("TEXT")
    .locked(true)
    .fontSize(15)
    .fontWeight(550)
    .width(Math.min(230, Math.max(72, Array.from(text).length * 8 + 20)))
    .padding(8)
    .textAlign("CENTER")
    .fillColor("#241d31")
    .backgroundColor("#fbf6ff")
    .cornerRadius(8)
    .pointerWidth(12)
    .pointerHeight(7)
    .pointerDirection("DOWN")
    .build();

  label.disableHit = true;
  label.disableAttachmentBehavior = ["COPY", "ROTATION", "SCALE", "LOCKED"];
  await OBR.scene.local.addItems([label]);
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

  // Keep SDK operations in arrival order when several lines target the same token.
  const previous = pending.get(speech.tokenId) ?? Promise.resolve();
  const work = previous.then(() => showSpeech(event, speech, version)).catch(report);
  pending.set(speech.tokenId, work);
  void work.then(() => {
    if (pending.get(speech.tokenId) === work) pending.delete(speech.tokenId);
  });
}

OBR.onReady(() => {
  OBR.broadcast.onMessage(SPEECH, queueSpeech);
  OBR.scene.onReadyChange((ready) => {
    if (ready) return;
    ++sceneVersion;
    for (const bubble of active.values()) clearTimeout(bubble.timer);
    active.clear();
    pending.clear();
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
      icon: new URL("./icon.svg", import.meta.url).href,
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

        await OBR.player.setMetadata({ [AVATAR]: { tokenId: token.id } });
        await OBR.action.open();
      } catch (error) {
        report(error);
        await OBR.notification.show("Couldn’t set your chat avatar. Try again.");
      }
    },
  }).catch(report);
});
