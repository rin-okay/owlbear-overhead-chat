export const FLOAT_LINE = 18;
const FLOAT_LIMIT = 6 * FLOAT_LINE;
const GAP = 3;

// Newer bubbles stay nearer their origin. Move older bubbles above anything
// in their path, including bubbles from nearby tokens.
export function placeFloatingBubbles(bubbles, rise = 0) {
  const placed = [];
  for (const bubble of bubbles) {
    let y = bubble.y - rise;
    while (bubble.originY - y < FLOAT_LIMIT) {
      const blocker = placed.find((other) =>
        Math.abs(bubble.x - other.x) < (bubble.width + other.width) / 2 + GAP &&
        y > other.y - other.height - GAP && other.y > y - bubble.height - GAP);
      if (!blocker) break;
      y = blocker.y - blocker.height - GAP;
    }
    if (bubble.originY - y < FLOAT_LIMIT) placed.push({ ...bubble, y });
  }
  return placed;
}
