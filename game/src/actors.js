// Bodies: the physical state of every combatant (the player is one too), movement
// with acceleration, friction, jumping, crouching and axis-swept AABB collision with
// a step-up so crates and the catwalk stairs can be climbed. Hits are tested
// analytically — a sphere for the head, a capsule for the torso — so a headshot is
// worth more than a body shot and cover genuinely protects what it covers.
import { colliders } from './map.js';
import { clamp } from './rng.js';

export const STEP_UP = 0.55;
export const RADIUS = 0.34;

let nextId = 1;
export function createActor(team, name, isPlayer = false) {
  return {
    id: nextId++,
    team,
    name,
    isPlayer,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    crouch: false,
    onGround: true,
    hp: 100,
    armorPts: 0,
    alive: true,
    deathT: -9,
    money: 800,
    kills: 0,
    deaths: 0,
    inv: { primary: null, sidearm: null, frag: 0, smoke: 0, flash: 0 },
    cur: 'sidearm',
    blindUntil: -9,
    lastHurtT: -9,
    hurtFrom: 0,
    lastShotT: -9,
    speed2d: 0,
    bot: null,
    mesh: null,
    view: null,
  };
}

export const heightOf = (a) => (a.crouch ? 1.32 : 1.8);
export const eyeOf = (a) => a.pos.y + (a.crouch ? 1.1 : 1.6);

// Highest collider top under a point that is not above maxY (the floor you stand on).
export function supportHeight(x, z, maxY) {
  let top = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x > c.x0 - 0.01 && x < c.x1 + 0.01 && z > c.z0 - 0.01 && z < c.z1 + 0.01 && c.y1 <= maxY && c.y1 > top) {
      top = c.y1;
    }
  }
  return top;
}

function overlaps(a, c, lift = 0) {
  const y = a.pos.y + lift;
  return (
    a.pos.x + RADIUS > c.x0 && a.pos.x - RADIUS < c.x1 &&
    a.pos.z + RADIUS > c.z0 && a.pos.z - RADIUS < c.z1 &&
    y < c.y1 - 0.001 && y + heightOf(a) > c.y0 + 0.001
  );
}

function moveAxis(a, axis, amount) {
  if (amount === 0) return;
  a.pos[axis] += amount;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!overlaps(a, c)) continue;
    const rise = c.y1 - a.pos.y;
    if (rise > 0 && rise <= STEP_UP) {
      // Step up onto it if the raised stance is clear of everything else.
      let clear = true;
      for (let j = 0; j < colliders.length; j++) {
        if (j !== i && overlaps(a, colliders[j], rise)) {
          clear = false;
          break;
        }
      }
      if (clear) {
        a.pos.y = c.y1;
        continue;
      }
    }
    if (axis === 'x') a.pos.x = amount > 0 ? c.x0 - RADIUS - 0.001 : c.x1 + RADIUS + 0.001;
    else a.pos.z = amount > 0 ? c.z0 - RADIUS - 0.001 : c.z1 + RADIUS + 0.001;
  }
}

// wish: {x, z} desired world-space move direction (any length), flags jump/crouch/walk.
export function stepMovement(a, wish, dt, moveFactor = 1) {
  const maxSpeed = (a.crouch ? 1.7 : wish.walk ? 2.5 : 4.9) * moveFactor;
  const len = Math.hypot(wish.x, wish.z);
  const tx = len > 0.01 ? (wish.x / Math.max(1, len)) * maxSpeed : 0;
  const tz = len > 0.01 ? (wish.z / Math.max(1, len)) * maxSpeed : 0;
  if (a.onGround) {
    const k = Math.min(1, 11 * dt);
    a.vel.x += (tx - a.vel.x) * k;
    a.vel.z += (tz - a.vel.z) * k;
    if (wish.jump) {
      a.vel.y = 5.1;
      a.onGround = false;
    }
  } else {
    a.vel.x += tx * 0.55 * dt;
    a.vel.z += tz * 0.55 * dt;
    const sp = Math.hypot(a.vel.x, a.vel.z);
    if (sp > 5.4) {
      a.vel.x *= 5.4 / sp;
      a.vel.z *= 5.4 / sp;
    }
  }
  a.vel.y -= 17.5 * dt;
  if (a.vel.y < -30) a.vel.y = -30;

  moveAxis(a, 'x', a.vel.x * dt);
  moveAxis(a, 'z', a.vel.z * dt);

  const prevY = a.pos.y;
  a.pos.y += a.vel.y * dt;
  const floor = supportHeight(a.pos.x, a.pos.z, prevY + STEP_UP + 0.01);
  if (a.pos.y <= floor) {
    a.pos.y = floor;
    a.vel.y = 0;
    a.onGround = true;
  } else if (a.pos.y > floor + 0.02) {
    a.onGround = false;
  }
  // Ceiling: stop rising into a slab (depot roof, catwalk deck from below).
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (
      a.pos.x + RADIUS > c.x0 && a.pos.x - RADIUS < c.x1 &&
      a.pos.z + RADIUS > c.z0 && a.pos.z - RADIUS < c.z1 &&
      a.pos.y + heightOf(a) > c.y0 && a.pos.y < c.y0 && a.vel.y > 0
    ) {
      a.vel.y = 0;
      a.pos.y = c.y0 - heightOf(a) - 0.001;
    }
  }
  a.speed2d = Math.hypot(a.vel.x, a.vel.z);
}

