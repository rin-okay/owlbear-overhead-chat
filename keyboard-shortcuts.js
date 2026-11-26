import { actionForEvent, editableTarget, keyboardProfile } from "./key-bindings.js?v=2.11.12";

export const KEYBOARD_MODAL = "chat.overhead.keyboard";

const KEYBOARD_SESSION = "keyboard-session";
const KEYBOARD_HEARTBEAT_MS = 500;
let currentEditor;

export function connectKeyboardEditor() {
  const session = new URL(location.href).searchParams.get(KEYBOARD_SESSION);
  if (!session) return () => {};
  const channel = new BroadcastChannel(session);
  const ready = () => channel.postMessage("ready");
  ready();
  const heartbeat = setInterval(ready, KEYBOARD_HEARTBEAT_MS);
  const closed = () => {
    clearInterval(heartbeat);
    channel.postMessage("closed");
    channel.close();
  };
  window.addEventListener("pagehide", closed, { once: true });
  return () => channel.postMessage("closing");
}

export async function openKeyboard(obr, onClose) {
  if (currentEditor) {
    const finish = currentEditor;
    await obr.modal.close(KEYBOARD_MODAL);
    finish();
    return;
  }
  const session = KEYBOARD_MODAL + "." + crypto.randomUUID();
  const channel = new BroadcastChannel(session);
  let deadline;
  let finished = false;
  function finish(restore = true) {
    if (finished) return;
    finished = true;
    currentEditor = undefined;
    clearTimeout(deadline);
    channel.close();
    window.removeEventListener("pagehide", dispose);
    if (restore) onClose?.();
  }
  const dispose = () => finish(false);
  currentEditor = finish;
  window.addEventListener("pagehide", dispose, { once: true });
  channel.onmessage = ({ data }) => {
    clearTimeout(deadline);
    if (data === "closed") finish();
    // Owlbear can remove the iframe without sending pagehide to the editor.
    if (data === "ready") deadline = setTimeout(finish, 3 * KEYBOARD_HEARTBEAT_MS);
    if (data === "closing") deadline = setTimeout(finish, KEYBOARD_HEARTBEAT_MS);
  };
  try {
    const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
    const url = new URL("./keyboard.html?v=2.11.12", import.meta.url);
    url.searchParams.set(KEYBOARD_SESSION, session);
    await obr.modal.open({
      id: KEYBOARD_MODAL, url: url.href,
      width: Math.min(1040, Math.max(280, width - 32)),
      height: Math.min(720, Math.max(280, height - 36)),
      hidePaper: true,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}

export function isFixedKeyboardShortcut(event) {
  return (event.code === "F10" || event.key === "F10") &&
    !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

export function handleRoomKey(obr, event, handlers) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.target?.closest?.("dialog")) return false;
  const fixedEditor = isFixedKeyboardShortcut(event);
  if (!fixedEditor && editableTarget(event.target)) return false;
  const id = fixedEditor ? "keyboard" : actionForEvent(keyboardProfile(obr).bindings, event)?.id;
  if (!Object.hasOwn(handlers, id)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) void Promise.resolve(handlers[id]()).catch(console.error);
  return true;
}
