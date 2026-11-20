import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";

const colors = ["#9564e3", "#4faec5", "#c55a98", "#6d91df", "#a375d0", "#52ae9a", "#ce8459", "#7973d4"];
const view = new THREE.Vector3(0, 0.958, 0.287);
const light = new THREE.Vector3(-0.6, 1, -0.35).normalize();

function trapezohedron() {
  // The 10-sided solid uses Dicesuki's d10 geometry contract.
  const vertices = [[0, 1, 0], [0, -1, 0]];
  for (let index = 0; index < 10; index++) {
    const angle = index * Math.PI / 5;
    vertices.push([Math.cos(angle), (index % 2 ? 1 : -1) * 0.105572809, Math.sin(angle)]);
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

export function animateTray(canvas, dice, frames, duration) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.lineJoin = "round";
  const unit = Math.min(width / 11.7, height / 8.25);
  const project = ({ x, y, z }) => [width / 2 + x * unit, height * 0.56 + (z * view.y - y * view.z) * unit];
  const meshes = new Map(dice.map(({ sides }) => [sides, meshFaces(sides)]));
  const bases = dice.map((die, index) => new THREE.Color(die.kept ? colors[index] : "#746981"));
  const other = new THREE.Quaternion();

  function draw(progress) {
    const index = progress * (frames.length - 1);
    const first = frames[Math.floor(index)];
    const second = frames[Math.ceil(index)];
    const fraction = index % 1;
    const settled = progress === 1;
    const surfaces = [];
    const labels = [];
    ctx.clearRect(0, 0, width, height);
    for (const [i, { sides, value, kept }] of dice.entries()) {
      const [x, y, z] = first[i].slice(0, 3).map((position, axis) =>
        position + (second[i][axis] - position) * fraction);
      const position = new THREE.Vector3(x, y, z);
      const rotation = new THREE.Quaternion().fromArray(first[i], 3).normalize()
        .slerp(other.fromArray(second[i], 3).normalize(), fraction);
      const shadow = project({ x, y: -0.4, z });
      ctx.fillStyle = `rgba(5,2,10,${0.4 / (1 + Math.max(0, y) * 0.18)})`;
      ctx.beginPath();
      ctx.ellipse(...shadow, unit * 0.85, unit * 0.60, 0, 0, 2 * Math.PI);
      ctx.fill();
      const faces = meshes.get(sides);
      let top;
      for (const face of faces) {
        const normal = face.normal.clone().applyQuaternion(rotation);
        if (normal.dot(view) <= 0.005) continue;
        const center = face.center.clone().applyQuaternion(rotation).add(position);
        surfaces.push({
          points: face.points.map((point) => project(point.clone().applyQuaternion(rotation).add(position))),
          depth: center.dot(view),
          color: bases[i].clone().multiplyScalar(0.40 + 0.67 * Math.max(0, normal.dot(light))).getStyle(),
        });
        if (!top || normal.y > top.y) top = { point: center, y: normal.y };
      }
      if (settled) labels.push({ point: project(sides === 4 || !top
        ? position.clone().add(new THREE.Vector3(0, 0.42, -0.05)) : top.point), value, kept });
    }
    surfaces.sort((a, b) => a.depth - b.depth);
    for (const { points, color } of surfaces) {
      ctx.fillStyle = color;
      ctx.strokeStyle = "#2b1c3e";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      for (const point of points.slice(1)) ctx.lineTo(...point);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const { point: [x, y], value, kept } of labels) {
      ctx.font = `bold ${Math.max(11, unit * 0.66)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 2.8;
      ctx.strokeStyle = "#21142c";
      ctx.fillStyle = kept ? "#fff" : "#dbd0e4";
      ctx.strokeText(value, x, y);
      ctx.fillText(value, x, y);
      if (!kept) ctx.fillRect(x - 7, y - 1, 14, 1);
    }
  }

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    draw(1);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const start = performance.now();
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      try {
        draw(progress);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      } catch (error) {
        reject(error);
      }
    }
    requestAnimationFrame(frame);
  });
}
