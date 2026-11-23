import { buildPath, Command } from "./obr.js";

const TOOL = "chat.overhead.target";
const MODE = "chat.overhead.target.pick";
const ICON = new URL("./target.svg", import.meta.url).href;
const report = (error) => console.warn("Overhead Chat target selection", error);
const validPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);

export function setupTargeting(obr, { onChange, onKey, onConfirm }) {
  let current;
  let activeState;
  let registration;
  let markerWork = Promise.resolve();
  let toolWork = Promise.resolve();

  function draw(state, position) {
    markerWork = markerWork.catch(report).then(async () => {
      if (!position) {
        if (state.marker) await obr.scene.local.deleteItems([state.marker]);
        return;
      }
      if (current !== state) return;
      if (state.marker) {
        await obr.scene.local.updateItems([state.marker], ([item]) => {
          if (item) item.position = position;
        });
        return;
      }
      const arm = state.dpi * 0.28;
      const gap = arm / 3;
      const marker = buildPath().name("Spell target").layer("POINTER").position(position)
        .disableHit(true).locked(true).fillOpacity(0).strokeColor("#ecbaff").strokeWidth(state.dpi * 0.038)
        .commands([
          [Command.MOVE, -arm, 0], [Command.LINE, -gap, 0],
          [Command.MOVE, gap, 0], [Command.LINE, arm, 0],
          [Command.MOVE, 0, -arm], [Command.LINE, 0, -gap],
          [Command.MOVE, 0, gap], [Command.LINE, 0, arm],
        ]).build();
      await obr.scene.local.addItems([marker]);
      state.marker = marker.id;
    }).catch(report);
  }

  function restoreTool(state) {
    toolWork = toolWork.then(() => state.work).then(async () => {
      if (!state.previous || await obr.tool.getActiveToolMode() !== MODE) return;
      await obr.tool.activateMode(...state.previous);
    }).catch(report);
    return toolWork;
  }

  function clear(refocus = false) {
    const state = current;
    if (!state) return;
    current = undefined;
    onChange();
    draw(state);
    if (state.editing) {
      void restoreTool(state).then(() => {
        if (refocus && !current) onConfirm();
      });
    }
  }

  function enqueue(state, task) {
    state.work = state.work.then(async () => {
      if (current !== state || !state.editing) return;
      await task();
    }).catch(report);
    return state.work;
  }

  async function setPoint(state, point) {
    const snapped = await obr.scene.grid.snapPosition(point, 1, false, true);
    if (current !== state || !state.editing || !validPoint(snapped)) return;
    state.point = snapped;
    draw(state, snapped);
  }

  async function confirm(restore = true) {
    const state = current;
    if (!state?.editing) return;
    await state.work;
    if (current !== state || !state.editing) return;
    if (!state.point) {
      clear();
      return;
    }
    state.editing = false;
    onChange();
    if (restore) {
      await restoreTool(state);
      if (current === state) onConfirm();
    }
  }

  function register() {
    if (!registration) {
      registration = (async () => {
        await obr.tool.createMode({
          id: MODE,
          icons: [{ icon: ICON, label: "Pick a spell target", filter: { activeTools: [TOOL] } }],
          cursors: [{ cursor: "crosshair" }],
          onToolClick(_, { pointerPosition }) {
            const state = current;
            if (!state?.editing || state !== activeState || !validPoint(pointerPosition)) return false;
            void enqueue(state, () => setPoint(state, pointerPosition)).then(() => {
              if (current === state) return confirm();
            });
            return false;
          },
          onToolDoubleClick: () => false,
          onKeyDown: (_, event) => { if (activeState === current) onKey(event); },
          onDeactivate() {
            const state = activeState;
            activeState = undefined;
            if (state && current === state) void confirm(false);
          },
        });
        await obr.tool.create({
          id: TOOL, defaultMode: MODE,
          icons: [{ icon: ICON, label: "Spell targeting (Z in move mode)" }],
          onClick() { onKey({ key: "z" }); return false; },
        });
      })().catch((error) => {
        registration = undefined;
        throw error;
      });
    }
    return registration;
  }

  function toggle(tokenId) {
    if (current) {
      clear(true);
      return;
    }
    const previousToolWork = toolWork;
    const state = { editing: true, work: Promise.resolve() };
    current = state;
    onChange();
    void enqueue(state, async () => {
      try {
        await previousToolWork;
        if (current !== state) return;
        const [tool, mode, dpi, bounds] = await Promise.all([
          obr.tool.getActiveTool(), obr.tool.getActiveToolMode(),
          obr.scene.grid.getDpi(), obr.scene.items.getItemBounds([tokenId]), register(),
        ]);
        if (current !== state) return;
        if (!tool || !mode || !Number.isFinite(dpi) || dpi <= 0 || !validPoint(bounds?.center)) {
          throw Error("The active tool, scene grid, or avatar is unavailable.");
        }
        state.previous = [tool, mode];
        state.dpi = dpi;
        await setPoint(state, bounds.center);
        if (current !== state) return;
        activeState = state;
        await obr.tool.activateMode(TOOL, MODE);
      } catch (error) {
        report(error);
        if (current === state) clear();
      }
    });
  }

  obr.scene.onReadyChange((ready) => { if (!ready) clear(); });
  obr.scene.grid.onChange(() => clear());
  window.addEventListener("pagehide", () => clear(), { once: true });

  return {
    toggle, clear, confirm,
    editing: () => Boolean(current?.editing),
    location: () => current?.point,
    move(offset) {
      const state = current;
      if (!state?.editing) return;
      void enqueue(state, async () => {
        if (!state.point) return;
        await setPoint(state, {
          x: state.point.x + offset[0] * state.dpi,
          y: state.point.y + offset[1] * state.dpi,
        });
      });
    },
  };
}
