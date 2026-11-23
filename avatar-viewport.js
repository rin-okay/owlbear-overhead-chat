import { AVATAR, isPublicToken } from "./rules.js";
import { savedAvatar } from "./session.js?v=2.7.8";

function avatarId(metadata) {
  return metadata[AVATAR]?.tokenId ?? savedAvatar();
}

async function readViewport(viewport) {
  const [width, height, scale, position] = await Promise.all([
    viewport.getWidth(), viewport.getHeight(), viewport.getScale(), viewport.getPosition(),
  ]);
  return { width, height, scale, position };
}

async function centerViewport(viewport, center, view, active = () => true) {
  const { width, height, scale, position } = view;
  if (!active() || ![center?.x, center?.y, width, height, scale].every(Number.isFinite) || scale <= 0) return;
  const x = width / 2 - center.x * scale;
  const y = height / 2 - center.y * scale;
  if (Math.abs(position.x - x) <= 0.5 && Math.abs(position.y - y) <= 0.5) return;
  await viewport.setPosition({ x, y });
  view.position = { x, y };
}

export async function centerAvatar(obr) {
  if (!await obr.scene.isReady()) return;
  const id = avatarId(await obr.player.getMetadata());
  if (!id) return;
  const [token] = await obr.scene.items.getItems([id]);
  if (!isPublicToken(token)) return;
  const { center } = await obr.scene.items.getItemBounds([id]);
  await centerViewport(obr.viewport, center, await readViewport(obr.viewport));
}

function cameraFollowKey(obr) {
  return JSON.stringify(["chat.overhead.camera-follow.v1", obr.room.id, obr.player.id]);
}

function cameraFollowEnabled(obr) {
  try {
    return localStorage.getItem(cameraFollowKey(obr)) === "true";
  } catch {
    return false;
  }
}

function keyboardPanKey(obr) {
  return JSON.stringify(["chat.overhead.keyboard-pan.v1", obr.room.id, obr.player.id]);
}

function keyboardPanPending(obr, tokenId) {
  try {
    const pan = JSON.parse(sessionStorage.getItem(keyboardPanKey(obr)));
    return pan?.tokenId === tokenId && pan.until > Date.now();
  } catch {
    return false;
  }
}

export async function prepareKeyboardPan(obr, tokenId) {
  if (!cameraFollowEnabled(obr)) return;
  const [{ center }, view] = await Promise.all([
    obr.scene.items.getItemBounds([tokenId]), readViewport(obr.viewport),
  ]);
  if (![center?.x, center?.y, view.scale].every(Number.isFinite) || view.scale <= 0) return;

  return async (delta, moveToken) => {
    if (!cameraFollowEnabled(obr)) return moveToken();
    const key = keyboardPanKey(obr);
    const lease = JSON.stringify({ tokenId, until: Date.now() + 350 });
    try {
      sessionStorage.setItem(key, lease);
    } catch {
      return moveToken();
    }
    function release() {
      if (sessionStorage.getItem(key) === lease) sessionStorage.removeItem(key);
    }
    const move = moveToken();
    const pan = centerViewport(obr.viewport, { x: center.x + delta.x, y: center.y + delta.y }, view);
    const [movement, camera] = await Promise.allSettled([move, pan]);
    if (camera.status === "rejected" || movement.status === "rejected") release();
    if (camera.status === "rejected") console.error("Overhead Chat keyboard camera pan", camera.reason);
    if (movement.status === "rejected") throw movement.reason;
  };
}

export function cameraFollowPreference(obr, onChange) {
  const key = cameraFollowKey(obr);
  const get = () => cameraFollowEnabled(obr);
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
  return JSON.stringify([token.rotation, token.scale, token.grid, token.image?.width, token.image?.height, token.attachedTo]);
}

export function setupCameraFollow(obr) {
  let enabled = false;
  let ready;
  let id;
  let token;
  let pose;
  let center;
  let view;
  let viewReadAt = 0;
  let revision = 0;
  let timer;
  let running = false;

  function schedule(delay = 0) {
    clearTimeout(timer);
    if (!enabled || !ready || !id || center === null || running) return;
    if (delay) timer = setTimeout(update, delay);
    else void update();
  }

  function invalidate() {
    revision++;
    token = pose = center = view = undefined;
    schedule();
  }

  async function update() {
    running = true;
    const started = revision;
    const active = () => enabled && ready && started === revision;
    try {
      if (!center) {
        if (token === undefined) {
          const [next] = await obr.scene.items.getItems([id]);
          if (!active()) return;
          token = next ?? null;
          pose = tokenPose(token);
        }
        const bounds = pose ? await obr.scene.items.getItemBounds([id]) : null;
        if (!active()) return;
        center = bounds?.center ?? null;
      }
      if (!center) return;
      if (keyboardPanPending(obr, id)) {
        view = undefined;
        return;
      }
      if (!view || Date.now() - viewReadAt >= 200) {
        const nextView = await readViewport(obr.viewport);
        if (!active()) return;
        view = nextView;
        viewReadAt = Date.now();
      }
      await centerViewport(obr.viewport, center, view, () => active() && !keyboardPanPending(obr, id));
    } catch (error) {
      if (active()) {
        center = null;
        console.error("Overhead Chat camera follow", error);
      }
    } finally {
      running = false;
      // Keep pan and zoom in sync between token moves.
      schedule(started === revision ? 200 : 0);
    }
  }

  function setAvatar(metadata) {
    const next = avatarId(metadata);
    if (next === id) return;
    id = next;
    invalidate();
  }

  obr.scene.items.onChange((items) => {
    if (!enabled || !id) return;
    const next = items.find((item) => item.id === id) ?? null;
    const nextPose = tokenPose(next);
    const oldPosition = token?.position;
    const position = next?.position;
    const translated = oldPosition?.x !== position?.x || oldPosition?.y !== position?.y;
    if (nextPose === pose && !translated) return;
    if (center && nextPose && nextPose === pose && oldPosition && position) {
      // With the same shape and rotation, the bounds center moves by the token's exact delta.
      center = { x: center.x + position.x - oldPosition.x, y: center.y + position.y - oldPosition.y };
    } else {
      center = nextPose ? undefined : null;
    }
    token = next;
    pose = nextPose;
    revision++;
    schedule();
  });
  obr.scene.onReadyChange((value) => {
    ready = value;
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