// Ray vs one actor: head sphere first, then the torso capsule. Returns {dist, zone} or null.
const _v = { x: 0, y: 0, z: 0 };
export function rayHitActor(ox, oy, oz, dx, dy, dz, a, maxDist) {
  if (!a.alive) return null;
  // Head sphere
  const hy = a.pos.y + (a.crouch ? 1.06 : 1.52);
  _v.x = a.pos.x - ox;
  _v.y = hy - oy;
  _v.z = a.pos.z - oz;
  const tca = _v.x * dx + _v.y * dy + _v.z * dz;
  if (tca > 0) {
    const d2 = _v.x * _v.x + _v.y * _v.y + _v.z * _v.z - tca * tca;
    const r = 0.15;
    if (d2 < r * r) {
      const t = tca - Math.sqrt(r * r - d2);
      if (t > 0 && t < maxDist) return { dist: t, zone: 'head' };
    }
  }
  // Torso capsule: segment from low to high chest, radius RADIUS
  const y0 = a.pos.y + 0.28;
  const y1 = a.pos.y + (a.crouch ? 0.92 : 1.36);
  const px = a.pos.x - ox;
  const pz = a.pos.z - oz;
  // Solve in the vertical plane containing the ray: use closest point between ray and segment.
  // Segment is vertical, so work with the ray's closest approach to the axis line, clamped in y.
  let bestT = Infinity;
  // Sample the capsule as two spheres + cylinder via closest-point iteration (3 passes is plenty).
  for (const cy of [y0, (y0 + y1) / 2, y1]) {
    _v.x = px;
    _v.y = cy - oy;
    _v.z = pz;
    const t = _v.x * dx + _v.y * dy + _v.z * dz;
    if (t < 0 || t > maxDist) continue;
    const cx = ox + dx * t - a.pos.x;
    const cyy = oy + dy * t - cy;
    const cz = oz + dz * t - a.pos.z;
    const d2 = cx * cx + cyy * cyy + cz * cz;
    if (d2 < RADIUS * RADIUS && t < bestT) bestT = t;
  }
  if (bestT === Infinity) {
    // Cylinder sides: distance from ray to the vertical axis, with hit height in range.
    const rx = dx;
    const rz = dz;
    const denom = rx * rx + rz * rz;
    if (denom > 1e-8) {
      const t = -( (ox - a.pos.x) * rx + (oz - a.pos.z) * rz ) / denom;
      if (t > 0 && t < maxDist) {
        const hx = ox + dx * t;
        const hz = oz + dz * t;
        const hyy = oy + dy * t;
        const dd = Math.hypot(hx - a.pos.x, hz - a.pos.z);
        if (dd < RADIUS && hyy > y0 && hyy < y1) bestT = t;
      }
    }
  }
  if (bestT === Infinity) return null;
  const hitY = oy + dy * bestT - a.pos.y;
  return { dist: bestT, zone: hitY < 0.62 ? 'limb' : 'body' };
}

// Damage with the vest absorbing its share; returns the health actually lost.
export function applyDamage(a, amount, zone) {
  if (!a.alive) return 0;
  let dmg = amount;
  if (zone === 'head') dmg *= 4;
  else if (zone === 'limb') dmg *= 0.75;
  if (a.armorPts > 0) {
    const factor = zone === 'head' ? 0.55 : 0.5;
    const absorbed = dmg * factor;
    const used = Math.min(a.armorPts, absorbed);
    a.armorPts -= used;
    dmg -= used;
  }
  dmg = Math.max(1, Math.round(dmg));
  a.hp -= dmg;
  if (a.hp <= 0) {
    a.hp = 0;
    a.alive = false;
  }
  return dmg;
}

export const inSite = (site, x, z) => x >= site.x0 && x <= site.x1 && z >= site.z0 && z <= site.z1;
export { clamp };
