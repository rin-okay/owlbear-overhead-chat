import OBR, { buildImage } from "./obr.js";
import { AVATAR, canSpeak } from "./rules.js";
import { saveAvatar } from "./session.js?v=2.11.17";

const SIZE = 256;
const CENTER = SIZE / 2;
const RADIUS = CENTER - 2;
const BORDER = 5;
const TOKEN_GRID = { dpi: SIZE, offset: { x: CENTER, y: CENTER } };

export function cropPlacement(width, height, zoom, { x, y }) {
  const scale = SIZE / Math.min(width, height) * zoom;
  const w = width * scale;
  const h = height * scale;
  const constrain = (offset, length) => {
    const limit = Math.max(0, (length - SIZE) / 2);
    return Math.max(-limit, Math.min(offset, limit));
  };
  return { width: w, height: h, x: constrain(x, w), y: constrain(y, h) };
}

function drawToken(ctx, image, crop, color) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, (SIZE - crop.width) / 2 + crop.x, (SIZE - crop.height) / 2 + crop.y, crop.width, crop.height);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, RADIUS - BORDER / 2, 0, Math.PI * 2);
  ctx.lineWidth = BORDER;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function pngFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(new File([blob], name + ".png", { type: "image/png" }));
      else reject(Error("Owlbear couldn’t export this crop as a PNG."));
    }, "image/png");
  });
}

async function makeAvatar(asset, current) {
  if (!await OBR.scene.isReady() || !current()) throw Error("Open a scene to use this character as your avatar.");
  const [role, permissions, items] = await Promise.all([
    OBR.player.getRole(), OBR.room.getPermissions(),
    OBR.scene.items.getItems((item) => item.createdUserId === OBR.player.id && item.image?.url === asset.image.url),
  ]);
  if (!current()) throw Error("The scene changed. Try again in the current scene.");
  const player = { id: OBR.player.id, role };
  const metadata = await OBR.player.getMetadata();
  const matching = items.filter((item) => !item.locked && canSpeak(player, item, permissions));
  let token = matching.find(({ id }) => id === metadata[AVATAR]?.tokenId) ?? matching[0];
  if (!token) {
    if (role !== "GM" && !permissions.includes("CHARACTER_UPDATE")) {
      throw Error("Ask the GM to enable Character Update to use this avatar.");
    }
    if (role !== "GM" && !permissions.includes("CHARACTER_CREATE")) {
      throw Error("Ask the GM to enable Character Create or place this token in the scene first.");
    }
    const [offset, scale, width, height] = await Promise.all([
      OBR.viewport.getPosition(), OBR.viewport.getScale(), OBR.viewport.getWidth(), OBR.viewport.getHeight(),
    ]);
    if (![offset?.x, offset?.y, scale, width, height].every(Number.isFinite) || scale <= 0) {
      throw Error("Couldn’t find the center of the map view.");
    }
    const center = { x: (width / 2 - offset.x) / scale, y: (height / 2 - offset.y) / scale };
    const snapped = await OBR.scene.grid.snapPosition(center, 1, false, true).catch(() => null);
    const position = Number.isFinite(snapped?.x) && Number.isFinite(snapped?.y) ? snapped : center;
    if (!current()) throw Error("The scene changed. Try again in the current scene.");
    token = buildImage(asset.image, asset.grid)
      .name(asset.name || "Avatar").layer("CHARACTER").position(position)
      .rotation(asset.rotation ?? 0).scale(asset.scale ?? { x: 1, y: 1 })
      .createdUserId(player.id).build();
    await OBR.scene.items.addItems([token]);
  }
  if (!current()) throw Error("The scene changed. Try again in the current scene.");
  await OBR.player.setMetadata({ [AVATAR]: { tokenId: token.id } });
  saveAvatar(token.id);
}

