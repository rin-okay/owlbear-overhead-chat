import { actionForEvent, editableTarget, keyboardProfile } from "./key-bindings.js?v=2.11.5";

export const KEYBOARD_MODAL = "chat.overhead.keyboard";

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
