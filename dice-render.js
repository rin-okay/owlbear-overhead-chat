import * as THREE from "./vendor/three/three.module.min.js";

import { numberedFaces } from "./dice-faces.js";

function trapezohedron() {
  // The 10-sided solid uses Dicesuki's d10 geometry contract.
  const vertices = [[0, 1, 0], [0, -1, 0]];
  for (let index = 0; index < 10; index++) {
    const angle = index * Math.PI / 5;
    vertices.push([-Math.cos(angle), (index % 2 ? 1 : -1) * 0.105572809, -Math.sin(angle)]);
  }
  const triangles = [];
  for (let index = 0; index < 10; index++) {
    const next = (index + 1) % 10;
    triangles.push(...vertices[0], ...vertices[2 + next], ...vertices[2 + index]);
    triangles.push(...vertices[1], ...vertices[2 + index], ...vertices[2 + next]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(triangles, 3));
  return geometry;
}

function meshFaces(sides) {
  const shapes = {
    4: () => new THREE.TetrahedronGeometry(1),
    6: () => new THREE.BoxGeometry(1.1, 1.1, 1.1),
    8: () => new THREE.OctahedronGeometry(1),
    10: trapezohedron,
    12: () => new THREE.DodecahedronGeometry(0.9),
    20: () => new THREE.IcosahedronGeometry(1),
  };
  const geometry = shapes[sides]?.();
  if (!geometry) throw new Error("Unsupported die shape.");
  const positions = geometry.getAttribute("position");
  const faces = [];
  const index = geometry.getIndex();
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const points = [i, i + 1, i + 2].map((n) =>
      new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(n) : n));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    if (normal.dot(points[0]) < 0) {
      points.reverse();
      normal.negate();
    }
    const existing = faces.find((face) => face.normal.dot(normal) > 0.9999);
    if (existing) {
      for (const point of points) {
        if (!existing.points.some((other) => point.distanceToSquared(other) < 1e-8)) existing.points.push(point);
      }
    } else {
      faces.push({ normal, points });
    }
  }
  geometry.dispose();
  return faces.map(({ normal, points }) => {
    const center = new THREE.Vector3();
    points.forEach((point) => center.add(point));
    center.divideScalar(points.length);
    const u = points[0].clone().sub(center).normalize();
    const v = normal.clone().cross(u);
    const angle = (point) => {
      const offset = point.clone().sub(center);
      return Math.atan2(offset.dot(v), offset.dot(u));
    };
    return { normal, center, points: points.sort((a, b) => angle(a) - angle(b)) };
  });
}

function nearestFace(references, normal) {
  return references.reduce((best, candidate) =>
    candidate.normal.dot(normal) > best.normal.dot(normal) ? candidate : best);
}

const light = new THREE.Vector3(5, 10, 7).normalize();

function numberedMesh(sides) {
  const references = numberedFaces[sides].map(([value, x, y, z]) =>
    ({ value, normal: new THREE.Vector3(x, y, z).normalize() }));
  return meshFaces(sides).map((face) => {
    const { center, normal, points } = face;
    const glyphs = sides === 4
      ? points.map((tip) => ({
          position: center.clone().lerp(tip, 0.45),
          up: tip.clone().sub(center).normalize(),
          value: nearestFace(references, tip.clone().normalize().negate()).value,
          size: 0.26,
        }))
      : [{
          position: center,
          up: points[0].clone().sub(center).normalize(),
          value: nearestFace(references, normal).value,
          size: sides === 6 ? 0.61 : sides === 20 ? 0.45 : 0.53,
        }];
    return {
      ...face,
      glyphs: glyphs.map(({ up, ...glyph }) => ({ ...glyph, up, right: up.clone().cross(normal) })),
    };
  });
}

function path(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
}

