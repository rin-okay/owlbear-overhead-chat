import { buildPath, Command } from "./obr.js";

const report = (error) => console.warn("Overhead Chat target selection", error);
const validPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);

export function setupTargeting(obr, onChange) {
  let current;
  let markerWork = Promise.resolve();

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

  function clear() {
    const state = current;
    if (!state) return;
    current = undefined;
    onChange();
    draw(state);
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

  async function confirm() {
    const state = current;
    if (!state?.editing || state.consuming) return;
    await state.work;
    if (current !== state || !state.editing || state.consuming || !state.point) return;
    state.editing = false;
    onChange();
  }

  async function consumeLocation() {
    const state = current;
    if (!state?.editing || state.consuming) return;
    state.consuming = true;
    await state.work;
    if (current !== state || !state.editing) return;
    const point = state.point;
    clear();
    return point;
  }

  function toggle(tokenId) {
    if (current) {
      clear();
      return;
    }
    const state = { editing: true, work: Promise.resolve() };
    current = state;
    onChange();
    void enqueue(state, async () => {
      try {
        const [dpi, bounds] = await Promise.all([
          obr.scene.grid.getDpi(), obr.scene.items.getItemBounds([tokenId]),
        ]);
        if (current !== state) return;
        if (!Number.isFinite(dpi) || dpi <= 0 || !validPoint(bounds?.center)) {
          throw Error("The scene grid or avatar is unavailable.");
        }
        state.dpi = dpi;
        await setPoint(state, bounds.center);
      } catch (error) {
        report(error);
        if (current === state) clear();
      }
    });
  }

  obr.scene.onReadyChange((ready) => { if (!ready) clear(); });
  window.addEventListener("pagehide", clear, { once: true });

  return {
    toggle, clear, confirm, consumeLocation,
    editing: () => Boolean(current?.editing),
    location: () => current && !current.editing ? current.point : undefined,
    move(offset) {
      const state = current;
      if (!state?.editing || state.consuming) return;
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
