import { encodeReplay } from "./dice-replay.js";

// Dicesuki's solo room runs its Rapier engine inside this worker.
const CORE_URL = "https://cdn.jsdelivr.net/gh/donovan-yohan/dicesuki@8fae459b1b31a112d918ec3897e66c5f67b5e409/src/generated/wasm-room/dicesuki_wasm.js";
const TICK_MS = 1000 / 60;

async function simulate(sides) {
  const { default: init, WasmRoom } = await import(CORE_URL);
  await init();
  const room = new WasmRoom("overhead-chat", 11, 6);
  const handle = (message) => room.handleMessage(JSON.stringify(message)).map(JSON.parse);
  const dice = sides.map((size, index) => ({ id: String(index), diceType: `d${size}` }));
  try {
    handle({ type: "join", roomId: "overhead-chat", displayName: "Overhead Chat", color: "#b9a4fc" });
    const spawn = handle({ type: "spawn_dice", dice }).find(({ type }) => type === "dice_spawned");
    const poses = [];
    for (const { id, position, rotation } of spawn.dice) poses[Number(id)] = [...position, ...rotation];
    const frames = [poses.slice()];
    handle({ type: "roll" });

    for (let tick = 1; tick <= 420; tick++) {
      let result;
      for (const event of room.tick(TICK_MS).map(JSON.parse)) {
        if (event.type === "physics_snapshot") {
          for (const { id, p, r } of event.dice) poses[Number(id)] = [...p, ...r];
        } else if (event.type === "die_settled") {
          poses[Number(event.diceId)] = [...event.position, ...event.rotation];
        } else if (event.type === "roll_complete") {
          result = event;
        }
      }
      if (result || tick % 3 === 0) frames.push(poses.slice());
      if (!result) continue;

      const values = new Array(sides.length);
      for (const { diceId, faceValue } of result.results) {
        const index = Number(diceId);
        values[index] = sides[index] === 10 && faceValue === 0 ? 10 : faceValue;
      }
      if (Array.from(values).some((value, index) =>
        !Number.isInteger(value) || value < 1 || value > sides[index])) break;
      return { values, replay: encodeReplay(frames, sides.length), duration: tick * TICK_MS };
    }
    throw new Error("The dice did not settle.");
  } finally {
    room.free();
  }
}

self.onmessage = async ({ data }) => {
  try {
    self.postMessage(await simulate(data));
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
