import { buildPath, Command } from "./obr.js";

const report = (error) => console.warn("Overhead Chat target selection", error);
const validPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);

function forwardPoint(center, dpi, heading, square) {
  const angle = (square ? Math.round(heading / 45) * 45 : heading) * Math.PI / 180;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  return { x: center.x + dpi * (square ? Math.round(x) : x), y: center.y + dpi * (square ? Math.round(y) : y) };
}

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

  function start(tokenId, heading) {
    if (current) return;
    const state = { editing: true, work: Promise.resolve() };
    current = state;
    onChange();
    void enqueue(state, async () => {
      try {
        const ahead = Number.isFinite(heading);
        const [dpi, bounds, gridType] = await Promise.all([
          obr.scene.grid.getDpi(), obr.scene.items.getItemBounds([tokenId]),
          ahead ? obr.scene.grid.getType() : undefined,
        ]);
        if (current !== state) return;
        if (!Number.isFinite(dpi) || dpi <= 0 || !validPoint(bounds?.center)) {
          throw Error("The scene grid or avatar is unavailable.");
        }
        state.dpi = dpi;
        if (!ahead) {
          await setPoint(state, bounds.center);
          return;
        }
        const center = await obr.scene.grid.snapPosition(bounds.center, 1, false, true);
        if (current !== state) return;
        if (!validPoint(center)) throw Error("Couldn’t find the avatar’s grid tile.");
        await setPoint(state, forwardPoint(center, dpi, heading, gridType === "SQUARE"));
      } catch (error) {
        report(error);
        if (current === state) clear();
      }
    });
  }

  function toggle(tokenId) {
    if (current) clear();
    else start(tokenId);
  }

  obr.scene.onReadyChange((ready) => { if (!ready) clear(); });
  window.addEventListener("pagehide", clear, { once: true });

  return {
    start, toggle, clear, confirm, consumeLocation,
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
