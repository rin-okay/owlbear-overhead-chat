import OBR from "./obr.js";
import {
  KEY_ACTIONS, KEYBOARD_ROWS, FIXED_KEYS, MODIFIERS, assignBinding, bindingLabel, browserLayout, eventChord,
  keyLabel, readKeyboard, resolveBindings, writeKeyboard,
} from "./key-bindings.js?v=2.11.2";
import { KEYBOARD_MODAL } from "./keyboard-shortcuts.js?v=2.11.3";

OBR.onReady(() => {
  const board = document.querySelector("#board");
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
    const rows = KEYBOARD_ROWS.map((row) => {
      const line = document.createElement("div");
      line.className = "key-row";
      for (const code of row) {
        const id = occupant(code, layer);
        const action = KEY_ACTIONS[id];
        const key = layer ? document.createElement("span") : button("", () => {
          if (selected && selected !== id) assign(selected, { code, modifiers: 0 });
          else if (id) choose(id);
        });
        key.className = "key" + (id ? " bound" : "");
        key.dataset.code = code;
        const description = bindingLabel({ code, modifiers: layer }, layout) + (action ? " · " + action.label : "");
        key.setAttribute("aria-label", description);
        key.title = description;
        const glyph = document.createElement("kbd");
        glyph.textContent = keyLabel(code, layout);
        key.append(glyph);
        if (action) {
          const name = document.createElement("small");
          name.textContent = action.label;
          key.append(name);
          if (!layer) {
            dragSource(key, id);
            if (id === selected) key.setAttribute("aria-pressed", "true");
          }
        }
        if (!layer) dropTarget(key, (source) => assign(source, { code, modifiers: 0 }));
        line.append(key);
      }
      return line;
    });
    board.replaceChildren(...rows);
    board.scrollLeft = left;
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

  const close = () => void OBR.modal.close(KEYBOARD_MODAL).catch(console.error);
  document.querySelector("#close").addEventListener("click", close);
  document.querySelector("#reset").addEventListener("click", () => {
    selected = undefined;
    capturing = false;
    layer = 0;
    save({}, "Default bindings restored.");
  });
  document.querySelector("#fixed").replaceChildren(...FIXED_KEYS.map(([key, label]) => {
    const node = document.createElement("span");
    node.textContent = key + " · " + label;
    return node;
  }));
  showAll.addEventListener("change", renderSidebar);
  filter.addEventListener("input", renderSidebar);
  dropTarget(document.querySelector("#sidebar"), (id) => assign(id, null));

  document.addEventListener("keydown", (event) => {
    if (!capturing) {
      if (!event.defaultPrevented && event.key === "Escape") close();
      return;
    }
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
