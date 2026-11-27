import { buildPath, Command } from "./obr.js";
import { fetchSpellTargets, nextTarget, reachableTargets, targetGeometry } from "./target-cycle.js?v=3.1.0";

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
    place(state, snapped);
  }

  function place(state, point) {
    state.point = point;
    state.feedback = undefined;
    draw(state, point);
    onChange();
  }

  function cycle(direction) {
    const state = current;
    if (!state?.editing || state.consuming) return;
    const cast = state.pendingCast;
    void enqueue(state, async () => {
      if (!state.point || state.pendingCast !== cast) return;
      try {
        const [geometry, allowed] = await Promise.all([
          targetGeometry(obr, state.tokenId),
          cast ? fetchSpellTargets(obr, state.tokenId, cast) : undefined,
        ]);
        if (current !== state || !state.editing || state.pendingCast !== cast) return;
        const candidates = reachableTargets(geometry, state.tokenId)
          .filter(({ id }) => !allowed || allowed.has(id));
        const origin = state.cycleOrigin ?? state.point;
        const target = nextTarget(candidates, origin, state.snappedTarget, direction);
        if (!target) {
          state.feedback = "no reachable targets";
          onChange();
          return;
        }
        state.cycleOrigin = origin;
        state.snappedTarget = target.id;
        place(state, target.center);
      } catch (error) {
        if (current !== state || !state.editing || state.pendingCast !== cast) return;
        state.feedback = error.message || "couldn’t check reachable targets";
        onChange();
      }
    });
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

  function start(tokenId, heading, pendingCast) {
    if (current) return;
    const state = { tokenId, editing: true, pendingCast, work: Promise.resolve() };
    current = state;
    onChange();
    void enqueue(state, async () => {
      try {
        const direction = typeof heading === "function" ? await heading() : heading;
        if (current !== state) return;
        const ahead = Number.isFinite(direction);
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
        await setPoint(state, forwardPoint(center, dpi, direction, gridType === "SQUARE"));
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

  function aim(tokenId, heading, pendingCast) {
    if (current && !current.consuming) {
      current.pendingCast = pendingCast;
      current.feedback = undefined;
      current.cycleOrigin = undefined;
      current.snappedTarget = undefined;
      current.editing = true;
      onChange();
      return;
    }
    clear();
    start(tokenId, heading, pendingCast);
  }

  obr.scene.onReadyChange((ready) => { if (!ready) clear(); });
  window.addEventListener("pagehide", clear, { once: true });

  return {
    start, aim, toggle, clear, confirm, consumeLocation, cycle,
    feedback: () => current?.feedback,
    editing: () => Boolean(current?.editing),
    pendingCast: () => current?.pendingCast,
    location: () => current && !current.editing ? current.point : undefined,
    move(offset) {
      const state = current;
      if (!state?.editing || state.consuming) return;
      void enqueue(state, async () => {
        if (!state.point) return;
        const point = {
          x: state.point.x + offset[0] * state.dpi,
          y: state.point.y + offset[1] * state.dpi,
        };
        if (state.snappedTarget) place(state, point);
        else await setPoint(state, point);
      });
    },
  };
}
