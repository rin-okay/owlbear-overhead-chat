export const FLOAT_LINE = 18;
const FLOAT_LIMIT = 6 * FLOAT_LINE;
const GAP = 3;

// Newer bubbles stay nearer their origin. Move older bubbles above anything
// in their path, including bubbles from nearby tokens.
export function placeFloatingBubbles(bubbles, rise = 0) {
  const placed = [];
  for (const bubble of bubbles) {
    const scale = bubble.scale ?? 1;
    const minY = bubble.originY - FLOAT_LIMIT * scale + 1e-6;
    let y = bubble.y - rise * scale;
    while (y > minY) {
      const blocker = placed.find((other) => {
        const gap = GAP * Math.max(scale, other.scale ?? 1);
        return Math.abs(bubble.x - other.x) < (bubble.width + other.width) / 2 + gap &&
          y > other.y - other.height - gap && other.y > y - bubble.height - gap;
      });
      if (!blocker) break;
      y = blocker.y - blocker.height - GAP * Math.max(scale, blocker.scale ?? 1);
    }
    if (y > minY) placed.push({ ...bubble, y });
  }
  return placed;
}
