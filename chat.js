import OBR from "./obr.js";
import { AVATAR, SPEECH, canSpeak, parseSpeech } from "./rules.js";

import { openSessionChannel, savedAvatar, saveAvatar } from "./session.js";

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
let refreshVersion = 0;

function appendLine(entry, target) {
  const line = document.createElement("li");
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = `${entry.name}: `;
  line.append(name, entry.text);
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
      if (data?.type === "history") {
        const fragment = document.createDocumentFragment();
        data.entries.forEach((entry) => appendLine(entry, fragment));
        entries.replaceChildren(fragment);
        empty.hidden = data.entries.length > 0;
        scrollToLatest();
      }
      if (data?.type === "line") {
        const nearBottom = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 32;
        empty.hidden = true;
        appendLine(data.entry, entries);
        if (nearBottom || data.entry.own) scrollToLatest();
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

    await OBR.broadcast.sendMessage(SPEECH, speech, { destination: "ALL" });
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

OBR.onReady(() => {
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
