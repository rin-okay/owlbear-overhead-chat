const SMOKE = "com.battle-system.smoke/";
const EPSILON = 1e-7;
const validPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;

function project(point, item, unit = 1) {
  const x = point.x * (item.scale?.x ?? 1) * unit;
  const y = point.y * (item.scale?.y ?? 1) * unit;
  const angle = (item.rotation ?? 0) * Math.PI / 180;
  return {
    x: item.position.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: item.position.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

export function isProjectileWall(item) {
  const meta = item.metadata ?? {};
  // Smoke generates local WALL copies of its scene curves. Read the curves
  // for current door state and audience, and avoid counting the copies.
  if (item.type === "WALL") {
    return item.visible !== false && item.blocking === true && !meta[SMOKE + "isVisionWall"];
  }
  const viewers = meta[SMOKE + "wallViewers"];
  return (item.type === "CURVE" || item.type === "LINE") &&
    meta[SMOKE + "isVisionLine"] === true && !meta[SMOKE + "disabled"] && !meta[SMOKE + "doorOpen"] &&
    (!meta[SMOKE + "isWindow"] || meta[SMOKE + "blocking"] === true) &&
    !Array.isArray(viewers);
}

export function isProjectileToken(item) {
  return item.type === "IMAGE" && item.layer === "CHARACTER" && item.visible === true &&
    !item.metadata?.[SMOKE + "hiddenToken"] && !item.metadata?.["com.battle-system.spectre/isSpectre"];
}

function wallDistance(origin, direction, a, b) {
  const offset = subtract(a, origin);
  const segment = subtract(b, a);
  if (Math.hypot(segment.x, segment.y) <= EPSILON) return Infinity;
  const denominator = cross(direction, segment);
  if (Math.abs(denominator) < EPSILON) {
    if (Math.abs(cross(offset, direction)) >= EPSILON) return Infinity;
    const start = dot(offset, direction);
    const end = dot(subtract(b, origin), direction);
    if (Math.max(start, end) <= EPSILON) return Infinity;
    return Math.max(0, Math.min(start, end));
  }
  const alongWall = cross(offset, direction) / denominator;
  if (alongWall < -EPSILON || alongWall > 1 + EPSILON) return Infinity;
  const distance = cross(offset, segment) / denominator;
  return distance > EPSILON ? distance : Infinity;
}

function tokenCircle(token, dpi) {
  if (!validPoint(token.position)) return;
  const { width, height } = token.image ?? {};
  const { dpi: imageDpi, offset } = token.grid ?? {};
  if (![width, height, imageDpi].every((value) => Number.isFinite(value) && value > 0)) {
    return { center: token.position, radius: dpi / 2 };
  }
  const unit = dpi / imageDpi;
  const center = project({
    x: width / 2 - (offset?.x ?? width / 2), y: height / 2 - (offset?.y ?? height / 2),
  }, token, unit);
  const radius = unit * Math.min(width * Math.abs(token.scale?.x ?? 1), height * Math.abs(token.scale?.y ?? 1)) / 2;
  if (validPoint(center) && Number.isFinite(radius) && radius > 0) return { center, radius };
}

function circleDistance(origin, direction, circle) {
  const offset = subtract(circle.center, origin);
  const ahead = dot(offset, direction);
  const perpendicular = cross(offset, direction);
  const gap = circle.radius ** 2 - perpendicular ** 2;
  if (gap < 0) return Infinity;
  const halfChord = Math.sqrt(gap);
  if (ahead + halfChord <= EPSILON) return Infinity;
  return Math.max(0, ahead - halfChord);
}

export function clipProjectile(source, destination, items, casterId, dpi) {
  const delta = subtract(destination, source);
  const range = Math.hypot(delta.x, delta.y);
  if (!Number.isFinite(range) || range <= EPSILON) return destination;
  const direction = { x: delta.x / range, y: delta.y / range };
  let distance = range;
  for (const item of items) {
    if (item.id !== casterId && isProjectileToken(item)) {
      const circle = tokenCircle(item, dpi);
      if (circle) distance = Math.min(distance, circleDistance(source, direction, circle));
    } else if (isProjectileWall(item) && validPoint(item.position)) {
      const points = item.type === "LINE" ? [item.startPosition, item.endPosition] : item.points;
      if (!Array.isArray(points) || points.length < 2) continue;
      const world = points.map((point) => validPoint(point) ? project(point, item) : undefined);
      if (item.style?.closed) world.push(world[0]);
      for (let i = 1; i < world.length; i++) {
        if (!validPoint(world[i - 1]) || !validPoint(world[i])) continue;
        distance = Math.min(distance, wallDistance(source, direction, world[i - 1], world[i]));
      }
    }
  }
  if (distance === range) return destination;
  // Embers scales its video from the travel distance and needs a nonzero endpoint.
  const end = Math.max(distance, Math.min(range, dpi / 100));
  return { x: source.x + direction.x * end, y: source.y + direction.y * end };
}