export function setupAvatarCreator(panel, openDialog) {
  const attachment = panel.querySelector("#avatar-pick-attachment");
  const character = panel.querySelector("#avatar-pick-character");
  const create = panel.querySelector("#avatar-create-token");
  const activate = panel.querySelector("#avatar-use-character");
  const edit = panel.querySelector("#avatar-crop-controls");
  const canvas = panel.querySelector("#avatar-crop-preview");
  const zoom = panel.querySelector("#avatar-crop-zoom");
  const color = panel.querySelector("#avatar-border-color");
  const name = panel.querySelector("#avatar-token-name");
  const preview = panel.querySelector("#avatar-character-preview");
  const portrait = preview.querySelector("img");
  const caption = preview.querySelector("span");
  const status = panel.querySelector("#avatar-creator-status");
  const ctx = canvas.getContext("2d");
  let source;
  let asset;
  let busy = false;
  let drag;
  let sceneVersion = 0;
  let offset = { x: 0, y: 0 };
  OBR.scene.onReadyChange(() => { sceneVersion++; });

  function render() {
    attachment.disabled = character.disabled = busy;
    create.disabled = busy || !source;
    activate.disabled = busy || !asset;
    edit.hidden = !source;
    preview.hidden = !asset;
    if (!source) return;
    const crop = cropPlacement(source.naturalWidth, source.naturalHeight, Number(zoom.value), offset);
    offset = { x: crop.x, y: crop.y };
    drawToken(ctx, source, crop, color.value);
  }

  async function run(action, fallback) {
    if (busy) return;
    busy = true;
    status.textContent = "";
    render();
    try { await action(); }
    catch (error) {
      console.error("Overhead Chat avatar creator", error);
      status.textContent = fallback;
    } finally {
      busy = false;
      render();
    }
  }

  attachment.addEventListener("click", () => void run(async () => {
    const [picked] = await openDialog(() => OBR.assets.downloadImages(false, undefined, "ATTACHMENT"));
    if (!picked) return;
    if (picked.type !== "ATTACHMENT") {
      status.textContent = "Choose an image from Attachments.";
      return;
    }
    if (!ctx) throw Error("Canvas unavailable");
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = picked.image.url;
    await image.decode();
    source = image;
    name.value = (picked.name || "Avatar").replace(/\.[a-z0-9]{2,5}$/i, "");
    zoom.value = "1";
    offset = { x: 0, y: 0 };
  }, "Couldn’t load that attachment for cropping. Choose another image."));

  zoom.addEventListener("input", render);
  color.addEventListener("input", render);
  canvas.addEventListener("pointerdown", (event) => {
    if (busy || !source || !event.isPrimary || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, offset, ratio: SIZE / rect.width };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    offset = {
      x: drag.offset.x + (event.clientX - drag.x) * drag.ratio,
      y: drag.offset.y + (event.clientY - drag.y) * drag.ratio,
    };
    render();
  });
  canvas.addEventListener("lostpointercapture", () => { drag = undefined; });
  const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  canvas.addEventListener("keydown", (event) => {
    if (busy || !source || event.altKey || event.ctrlKey || event.metaKey || !Object.hasOwn(offsets, event.key)) return;
    const [x, y] = offsets[event.key];
    const step = event.shiftKey ? 12 : 4;
    event.preventDefault();
    event.stopPropagation();
    offset = { x: offset.x + x * step, y: offset.y + y * step };
    render();
  });
  create.addEventListener("click", () => void run(async () => {
    const label = name.value.trim() || "Avatar";
    const file = await pngFile(canvas, label.replace(/[/\\]/g, "-"));
    await openDialog(() => OBR.assets.uploadImages([{ file, name: label, grid: TOKEN_GRID }], "CHARACTER"));
    status.textContent = "After confirming the upload, use Choose character to find your token.";
  }, "Couldn’t export or upload this token. Try again."));

  character.addEventListener("click", () => void run(async () => {
    const [picked] = await openDialog(() => OBR.assets.downloadImages(false, undefined, "CHARACTER"));
    if (!picked) return;
    if (picked.type !== "CHARACTER") {
      status.textContent = "Choose a token from Characters.";
      return;
    }
    asset = picked;
    portrait.src = picked.image.url;
    caption.textContent = picked.name || "Unnamed character";
  }, "Couldn’t open your Characters picker."));

  activate.addEventListener("click", () => void run(async () => {
    const version = sceneVersion;
    try {
      await makeAvatar(asset, () => sceneVersion === version);
      status.textContent = "This character is now your avatar.";
    } catch (error) {
      status.textContent = error.message || "Couldn’t set this character as your avatar.";
    }
  }, "Couldn’t set this character as your avatar."));
  render();
}
