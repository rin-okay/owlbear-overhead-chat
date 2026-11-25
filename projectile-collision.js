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

function isClosedSmokeDoor(item) {
  return item?.type === "CURVE" && isProjectileWall(item) &&
    item.metadata[SMOKE + "isDoor"] === true && !item.metadata[SMOKE + "isDoorLocked"] &&
    !item.metadata[SMOKE + "isWindow"];
}

export async function openMeleeDoor(obr, id, role, current) {
  const allowed = role === "GM" || (role === "PLAYER" &&
    (await obr.scene.getMetadata())[SMOKE + "playerDoors"] === true);
  if (!allowed || !current()) return;
  await obr.scene.items.updateItems([id], (items) => {
    if (!current()) return;
    for (const door of items) {
      if (!isClosedSmokeDoor(door)) continue;
      door.metadata[SMOKE + "disabled"] = true;
      door.metadata[SMOKE + "doorOpen"] = true;
    }
  });
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

export function projectileTokenContainsPoint(token, point, dpi) {
  const circle = tokenCircle(token, dpi);
  return Boolean(circle && Math.hypot(point.x - circle.center.x, point.y - circle.center.y) <= circle.radius + EPSILON);
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

function collectWalls(items) {
  const walls = [];
  for (const item of items) {
    if (!isProjectileWall(item) || !validPoint(item.position)) continue;
    const points = item.type === "LINE" ? [item.startPosition, item.endPosition] : item.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    const world = points.map((point) => validPoint(point) ? project(point, item) : undefined);
    if (item.style?.closed) world.push(world[0]);
    for (let i = 1; i < world.length; i++) {
      if (validPoint(world[i - 1]) && validPoint(world[i])) walls.push({ a: world[i - 1], b: world[i], item });
    }
  }
  return walls;
}

function closestWall(source, direction, walls) {
  let distance = Infinity;
  let blocker;
  for (const { a, b, item } of walls) {
    const hit = wallDistance(source, direction, a, b);
    if (hit < distance - EPSILON) {
      distance = hit;
      blocker = item;
    } else if (Math.abs(hit - distance) <= EPSILON) {
      // A door sharing the impact point with another wall must not open.
      distance = Math.min(distance, hit);
      if (blocker !== item) blocker = undefined;
    }
  }
  return { distance, blocker };
}

const advance = (point, direction, distance) => ({
  x: point.x + direction.x * distance,
  y: point.y + direction.y * distance,
});

function hasClearPath(source, target, walls) {
  const delta = subtract(target, source);
  const range = Math.hypot(delta.x, delta.y);
  if (range <= EPSILON) return true;
  const direction = { x: delta.x / range, y: delta.y / range };
  return closestWall(source, direction, walls).distance > range + EPSILON;
}

export function clearSpellPath(source, target, items) {
  return hasClearPath(source, target, collectWalls(items));
}

function blastHits(source, coverOrigin, radius, targets, walls) {
  return targets.filter((target) => {
    const offset = subtract(target.center, source);
    return Math.hypot(offset.x, offset.y) <= radius + target.radius &&
      hasClearPath(coverOrigin, target.center, walls);
  }).map(({ id }) => id);
}

export function areaHits(source, radius, items, dpi) {
  const targets = [];
  for (const item of items) {
    if (!isProjectileToken(item)) continue;
    const circle = tokenCircle(item, dpi);
    if (circle) targets.push({ id: item.id, ...circle });
  }
  return blastHits(source, source, radius, targets, collectWalls(items));
}

export function teleportLandingClear(source, destination, caster, items, dpi) {
  const { radius } = tokenCircle(caster, dpi) ?? { radius: dpi / 2 };
  const walls = collectWalls(items);
  return hasClearPath(source, destination, walls) &&
    !walls.some(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y) > EPSILON &&
      distanceToSegment(destination, a, b) < radius - EPSILON);
}

function distanceToSegment(point, start, end) {
  const edge = subtract(end, start);
  const fraction = Math.max(0, Math.min(1, dot(subtract(point, start), edge) / dot(edge, edge)));
  return Math.hypot(point.x - start.x - edge.x * fraction, point.y - start.y - edge.y * fraction);
}

export function coneHits(source, rotation, length, items, casterId, dpi) {
  const angle = rotation * Math.PI / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const tip = { x: 0, y: 0 };
  const left = { x: length, y: -length / 2 };
  const right = { x: length, y: length / 2 };
  const walls = collectWalls(items);
  return items.filter((item) => {
    if (item.id === casterId || !isProjectileToken(item)) return false;
    const circle = tokenCircle(item, dpi);
    if (!circle) return false;
    const offset = subtract(circle.center, source);
    const center = { x: dot(direction, offset), y: cross(direction, offset) };
    if (center.x <= EPSILON || center.x > length + circle.radius) return false;
    // The cone is as wide as it is long. Test the token circle against its triangle.
    const inside = center.x <= length && Math.abs(center.y) <= center.x / 2;
    const overlaps = inside || Math.min(
      distanceToSegment(center, tip, left),
      distanceToSegment(center, left, right),
      distanceToSegment(center, right, tip),
    ) <= circle.radius + EPSILON;
    return overlaps && hasClearPath(source, circle.center, walls);
  }).map(({ id }) => id);
}

export function projectileImpact(source, destination, items, casterId, dpi, blastRadius = 0, canIntercept = () => true) {
  const delta = subtract(destination, source);
  const range = Math.hypot(delta.x, delta.y);
  if (!Number.isFinite(range) || range <= EPSILON) return { destination, hitTokenIds: [] };
  const direction = { x: delta.x / range, y: delta.y / range };
  const walls = collectWalls(items);
  const { distance: wall, blocker } = closestWall(source, direction, walls);
  const targets = [];
  let closestToken;
  let tokenDistance = Infinity;
  for (const item of items) {
    if (item.id === casterId || !isProjectileToken(item)) continue;
    const circle = tokenCircle(item, dpi);
    if (!circle) continue;
    targets.push({ id: item.id, ...circle });
    if (!canIntercept(item)) continue;
    const distance = circleDistance(source, direction, circle);
    if (distance < tokenDistance) {
      tokenDistance = distance;
      closestToken = item.id;
    }
  }

  const hitWall = wall <= range && wall <= tokenDistance + EPSILON;
  const hitToken = !hitWall && tokenDistance <= range;
  const distance = hitWall ? wall : hitToken ? tokenDistance : range;
  // Embers needs a nonzero travel length, even when the caster overlaps a target.
  const end = distance === range ? destination
    : advance(source, direction, Math.max(distance, Math.min(range, dpi / 100)));
  if (blastRadius <= 0) {
    const result = { destination: end, hitTokenIds: hitToken ? [closestToken] : [] };
    if (hitWall && isClosedSmokeDoor(blocker)) result.doorId = blocker.id;
    return result;
  }

  const impact = advance(source, direction, distance);
  // Start the cover ray just on the caster's side of the impact wall.
  const coverOrigin = hitWall ? advance(impact, direction, -dpi / 1000) : impact;
  const hitTokenIds = blastHits(impact, coverOrigin, blastRadius, targets, walls);
  return { destination: end, hitTokenIds };
}

export function clipProjectile(source, destination, items, casterId, dpi) {
  return projectileImpact(source, destination, items, casterId, dpi).destination;
}
