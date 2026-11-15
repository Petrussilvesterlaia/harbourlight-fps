// The dockyard: one original map, "Harbourlight Yard". Everything the simulation
// touches is an axis-aligned box; the same box list builds the meshes, the bullet
// raycasts, the line-of-sight tests and the minimap, so what you see is what collides.
// Zones: Breaker spawn west, Wardens east, Drydock (site A) north-east, the Depot
// (site B) south-east, a container maze with a catwalk in mid, Crane Row north and
// Shed Row south as the two side lanes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [centreX, centreZ, width, depth, height, material] — y base is the ground unless noted.
const BOXES = [
  // Perimeter fence walls
  [0, -28.5, 74, 1, 4, 'concrete'], [0, 28.5, 74, 1, 4, 'concrete'],
  [-36.5, 0, 1, 58, 4, 'concrete'], [36.5, 0, 1, 58, 4, 'concrete'],
  // North warehouse behind the Drydock (its south wall makes Crane Row)
  [20, -24.2, 28, 5.6, 5.5, 'warehouse'],
  // Crane Row cover (north lane)
  [-20, -16, 6, 2.4, 2.6, 'c-rust'], [-2, -17, 6, 2.4, 2.6, 'c-teal'], [8, -19, 5, 2.4, 2.6, 'c-ochre'],
  [-12, -11, 5, 2.4, 2.6, 'c-slate'], [0, -11.5, 5, 2.4, 2.6, 'c-olive'], [10, -11, 5, 2.4, 2.6, 'c-rust'],
  // Mid container maze
  [-8.5, -4, 7, 2.4, 2.6, 'c-teal'], [7, -4, 8, 2.4, 2.6, 'c-rust'],
  [-8.5, 4.5, 5, 2.4, 2.6, 'c-ochre'], [1.5, 4.5, 7, 2.4, 2.6, 'c-slate'], [10.5, 4.5, 5, 2.4, 2.6, 'c-olive'],
  [-3, -1.5, 2, 2, 1.1, 'crate'], [6, -3, 2, 2, 1.1, 'crate'], [-7, 1.5, 2, 2, 1.1, 'crate'],
  [13.5, 0, 2, 2, 1.1, 'crate'], [-13, -1, 2.4, 2.4, 2.6, 'c-slate'],
  // East-of-mid rotation cover
  [19, -3.5, 5, 2.4, 2.6, 'c-teal'], [19, 4.5, 5, 2.4, 2.6, 'c-rust'], [26, 0, 2, 2, 1.1, 'crate'],
  // West yard (Breaker spawn) cover
  [-26, -8, 5, 2.4, 2.6, 'c-ochre'], [-26, 9, 5, 2.4, 2.6, 'c-teal'], [-20, 0, 2, 2, 1.1, 'crate'],
  [-16, -5, 2, 2, 1.1, 'crate'], [-16, 6, 2, 2, 1.1, 'crate'],
  // South lane sheds and cover
  [-17, 24, 6, 3, 3, 'warehouse'], [-3, 24, 6, 3, 3, 'warehouse'],
  [-11, 18, 5, 2.4, 2.6, 'c-rust'], [5, 21, 5, 2.4, 2.6, 'c-teal'], [12, 19, 2, 2, 1.1, 'crate'],
  // Drydock (site A): hull prop, rim and cover
  [25.5, -15.5, 9, 3, 2.2, 'c-rust'], [19, -12, 2, 2, 1.1, 'crate'], [28, -19.5, 2, 2, 1.1, 'crate'],
  [30.5, -12.5, 2, 2, 1.1, 'crate'], [16, -16, 5, 2.4, 2.6, 'c-slate'],
  // Depot (site B) shell: walls with door gaps, roof slab added in build
  [21, 11, 6.4, 0.4, 4, 'warehouse'], [30, 11, 8.4, 0.4, 4, 'warehouse'],
  [19.5, 25, 3.4, 0.4, 4, 'warehouse'], [28.5, 25, 11.4, 0.4, 4, 'warehouse'],
  [18, 13.5, 0.4, 5.4, 4, 'warehouse'], [18, 22, 0.4, 6.4, 4, 'warehouse'],
  [34, 18, 0.4, 14.4, 4, 'warehouse'],
  // Depot interior and yard cover
  [21.5, 14, 3, 2, 1.1, 'crate'], [29, 20.5, 3, 2, 1.1, 'crate'], [25, 22.5, 2, 2, 1.1, 'crate'],
  [24, 8, 5, 2.4, 2.6, 'c-ochre'], [15, 20, 2, 2, 1.1, 'crate'],
];