function printNumeral(ctx, project, glyph, rotation, position) {
  const center = glyph.position.clone().applyQuaternion(rotation).add(position);
  const right = glyph.right.clone().applyQuaternion(rotation).multiplyScalar(glyph.size);
  const up = glyph.up.clone().applyQuaternion(rotation).multiplyScalar(glyph.size);
  const [x, y] = project(center);
  const [rx, ry] = project(center.clone().add(right));
  const [ux, uy] = project(center.clone().add(up));
  ctx.save();
  ctx.transform(rx - x, ry - y, x - ux, y - uy, x, y);
  ctx.font = "0.92px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#201b20";
  ctx.fillText(glyph.value, 0, 0.035);
  if (glyph.value === 6 || glyph.value === 9) ctx.fillRect(-0.19, 0.34, 0.38, 0.031);
  ctx.restore();
}

export function animateTray(canvas, dice, frames, duration) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Dice canvas unavailable.");
  const models = new Map([...new Set(dice.map(({ sides }) => sides))]
    .map((sides) => [sides, numberedMesh(sides)]));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const other = new THREE.Quaternion();
  let width, height, cameraHeight, focalLength;
  const project = ({ x, y, z }) => {
    const scale = focalLength / Math.max(1, cameraHeight - y);
    return [width / 2 + x * scale, height / 2 + z * scale];
  };

  function draw(progress) {
    if (width !== canvas.clientWidth || height !== canvas.clientHeight) {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (!width || !height) return false;
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      focalLength = height * 1.374;
      cameraHeight = Math.max(3.65, 6.15 * height / width) * 2.748;
    }
    if (!width || !height) return false;
    const index = progress * (frames.length - 1);
    const first = frames[Math.floor(index)];
    const second = frames[Math.ceil(index)];
    const fraction = index % 1;
    const visible = [];
    const shadows = [];
    ctx.fillStyle = "#211b24";
    ctx.fillRect(0, 0, width, height);

    for (const [die, { sides, kept }] of dice.entries()) {
      const position = new THREE.Vector3().fromArray(first[die])
        .lerp(new THREE.Vector3().fromArray(second[die]), fraction);
      const rotation = new THREE.Quaternion().fromArray(first[die], 3).normalize()
        .slerp(other.fromArray(second[die], 3).normalize(), fraction);

      for (const face of models.get(sides)) {
        const world = face.points.map((point) => point.clone().applyQuaternion(rotation).add(position));
        shadows.push(world.map(({ x, y, z }) => project({
          x: x - (y + 0.5) * light.x / light.y,
          y: -0.5,
          z: z - (y + 0.5) * light.z / light.y,
        })));

        const center = face.center.clone().applyQuaternion(rotation).add(position);
        const normal = face.normal.clone().applyQuaternion(rotation);
        if (normal.dot(new THREE.Vector3(0, cameraHeight, 0).sub(center)) <= 0) continue;
        const brightness = Math.round((kept ? 181 : 113) + Math.max(0, normal.dot(light)) * (kept ? 67 : 65));
        visible.push({ points: world.map(project), depth: center.y, brightness, glyphs: face.glyphs, rotation, position });
      }
    }

    ctx.fillStyle = "#100b13";
    ctx.beginPath();
    for (const points of shadows) {
      // Perspective projection can flip the winding of shadow polygons.
      const area = points.reduce((sum, [x, y], index) => {
        const [nextX, nextY] = points[(index + 1) % points.length];
        return sum + x * nextY - y * nextX;
      }, 0);
      if (area < 0) points.reverse();
      ctx.moveTo(...points[0]);
      for (const point of points.slice(1)) ctx.lineTo(...point);
      ctx.closePath();
    }
    ctx.fill();

    visible.sort((a, b) => a.depth - b.depth);
    for (const { points, brightness, glyphs, rotation, position } of visible) {
      path(ctx, points);
      ctx.fillStyle = `rgb(${brightness}, ${brightness - 3}, ${brightness - 2})`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.45;
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.clip();
      for (const glyph of glyphs) printNumeral(ctx, project, glyph, rotation, position);
      ctx.restore();
    }
    return true;
  }

  return new Promise((resolve, reject) => {
    let start;
    function frame(now) {
      try {
        start ??= now;
        const progress = reducedMotion ? 1 : Math.min(1, (now - start) / duration);
        if (draw(progress) && progress === 1) resolve();
        else if (now - start > 4500) reject(new Error("Dice canvas has no layout."));
        else requestAnimationFrame(frame);
      } catch (error) {
        reject(error);
      }
    }
    requestAnimationFrame(frame);
  });
}
