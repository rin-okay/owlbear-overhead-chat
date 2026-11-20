import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js";

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

function numeralMaterial(value, materials) {
  if (materials.has(value)) return materials.get(value);
  const image = document.createElement("canvas");
  image.width = image.height = 128;
  const ink = image.getContext("2d");
  ink.font = "102px Helvetica, Arial, sans-serif";
  ink.fillStyle = "#161316";
  ink.textAlign = "center";
  ink.textBaseline = "middle";
  ink.fillText(value, 64, 66);
  if (value === 6 || value === 9) ink.fillRect(48, 108, 32, 4);

  const map = new THREE.CanvasTexture(image);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, alphaTest: 0.05 });
  materials.set(value, material);
  return material;
}

function addNumeral(group, plane, materials, value, position, normal, up, width, height = width) {
  const numeral = new THREE.Mesh(plane, numeralMaterial(value, materials));
  const right = up.clone().cross(normal).normalize();
  const vertical = normal.clone().cross(right);
  numeral.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, vertical, normal));
  numeral.position.copy(position).addScaledVector(normal, 0.003);
  numeral.scale.set(width, height, 1);
  numeral.renderOrder = 1;
  group.add(numeral);
}

function createDie(sides, kept, plane, materials, bodyMaterials) {
  const group = new THREE.Group();
  const hull = [];
  const references = numberedFaces[sides].map(([value, x, y, z]) =>
    ({ value, normal: new THREE.Vector3(x, y, z).normalize() }));

  for (const { normal, center, points } of meshFaces(sides)) {
    for (let index = 1; index < points.length - 1; index++) {
      hull.push(...points[0], ...points[index], ...points[index + 1]);
    }

    if (sides === 4) {
      for (const tip of points) {
        const vertexValue = nearestFace(references, tip.clone().normalize().negate()).value;
        addNumeral(group, plane, materials, vertexValue, center.clone().lerp(tip, 0.45),
          normal, tip.clone().sub(center), 0.31);
      }
      continue;
    }

    const { value } = nearestFace(references, normal);
    const up = points[0].clone().sub(center);
    const size = sides === 6 ? 0.69 : sides === 20 ? 0.49 : 0.59;
    addNumeral(group, plane, materials, value, center, normal, up, size * (value >= 10 ? 1.22 : 1), size);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(hull, 3));
  geometry.computeVertexNormals();
  const body = new THREE.Mesh(geometry, bodyMaterials[kept ? 0 : 1]);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  return group;
}

export async function animateTray(canvas, dice, frames, duration) {
  const { clientWidth: width, clientHeight: height } = canvas;
  if (!width || !height) throw new Error("Dice tray is not visible.");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  const materials = new Map();
  const dispose = () => {
    const geometries = new Set();
    const sceneMaterials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) sceneMaterials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    sceneMaterials.forEach((material) => {
      material.map?.dispose();
      material.dispose();
    });
    scene.children.find((object) => object.isDirectionalLight)?.shadow.dispose();
    renderer.dispose();
  };
  window.addEventListener("pagehide", dispose, { once: true });

  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.background = new THREE.Color("#17131b");

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 60);
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const cameraHeight = Math.max(3.7, 6.15 / camera.aspect) / halfFov;
    camera.up.set(0, 0, -1);
    camera.position.set(0, cameraHeight, 0);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight("#f7edf2", "#736981", 1.45));
    const key = new THREE.DirectionalLight("#fff4eb", 2.25);
    key.position.set(5, 10, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 27 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.normalBias = 0.017;
    scene.add(key);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 36),
      new THREE.MeshStandardMaterial({ color: "#211b24", roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    scene.add(floor);

    const plane = new THREE.PlaneGeometry(1, 1);
    const bodyMaterials = ["#ffffff", "#9a909f"].map((color) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.62 }));
    const models = dice.map(({ sides, kept }) => {
      const model = createDie(sides, kept, plane, materials, bodyMaterials);
      scene.add(model);
      return model;
    });
    const other = new THREE.Quaternion();

    function draw(progress) {
      const index = progress * (frames.length - 1);
      const first = frames[Math.floor(index)];
      const second = frames[Math.ceil(index)];
      const fraction = index % 1;
      models.forEach((model, die) => {
        model.position.fromArray(first[die]);
        const [x, y, z] = second[die];
        model.position.x += (x - model.position.x) * fraction;
        model.position.y += (y - model.position.y) * fraction;
        model.position.z += (z - model.position.z) * fraction;
        model.quaternion.fromArray(first[die], 3).normalize()
          .slerp(other.fromArray(second[die], 3).normalize(), fraction);
      });
      renderer.render(scene, camera);
    }

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(1);
      return;
    }

    await new Promise((resolve, reject) => {
      const start = performance.now();
      function frame(now) {
        try {
          const progress = THREE.MathUtils.clamp((now - start) / duration, 0, 1);
          draw(progress);
          if (progress < 1) requestAnimationFrame(frame);
          else resolve();
        } catch (error) {
          reject(error);
        }
      }
      requestAnimationFrame(frame);
    });
  } catch (error) {
    window.removeEventListener("pagehide", dispose);
    dispose();
    throw error;
  }
}
