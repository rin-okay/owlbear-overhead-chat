import { AVATAR, isPublicToken } from "./rules.js";
import { savedAvatar } from "./session.js";

function avatarId(metadata) {
  return metadata[AVATAR]?.tokenId ?? savedAvatar();
}

async function centerViewport(obr, center, active = () => true) {
  const viewport = obr.viewport;
  const [width, height, scale, position] = await Promise.all([
    viewport.getWidth(), viewport.getHeight(), viewport.getScale(), viewport.getPosition(),
  ]);
  if (!active() || ![center?.x, center?.y, width, height, scale].every(Number.isFinite) || scale <= 0) return;
  const x = width / 2 - center.x * scale;
  const y = height / 2 - center.y * scale;
  if (Math.abs(position.x - x) > 0.5 || Math.abs(position.y - y) > 0.5) await viewport.setPosition({ x, y });
}

export async function centerAvatar(obr) {
  if (!await obr.scene.isReady()) return;
  const id = avatarId(await obr.player.getMetadata());
  if (!id) return;
  const [token] = await obr.scene.items.getItems([id]);
  if (!isPublicToken(token)) return;
  const { center } = await obr.scene.items.getItemBounds([id]);
  await centerViewport(obr, center);
}

export function cameraFollowPreference(obr, onChange) {
  const key = JSON.stringify(["chat.overhead.camera-follow.v1", obr.room.id, obr.player.id]);
  function get() {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  }
  function set(enabled) {
    localStorage.setItem(key, String(enabled));
    onChange(enabled);
  }
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) onChange(get());
  });
  onChange(get());
  return {
    set,
    async toggle() {
      const enabled = !get();
      set(enabled);
      await obr.notification.show(enabled ? "Camera follow mode on" : "Camera follow mode off");
    },
  };
}

function tokenPose(token) {
  if (!isPublicToken(token)) return null;
  return JSON.stringify([token.position, token.rotation, token.scale, token.grid, token.image?.width, token.image?.height]);
}

export function setupCameraFollow(obr) {
  let enabled = false;
  let ready;
  let id;
  let pose;
  let center;
  let revision = 0;
  let timer;
  let running = false;

  function schedule(delay = 0) {
    clearTimeout(timer);
    if (enabled && ready && id && center !== null && !running) timer = setTimeout(update, delay);
  }

  function invalidate() {
    revision++;
    center = undefined;
    schedule();
  }

  async function update() {
    running = true;
    const started = revision;
    const active = () => enabled && ready && started === revision;
    try {
      if (!center) {
        const [token] = await obr.scene.items.getItems([id]);
        if (!active()) return;
        pose = tokenPose(token);
        const bounds = pose ? await obr.scene.items.getItemBounds([id]) : null;
        if (!active()) return;
        center = bounds?.center ?? null;
      }
      if (center) await centerViewport(obr, center, active);
    } catch (error) {
      if (active()) {
        center = null;
        console.error("Overhead Chat camera follow", error);
      }
    } finally {
      running = false;
      // The viewport API has no change listener. Check for pan or zoom while following.
      schedule(started === revision ? 200 : 0);
    }
  }

  function setAvatar(metadata) {
    const next = avatarId(metadata);
    if (next === id) return;
    id = next;
    pose = undefined;
    invalidate();
  }

  obr.scene.items.onChange((items) => {
    if (!enabled || !id) return;
    const next = tokenPose(items.find((item) => item.id === id));
    if (next === pose) return;
    pose = next;
    invalidate();
  });
  obr.scene.onReadyChange((value) => {
    ready = value;
    pose = undefined;
    invalidate();
  });
  let avatarChanged = false;
  obr.player.onChange(({ metadata }) => {
    avatarChanged = true;
    setAvatar(metadata);
  });
  void obr.player.getMetadata().then((metadata) => {
    if (!avatarChanged) setAvatar(metadata);
  }).catch(console.error);
  void obr.scene.isReady().then((value) => {
    if (ready !== undefined) return;
    ready = value;
    schedule();
  }).catch(console.error);

  return cameraFollowPreference(obr, (value) => {
    enabled = value;
    invalidate();
  });
}
