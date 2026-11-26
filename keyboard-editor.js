import OBR from "./obr.js";
import {
  KEY_ACTIONS, KEYBOARD_KEYS, INTERNATIONAL_KEYS, FIXED_KEYS, MODIFIERS, actionForEvent, assignBinding, bindingLabel, browserLayout, editableTarget, eventChord,
  keyLabel, readKeyboard, resolveBindings, writeKeyboard,
} from "./key-bindings.js?v=2.11.16";
import { connectKeyboardEditor, isFixedKeyboardShortcut, KEYBOARD_MODAL } from "./keyboard-shortcuts.js?v=2.11.16";

OBR.onReady(() => {
  const board = document.querySelector("#board");
  const extraKeys = document.querySelector("#international-keys");
  const layers = document.querySelector("#modifiers");
  const sidebar = document.querySelector("#actions");
  const selection = document.querySelector("#selection");
  const filter = document.querySelector("#filter");
  const showAll = document.querySelector("#show-all");
  const feedback = document.querySelector("#feedback");
  const transferType = "application/x-overhead-chat-action";
  let { overrides, layout } = readKeyboard(OBR);
  let bindings = resolveBindings(overrides);
  let layer = 0;
  const previewLayers = [...new Set(Object.values(KEY_ACTIONS).filter((action) => action.base).map((action) => action.modifiers))]
    .sort((a, b) => a - b);
  let selected;
  let capturing = false;

  function button(label, click) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    if (click) node.addEventListener("click", click);
    return node;
  }

  function refresh(message) {
    bindings = resolveBindings(overrides);
    render();
    if (message) feedback.textContent = message;
  }

  function save(next, message) {
    try {
      writeKeyboard(OBR, { overrides: next, layout });
      overrides = next;
      refresh(message);
    } catch {
      feedback.textContent = "Your browser couldn’t save the bindings.";
    }
  }

  function choose(id, capture = false) {
    if (layer !== 0) {
      layer = 0;
      renderLayout();
    }
    selected = id;
    capturing = capture;
    if (capture) {
      document.activeElement?.blur();
      feedback.textContent = "Press a key without modifiers for " + KEY_ACTIONS[id].label + ".";
    } else {
      feedback.textContent = "Choose a key for " + KEY_ACTIONS[id].label + ".";
    }
    paintSelection();
    for (const node of document.querySelectorAll("[data-action]")) {
      node.setAttribute("aria-pressed", String(node.dataset.action === id));
    }
  }

  function assign(id, next) {
    const action = KEY_ACTIONS[id];
    if (!action || action.base || layer !== 0) return;
    const replaced = next && occupant(next.code, next.modifiers);
    selected = id;
    capturing = false;
    save(assignBinding(overrides, id, next), next
      ? action.label + " → " + bindingLabel(next, layout) + (replaced && replaced !== id ? ". " + KEY_ACTIONS[replaced].label + " is now unassigned." : ".")
      : action.label + " is now unassigned.");
  }

  function dragSource(node, id) {
    node.draggable = true;
    node.dataset.action = id;
    node.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(transferType, id);
    });
    node.addEventListener("dblclick", () => choose(id, true));
  }

  function dropTarget(node, handle) {
    node.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes(transferType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      node.classList.add("drop");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drop"));
    node.addEventListener("drop", (event) => {
      if (!event.dataTransfer.types.includes(transferType)) return;
      event.preventDefault();
      node.classList.remove("drop");
      handle(event.dataTransfer.getData(transferType));
    });
  }

  function occupant(code, modifiers) {
    return Object.keys(bindings).find((id) => bindings[id]?.code === code && bindings[id].modifiers === modifiers);
  }

  function renderLayout() {
    const toggles = [0, ...previewLayers].map((mask) => {
      const label = mask ? MODIFIERS.filter(([bit]) => mask & bit).map(([, name]) => name).join("+") : "Plain";
      const toggle = button(label, () => {
        layer = mask;
        selected = undefined;
        capturing = false;
        feedback.textContent = mask ? "Preview only. Change base bindings in Plain." : "";
        renderLayout();
        renderSidebar();
        paintSelection();
      });
      toggle.setAttribute("aria-pressed", String(mask === layer));
      return toggle;
    });
    layers.replaceChildren(...toggles);
    const left = board.scrollLeft;
    const keys = document.createElement("div");
    keys.className = "ansi-keyboard";
    for (const { code, x, y, width, height, fixed } of KEYBOARD_KEYS) {
      const key = renderKey(code, fixed);
      key.style.gridColumn = `${x + 1} / span ${width}`;
      key.style.gridRow = `${y} / span ${height}`;
      keys.append(key);
    }
    board.replaceChildren(keys);
    board.scrollLeft = left;
    extraKeys.replaceChildren(...INTERNATIONAL_KEYS.map((code) => renderKey(code)));
  }

  function renderKey(code, fixed = false) {
    const id = fixed ? undefined : occupant(code, layer);
    const actionName = fixed ? FIXED_KEYS.find(([key]) => key === code)?.[1] : KEY_ACTIONS[id]?.label;
    const editable = !layer && !fixed;
    const key = editable ? button("", () => {
      if (selected && selected !== id) assign(selected, { code, modifiers: 0 });
      else if (id) choose(id);
    }) : document.createElement("span");
    key.className = "key" + (id ? " bound" : fixed ? " fixed-key" : "");
    key.dataset.code = code;
    const name = fixed ? keyLabel(code) : bindingLabel({ code, modifiers: layer }, layout);
    const description = actionName ? name + " · " + actionName : name;
    key.setAttribute("aria-label", description + (fixed ? " · fixed" : ""));
    key.title = description + (fixed ? " · fixed" : "");
    const glyph = document.createElement("kbd");
    glyph.textContent = keyLabel(code, fixed ? undefined : layout);
    key.append(glyph);
    if (actionName) {
      const label = document.createElement("small");
      label.textContent = actionName;
      key.append(label);
    }
    if (editable) {
      if (id) {
        dragSource(key, id);
        if (id === selected) key.setAttribute("aria-pressed", "true");
      }
      dropTarget(key, (source) => assign(source, { code, modifiers: 0 }));
    }
    return key;
  }

  function renderSidebar() {
    const query = filter.value.trim().toLowerCase();
    const actions = Object.values(KEY_ACTIONS).filter(({ id, label, group, base }) =>
      !base && (showAll.checked || !bindings[id]) && (label + " " + group).toLowerCase().includes(query));
    const groups = new Map();
    for (const action of actions) {
      if (!groups.has(action.group)) groups.set(action.group, []);
      groups.get(action.group).push(action);
    }
    const rows = [];
    for (const [group, members] of groups) {
      const heading = document.createElement("div");
      heading.className = "action-group";
      heading.textContent = group;
      rows.push(heading);
      for (const { id, label } of members) {
        const action = button(label, () => choose(id));
        action.setAttribute("aria-pressed", String(id === selected));
        if (bindings[id]) {
          const shortcut = document.createElement("small");
          shortcut.textContent = bindingLabel(bindings[id], layout);
          action.append(shortcut);
        }
        dragSource(action, id);
        rows.push(action);
      }
    }
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.textContent = "No matching actions.";
      rows.push(empty);
    }
    sidebar.replaceChildren(...rows);
  }

  function render() {
    renderLayout();
    renderSidebar();
    paintSelection();
  }

  function paintSelection() {
    selection.replaceChildren();
    if (!selected) return;
    const name = document.createElement("span");
    name.textContent = KEY_ACTIONS[selected].label + " · " + bindingLabel(bindings[selected], layout);
    selection.append(name);
    if (!capturing) selection.append(button("Press a key", () => choose(selected, true)));
    if (bindings[selected]) selection.append(button("Unassign", () => assign(selected, null)));
    selection.append(button(capturing ? "Cancel capture" : "Clear selection", () => {
      selected = undefined;
      capturing = false;
      feedback.textContent = "";
      render();
    }));
  }

  const notifyClosing = connectKeyboardEditor();
  const close = () => {
    notifyClosing();
    void OBR.modal.close(KEYBOARD_MODAL).catch(console.error);
  };
  const closeButton = document.querySelector("#close");
  closeButton.addEventListener("click", close);
  closeButton.focus({ preventScroll: true });
  document.querySelector("#reset").addEventListener("click", () => {
    selected = undefined;
    capturing = false;
    layer = 0;
    save({}, "Default bindings restored.");
  });
  showAll.addEventListener("change", renderSidebar);
  filter.addEventListener("input", renderSidebar);
  dropTarget(document.querySelector("#sidebar"), (id) => assign(id, null));

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const toggle = isFixedKeyboardShortcut(event) ||
      !capturing && !editableTarget(event.target) && actionForEvent(bindings, event)?.id === "keyboard";
    if (toggle || !capturing && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) close();
      return;
    }
    if (!capturing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    const next = eventChord(event);
    if (!next) {
      if (/^F\d+$/.test(event.code || event.key)) feedback.textContent = "Function keys are fixed. Press another key.";
      return;
    }
    if (next.modifiers !== 0) {
      feedback.textContent = "Modifier shortcuts follow their base key. Press a key without modifiers.";
      return;
    }
    if (event.key?.length > 0 && event.key.length < 8 && !["Dead", "Unidentified"].includes(event.key)) {
      layout = { ...layout, [next.code]: event.key === " " ? "Space" : event.key };
    }
    assign(selected, next);
  }, true);
  render();
  void browserLayout().then((map) => {
    const detected = { ...map, ...layout };
    if (Object.keys(map).every((code) => layout[code] === detected[code])) return;
    layout = detected;
    save(overrides);
  });
});
