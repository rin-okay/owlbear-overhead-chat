import { parseDice, randomFace, scoreDice } from "./dice.js";
import { MAX_DICE_SHOWN } from "./dice-replay.js";

const physicalSides = new Set([4, 6, 8, 10, 12, 20]);
const workerUrl = new URL("./dice-worker.js", import.meta.url);

function simulateDice(sides) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { type: "module" });
    const finish = (callback, value) => {
      clearTimeout(timeout);
      worker.terminate();
      callback(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error("Dice physics timed out.")), 5500);
    worker.onmessage = ({ data }) => {
      if (data.error) finish(reject, new Error(data.error));
      else finish(resolve, data);
    };
    worker.onerror = (event) => finish(reject, new Error(event.message));
    worker.postMessage(sides);
  });
}

export async function rollWithNativeDice(spans) {
  const expressions = spans.map(({ notation }) => parseDice(notation));
  const dice = [];
  const shown = [];
  let count = 0;
  for (const { sides, count: amount } of expressions.flat()) {
    if (!amount) continue;
    const slots = sides === 100 ? 2 : 1;
    if (count === dice.length) {
      for (let index = 0; index < amount && dice.length + slots <= MAX_DICE_SHOWN; index++) {
        const faces = slots === 2
          ? ["tens", "ones"].map((percentile) => ({ sides: 10, percentile, physical: true }))
          : [{ sides, physical: physicalSides.has(sides) }];
        dice.push(...faces);
        shown.push(faces);
      }
    }
    count += amount * slots;
  }

  const physical = dice.filter((die) => die.physical);
  let simulation;
  if (physical.length) {
    try {
      const sizes = physical.map((die) => die.percentile === "tens" ? "10tens" : die.sides);
      try {
        simulation = await simulateDice(sizes);
      } catch {
        const { simulate } = await import("./dice-physics.js");
        simulation = await simulate(sizes);
      }
      physical.forEach((die, index) => { die.value = simulation.values[index]; });
    } catch (error) {
      console.warn("Overhead Chat dice physics unavailable", error);
      physical.forEach((die) => { die.physical = false; });
    }
  }

  let index = 0;
  const rolls = expressions.map((terms) => scoreDice(terms, (sides) => {
    const faces = shown[index++];
    if (!faces) return randomFace(sides);
    for (const die of faces) die.value ??= randomFace(die.sides);
    if (faces.length === 1) return faces[0];
    const [tens, ones] = faces;
    return {
      value: (tens.value % 10 * 10 + ones.value % 10) || 100,
      set kept(keep) { tens.kept = ones.kept = keep; },
    };
  }));
  return { rolls, tray: { dice, count, replay: simulation?.replay, duration: simulation?.duration } };
}