// Raised pieces: [cx, cz, w, d, yBase, yTop, material] — catwalk, its stairs, crane legs and beam, depot roof.
const RAISED = [
  [6, 0, 10, 3.2, 2.3, 2.6, 'steel'],                       // catwalk deck over mid
  [0.5, 0, 1, 3.2, 0, 0.52, 'steel'], [-0.6, 0, 1, 3.2, 0, 1.04, 'steel'],
  [-1.7, 0, 1, 3.2, 0, 1.56, 'steel'], [-2.8, 0, 1, 3.2, 0, 2.08, 'steel'],
  [11.5, 0, 1, 3.2, 0, 0.52, 'steel'], [12.6, 0, 1, 3.2, 0, 1.04, 'steel'],
  [13.7, 0, 1, 3.2, 0, 1.56, 'steel'], [14.8, 0, 1, 3.2, 0, 2.08, 'steel'],
  [1.2, -1.4, 0.4, 0.4, 0, 2.3, 'steel'], [1.2, 1.4, 0.4, 0.4, 0, 2.3, 'steel'],
  [10.8, -1.4, 0.4, 0.4, 0, 2.3, 'steel'], [10.8, 1.4, 0.4, 0.4, 0, 2.3, 'steel'],
  [20, -20, 0.6, 0.6, 0, 7, 'c-ochre'], [31, -20, 0.6, 0.6, 0, 7, 'c-ochre'],
  [25.5, -20, 12, 0.8, 6.4, 7, 'c-ochre'],                  // crane beam over the Drydock
  [26, 18, 16.4, 14.4, 4, 4.3, 'roof'],                     // depot roof
];

export const SITES = {
  A: { label: 'A', name: 'the Drydock', x0: 17.5, x1: 33.5, z0: -22.5, z1: -9.5, cx: 25.5, cz: -16 },
  B: { label: 'B', name: 'the Depot', x0: 16.5, x1: 35, z0: 9.5, z1: 26, cx: 26, cz: 18 },
};

export const SPAWNS = {
  atk: [[-31, -3], [-31, 0], [-31, 3], [-28.5, -1.5], [-28.5, 1.5]],
  def: [[32, -2], [32, 1], [32, 4], [29.5, -3.5], [29.5, 5.5]],
};

// Waypoint graph: bots path on these nodes; edges are walked straight, the collision
// slide handles the rest. Tags: lane membership and hold points per site.
export const NODES = [
  [-30, 0, 'atk'], [-24, -2, 'atk'], [-18, -12, 'n'], [-18, 12, 's'], [-10, -16, 'n'],
  [2, -16, 'n'], [12, -15, 'n'], [14, -13, 'a'], [18, -13, 'a'], [25, -16, 'a'],
  [29, -20, 'a'], [-8, 0, 'm'], [-1, 0, 'm'], [7, 3, 'm'], [6, 0, 'cat'],
  [14, 12, 'b'], [19, 14, 'b'], [25, 17, 'b'], [30, 21, 'b'], [-10, 17, 's'],
  [2, 18, 's'], [12, 19, 's'], [31, 2, 'def'], [24, 0, 'def'], [21, -19, 'a'],
  [28, -11, 'a'], [21, 22, 'b'], [29, 12, 'b'], [10, -4, 'm'], [2, -9, 'n'],
  [2, 9, 's'], [-24, -14, 'n'], [-24, 14, 's'],
];
const EDGE_PAIRS = [
  [0, 1], [1, 2], [1, 3], [1, 31], [1, 32], [2, 31], [31, 4], [2, 4], [4, 5], [5, 6],
  [6, 7], [7, 8], [8, 9], [9, 10], [9, 24], [8, 25], [10, 25], [5, 29], [29, 11],
  [11, 12], [12, 13], [12, 14], [13, 14], [13, 28], [28, 6], [11, 30], [30, 20],
  [3, 32], [32, 19], [19, 20], [20, 21], [21, 15], [15, 16], [16, 17], [17, 18],
  [17, 26], [16, 27], [18, 27], [13, 21], [22, 23], [23, 8], [23, 16], [22, 10],
  [22, 18], [23, 28], [7, 23], [23, 13],
];
export const HOLDS = { A: [24, 25, 9], B: [26, 27, 17], mid: [28, 14] };

export const BOUNDS = { x0: -36, x1: 36, z0: -28, z1: 28 };

export function buildGraph() {
  const adj = NODES.map(() => []);
  for (const [a, b] of EDGE_PAIRS) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

// BFS shortest path over the waypoint graph; returns node ids including both ends.
export function findPath(adj, from, to) {
  if (from === to) return [from];
  const prev = new Int16Array(NODES.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj[cur]) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let walk = to;
        while (walk !== from) {
          walk = prev[walk];
          path.unshift(walk);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [from];
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const d = (NODES[i][0] - x) ** 2 + (NODES[i][1] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ---- collision + sight -------------------------------------------------

export const colliders = [];
function addCollider(cx, cz, w, d, y0, y1) {
  colliders.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1 });
}

// Ray vs every collider (slab test) plus the ground plane; returns nearest distance.
export function rayWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0 && t < best) best = t;
  }
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dx) < 1e-8) {
      if (ox < c.x0 || ox > c.x1) continue;
    } else {
      let ta = (c.x0 - ox) / dx;
      let tb = (c.x1 - ox) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-8) {
      if (oy < c.y0 || oy > c.y1) continue;
    } else {
      let ta = (c.y0 - oy) / dy;
      let tb = (c.y1 - oy) / dy;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-8) {
      if (oz < c.z0 || oz > c.z1) continue;
    } else {
      let ta = (c.z0 - oz) / dz;
      let tb = (c.z1 - oz) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) continue;
    }
    if (t0 > 0 && t0 < best) best = t0;
  }
  return best;
}

