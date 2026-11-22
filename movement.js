function advanceOnGrid(value, delta, interval, origin = 0) {
  const units = (value - origin) / interval;
  const rounded = Math.round(units);
  if (Math.abs(units - rounded) < 1e-7) return origin + rounded * interval + delta;
  const next = delta > 0 ? Math.ceil(units) : Math.floor(units);
  return origin + next * interval;
}

export function turnAvatar(rotation, delta) {
  const next = advanceOnGrid(rotation, delta, 15);
  return ((next % 360) + 360) % 360;
}

export function stepAvatar(position, offset, grid) {
  const [x, y] = offset;
  const { dpi, origin } = grid;
  const step = (axis, amount) => {
    const value = position[axis];
    if (!amount) return value;
    const delta = amount * dpi;
    if (!origin || Math.abs(amount) !== 1) return value + delta;
    const next = advanceOnGrid(value, delta, dpi, origin[axis]);
    return Math.abs(next - value) < dpi / 8 ? next + delta : next;
  };
  return { x: step("x", x), y: step("y", y) };
}

export async function readMovementGrid(grid) {
  const [dpi, type, center] = await Promise.all([
    grid.getDpi(), grid.getType(), grid.snapPosition({ x: 0, y: 0 }, 1, false, true).catch(() => null),
  ]);
  const origin = type === "SQUARE" && Number.isFinite(center?.x) && Number.isFinite(center?.y) ? center : undefined;
  return { dpi, origin };
}
