import { actionForEvent, bindingStorageKey, browserLayout, editableTarget, keyboardProfile, KEY_ACTIONS, mapShortcut } from "./key-bindings.js?v=2.11.4";

export const KEYBOARD_MODAL = "chat.overhead.keyboard";
const APP_KEY = "chat.overhead.shortcut.";

export async function openKeyboard(obr) {
  const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
  await obr.modal.open({
    id: KEYBOARD_MODAL, url: new URL("./keyboard.html?v=2.11.4", import.meta.url).href,
    width: Math.min(1040, Math.max(280, width - 32)),
    height: Math.min(720, Math.max(280, height - 36)),
    hidePaper: true,
  });
}

export function handleRoomKey(obr, event, handlers) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.target?.closest?.("dialog")) return false;
  const fixedEditor = (event.code === "F10" || event.key === "F10") &&
    !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  if (!fixedEditor && editableTarget(event.target)) return false;
  const id = fixedEditor ? "keyboard" : actionForEvent(keyboardProfile(obr).bindings, event)?.id;
  if (!Object.hasOwn(handlers, id)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) void Promise.resolve(handlers[id]()).catch(console.error);
  return true;
}

export function setupSceneKeys(obr, handlers, report = console.error) {
  const active = new Map();
  let detected = {};
  let queue = Promise.resolve();
  let disposed = false;

  function tool(id, label, callback, shortcut) {
    return {
      id: APP_KEY + id, ...(shortcut ? { shortcut } : {}),
      icons: [{ icon: new URL(id === "keyboard" ? "./keyboard.svg" : "./icon.svg", import.meta.url).href, label }],
      onClick() {
        void Promise.resolve(callback()).catch(report);
        return false;
      },
    };
  }

  void obr.tool.create(tool("keyboard-fixed", "Keyboard settings (F10)", handlers.keyboard, "F10")).catch(report);

  async function sync() {
    if (disposed) return;
    const { bindings, layout } = keyboardProfile(obr);
    const registered = new Set();
    const changes = [];
    for (const [id, handler] of Object.entries(handlers)) {
      const spec = KEY_ACTIONS[id];
      if (!spec?.scene) continue;
      const found = mapShortcut(bindings[id], { ...detected, ...layout });
      const shortcut = registered.has(found) ? undefined : found;
      if (shortcut) registered.add(shortcut);
      const clickable = id === "hotbar-toggle" || id === "hotbar-mode";
      const next = shortcut || (clickable ? "" : undefined);
      if (active.get(id) !== next) changes.push({ id, spec, handler, next });
    }
    // Remove old assignments before claiming new keys so the host never sees an avoidable duplicate.
    for (const { id } of changes) {
      if (active.has(id)) {
        await obr.tool.remove(APP_KEY + id);
        active.delete(id);
      }
    }
    for (const { id, spec, handler, next } of changes) {
      if (next === undefined) continue;
      await obr.tool.create(tool(id, spec.label, handler, next));
      active.set(id, next);
    }
  }

  const refresh = () => { queue = queue.then(sync).catch(report); };
  refresh();
  void browserLayout().then((map) => { detected = map; refresh(); });
  const storageKey = bindingStorageKey(obr);
  function keyboardChanged(event) {
    if (event.key === storageKey || event.key === null) refresh();
  }
  window.addEventListener("storage", keyboardChanged);
  window.addEventListener("pagehide", () => {
    disposed = true;
    window.removeEventListener("storage", keyboardChanged);
  }, { once: true });
}