// True when nothing solid sits between two points (used for bot vision and AI hearing checks).
export function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) return true;
  const hit = rayWorld(ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  return hit >= dist - 0.08;
}

// ---- scene building ----------------------------------------------------

function canvasTexture(draw, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ribbedTexture(base, rib, line) {
  return canvasTexture((g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    g.fillStyle = rib;
    for (let x = 0; x < s; x += 32) g.fillRect(x, 0, 10, s);
    g.fillStyle = line;
    g.fillRect(0, 0, s, 10);
    g.fillRect(0, s - 10, s, 10);
  });
}

const MATS = {};
function materials() {
  if (MATS.ground) return MATS;
  const asphalt = canvasTexture((g, s) => {
    g.fillStyle = '#3b4249';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = Math.random() < 0.5 ? '#363d44' : '#41484f';
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    g.fillStyle = '#454d54';
    g.fillRect(0, 0, s, 5);
    g.fillRect(0, 0, 5, s);
  });
  asphalt.repeat.set(18, 14);
  MATS.ground = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.96 });
  const concreteTex = ribbedTexture('#5b646d', '#525b63', '#485058');
  MATS.concrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 });
  MATS.warehouse = new THREE.MeshStandardMaterial({ map: ribbedTexture('#54493a', '#4a4033', '#3c342a'), roughness: 0.92 });
  MATS.roof = new THREE.MeshStandardMaterial({ color: PALETTE.warehouseRoof, roughness: 0.95 });
  MATS.steel = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.55, metalness: 0.55 });
  MATS.crate = new THREE.MeshStandardMaterial({
    map: canvasTexture((g, s) => {
      g.fillStyle = '#7a5c38';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#5f4629';
      g.lineWidth = 12;
      g.strokeRect(6, 6, s - 12, s - 12);
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s);
      g.stroke();
    }),
    roughness: 0.9,
  });
  const contTex = ribbedTexture('#c8c8c8', '#a8a8a8', '#888888');
  for (const [key, color] of [['c-rust', PALETTE.rust], ['c-teal', PALETTE.teal], ['c-ochre', PALETTE.ochre], ['c-olive', PALETTE.olive], ['c-slate', PALETTE.slateBlue]]) {
    MATS[key] = new THREE.MeshStandardMaterial({ map: contTex, color, roughness: 0.62, metalness: 0.3 });
  }
  return MATS;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function addBox(group, mats, cx, cz, w, d, y0, y1, matKey, shadow = true) {
  const mesh = new THREE.Mesh(boxGeo, mats[matKey]);
  mesh.scale.set(w, y1 - y0, d);
  mesh.position.set(cx, (y0 + y1) / 2, cz);
  mesh.castShadow = shadow && y1 - y0 > 0.4;
  mesh.receiveShadow = true;
  group.add(mesh);
  addCollider(cx, cz, w, d, y0, y1);
}

function siteDecal(site, letter) {
  const tex = canvasTexture((g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(240,168,48,0.9)';
    g.lineWidth = 10;
    g.strokeRect(14, 14, s - 28, s - 28);
    g.fillStyle = 'rgba(240,168,48,0.85)';
    g.font = `700 ${s * 0.52}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, s / 2, s / 2 + 6);
  }, 512);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const w = site.x1 - site.x0;
  const d = site.z1 - site.z0;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((site.x0 + site.x1) / 2, 0.02, (site.z0 + site.z1) / 2);
  return mesh;
}

export function buildMap(scene) {
  colliders.length = 0;
  const mats = materials();
  const group = new THREE.Group();

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 96), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  for (const [cx, cz, w, d, h, mat] of BOXES) addBox(group, mats, cx, cz, w, d, 0, h, mat);
  for (const [cx, cz, w, d, y0, y1, mat] of RAISED) addBox(group, mats, cx, cz, w, d, y0, y1, mat);

  // Drydock rim: a low painted kerb outlining site A.
  const rimMat = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.8 });
  for (const [cx, cz, w, d] of [[25.5, -21.8, 13, 0.35], [25.5, -10.2, 13, 0.35], [19.2, -16, 0.35, 11.6], [31.8, -16, 0.35, 11.6]]) {
    const rim = new THREE.Mesh(boxGeo, rimMat);
    rim.scale.set(w, 0.14, d);
    rim.position.set(cx, 0.07, cz);
    group.add(rim);
  }
  group.add(siteDecal(SITES.A, 'A'));
  group.add(siteDecal(SITES.B, 'B'));

  // Distant silhouettes: harbour cranes and sheds beyond the fence, no colliders.
  const farMat = new THREE.MeshBasicMaterial({ color: 0x141a20 });
  for (const [x, z, w, h, d] of [[-52, -20, 16, 15, 6], [48, -34, 22, 11, 6], [-46, 26, 18, 9, 6], [54, 18, 14, 18, 6], [0, -46, 30, 8, 6]]) {
    const m = new THREE.Mesh(boxGeo, farMat);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    group.add(m);
  }
  scene.add(group);
  return { group };
}
