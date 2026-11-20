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
  let count = 0;
  for (const { sides, count: amount } of expressions.flat()) {
    if (!amount) continue;
    for (let index = 0; index < amount && dice.length < MAX_DICE_SHOWN; index++) {
      dice.push({ sides, physical: physicalSides.has(sides) });
    }
    count += amount;
  }

  const physical = dice.filter((die) => die.physical);
  let simulation;
  if (physical.length) {
    try {
      const sizes = physical.map((die) => die.sides);
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
    const die = dice[index++];
    if (!die) return randomFace(sides);
    die.value ??= randomFace(sides);
    return die;
  }));
  return { rolls, tray: { dice, count, replay: simulation?.replay, duration: simulation?.duration } };
}
