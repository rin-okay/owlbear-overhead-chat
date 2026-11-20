export const MAX_DICE_SHOWN = 8;
const MAX_FRAMES = 40;
const COMPONENTS = 7;
const SCALE = 2048;
const BYTES = COMPONENTS * 2;

export function encodeReplay(frames, diceCount) {
  const count = Math.min(frames.length, MAX_FRAMES);
  const bytes = new Uint8Array(count * diceCount * BYTES);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const frame = frames[Math.round(index * (frames.length - 1) / (count - 1 || 1))];
    for (const components of frame) {
      for (const value of components) {
        view.setInt16(offset, Math.round(Math.max(-15, Math.min(15, value)) * SCALE));
        offset += 2;
      }
    }
  }
  return btoa(String.fromCharCode(...bytes));
}

export function decodeReplay(replay, diceCount) {
  if (!Number.isInteger(diceCount) || diceCount < 1 || diceCount > MAX_DICE_SHOWN ||
      typeof replay !== "string" || replay.length > Math.ceil(MAX_FRAMES * diceCount * BYTES / 3) * 4) return [];
  let bytes;
  try {
    bytes = Uint8Array.from(atob(replay), (character) => character.charCodeAt(0));
  } catch {
    return [];
  }
  const stride = diceCount * BYTES;
  if (bytes.length % stride || bytes.length < 2 * stride || bytes.length > MAX_FRAMES * stride) return [];
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / stride }, (_, frame) =>
    Array.from({ length: diceCount }, (_, die) =>
      Array.from({ length: COMPONENTS }, (_, component) =>
        view.getInt16(frame * stride + die * BYTES + component * 2) / SCALE)));
}

export function parseTray(tray) {
  const { dice, replay, duration, count } = tray ?? {};
  if (!Array.isArray(dice) || !dice.length || dice.length > MAX_DICE_SHOWN ||
      !Number.isInteger(count) || count < dice.length || count > 400 ||
      !dice.every((die) => {
        const { sides, value, kept, physical } = die ?? {};
        return Number.isInteger(sides) && sides >= 2 && sides <= 1000 &&
          Number.isInteger(value) && value > 0 && value <= sides &&
          typeof kept === "boolean" && typeof physical === "boolean";
      })) return;
  const physicalCount = dice.filter((die) => die.physical).length;
  const frames = decodeReplay(replay, physicalCount);
  return {
    dice, count, frames,
    duration: Math.max(600, Math.min(3600, Number.isFinite(duration) ? duration : 0)),
  };
}
