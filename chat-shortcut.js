const SHORTCUT_TTL = 15_000;

function shortcutKey(obr) {
  return JSON.stringify(["chat.overhead.open-shortcut.v1", obr.room.id, obr.player.id]);
}

export function requestChatShortcut(obr, mode) {
  sessionStorage.setItem(shortcutKey(obr), JSON.stringify({ mode, time: Date.now() }));
}

export function listenForChatShortcut(obr, openChat) {
  const key = shortcutKey(obr);
  function readRequest() {
    let request;
    try {
      const stored = sessionStorage.getItem(key);
      if (!stored) return;
      sessionStorage.removeItem(key);
      request = JSON.parse(stored);
    } catch {
      return;
    }
    if ((request?.mode === "chat" || request?.mode === "move") &&
        Date.now() - request.time >= 0 && Date.now() - request.time < SHORTCUT_TTL) openChat(request.mode);
  }
  window.addEventListener("storage", (event) => {
    if (event.key === key && event.storageArea === sessionStorage && event.newValue) readRequest();
  });
  readRequest();
}
