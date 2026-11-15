// The arsenal and how shots resolve. Accuracy is a model, not a dice roll: spread
// grows with movement, airtime and sustained fire (bloom), shrinks when crouched,
// and the first shot of a stopped player is near-pinpoint — so stopping to aim pays,
// exactly the discipline the bounty asks for. Recoil kicks the view up a fixed
// pattern the player can learn to pull against.
import { rayWorld } from './map.js';
import { rayHitActor, applyDamage, eyeOf } from './actors.js';
import { clamp } from './rng.js';

export const WEAPONS = {
  p9: { name: 'P9 Sidearm', kind: 'pistol', price: 0, dmg: 26, rpm: 400, mag: 12, reserve: 48, reload: 1.4, spread: 0.006, moveSpread: 0.03, bloom: 0.006, recover: 0.055, recoilP: 0.011, auto: false, move: 1.0, falloff: 0.75 },
  raptor: { name: 'Raptor-9 SMG', kind: 'smg', price: 1200, dmg: 20, rpm: 800, mag: 30, reserve: 90, reload: 1.9, spread: 0.013, moveSpread: 0.032, bloom: 0.004, recover: 0.06, recoilP: 0.007, auto: true, move: 1.0, falloff: 0.6 },
  breach: { name: 'Breach-12', kind: 'shotgun', price: 1100, dmg: 11, pellets: 8, rpm: 68, mag: 6, reserve: 24, reload: 2.6, spread: 0.042, moveSpread: 0.02, bloom: 0.03, recover: 0.05, recoilP: 0.05, auto: false, move: 0.97, falloff: 0.45 },
  vk7: { name: 'VK-7 Rifle', kind: 'rifle', price: 2700, dmg: 34, rpm: 600, mag: 30, reserve: 90, reload: 2.3, spread: 0.0022, moveSpread: 0.038, bloom: 0.0045, recover: 0.05, recoilP: 0.016, auto: true, move: 0.95, falloff: 0.8 },
  longshot: { name: 'Longshot DMR', kind: 'dmr', price: 4200, dmg: 85, rpm: 150, mag: 10, reserve: 40, reload: 2.7, spread: 0.0008, moveSpread: 0.05, bloom: 0.02, recover: 0.04, recoilP: 0.045, auto: false, move: 0.92, falloff: 1, zoom: 2.6 },
};
export const GRENADES = {
  frag: { name: 'Frag Charge', price: 300 },
  smoke: { name: 'Smoke Canister', price: 250 },
  flash: { name: 'Flash Orb', price: 200 },
};
export const ARMOR_PRICE = 650;
export const ARMOR_POINTS = 100;
// Learnable yaw pattern of the rifle's climb (radians per shot index).
const PATTERN = [0, 0.0012, -0.0016, 0.002, -0.0024, 0.0028, -0.0018, 0.0014, -0.0022, 0.0018];

export function makeWeaponState(id) {
  const def = WEAPONS[id];
  return { id, mag: def.mag, reserve: def.reserve, cooldown: 0, reloading: false, reloadT: 0, bloom: 0, burst: 0 };
}

export function dirFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -cp * Math.sin(yaw);
  out.y = Math.sin(pitch);
  out.z = -cp * Math.cos(yaw);
  return out;
}

const _dir = { x: 0, y: 0, z: 0 };
const _right = { x: 0, y: 0, z: 0 };
const _up = { x: 0, y: 0, z: 0 };

function spreadDir(rng, base, spread) {
  _dir.x = base.x; _dir.y = base.y; _dir.z = base.z;
  if (spread <= 0.0001) return _dir;
  // Orthonormal basis around the aim direction, then a random point in the cone.
  _right.x = -base.z; _right.y = 0; _right.z = base.x;
  const rl = Math.hypot(_right.x, _right.z) || 1;
  _right.x /= rl; _right.z /= rl;
  _up.x = _right.y * base.z - _right.z * base.y;
  _up.y = _right.z * base.x - _right.x * base.z;
  _up.z = _right.x * base.y - _right.y * base.x;
  const ang = rng.next() * Math.PI * 2;
  const rad = spread * Math.sqrt(rng.next());
  _dir.x += _right.x * Math.cos(ang) * rad + _up.x * Math.sin(ang) * rad;
  _dir.y += _right.y * Math.cos(ang) * rad + _up.y * Math.sin(ang) * rad;
  _dir.z += _right.z * Math.cos(ang) * rad + _up.z * Math.sin(ang) * rad;
  const l = Math.hypot(_dir.x, _dir.y, _dir.z) || 1;
  _dir.x /= l; _dir.y /= l; _dir.z /= l;
  return _dir;
}

export function spreadOf(def, actor, bloom) {
  let s = def.spread + bloom;
  s += def.moveSpread * clamp(actor.speed2d / 4.9, 0, 1);
  if (!actor.onGround) s += 0.045;
  if (actor.crouch) s *= 0.72;
  return s;
}

function fireOne(match, actor, state, def) {
  const rng = match.rng;
  const eye = eyeOf(actor);
  state.mag -= 1;
  state.cooldown = 60 / def.rpm;
  state.bloom = Math.min(0.05, state.bloom + def.bloom);
  state.burst += 1;
  actor.kickP = (actor.kickP || 0) + def.recoilP * rng.range(0.9, 1.1);
  actor.kickY = (actor.kickY || 0) + (PATTERN[Math.min(state.burst, PATTERN.length - 1)] || 0) * (def.kind === 'rifle' ? 1 : 0.4);
  actor.lastShotT = match.time;
  match.addNoise(actor.pos.x, actor.pos.z, def.kind === 'dmr' || def.kind === 'shotgun' ? 36 : 27, actor.team);

  const pellets = def.pellets || 1;
  const spread = spreadOf(def, actor, state.bloom);
  let anyHit = false;
  for (let p = 0; p < pellets; p++) {
    dirFromAngles(actor.yaw + (actor.kickY || 0), actor.pitch + (actor.kickP || 0), _dir);
    const d = spreadDir(rng, _dir, pellets > 1 ? def.spread : spread);
    const wallDist = rayWorld(actor.pos.x, eye, actor.pos.z, d.x, d.y, d.z, 120);
    let victim = null;
    let victimHit = null;
    for (const other of match.actors) {
      if (other === actor || other.team === actor.team || !other.alive) continue;
      const hit = rayHitActor(actor.pos.x, eye, actor.pos.z, d.x, d.y, d.z, other, wallDist);
      if (hit && (!victimHit || hit.dist < victimHit.dist)) {
        victim = other;
        victimHit = hit;
      }
    }
    const dist = victimHit ? victimHit.dist : wallDist;
    const hx = actor.pos.x + d.x * dist;
    const hy = eye + d.y * dist;
    const hz = actor.pos.z + d.z * dist;
    match.events.push({
      k: 'shot', kind: def.kind, team: actor.team, first: p === 0,
      x: actor.pos.x - Math.sin(actor.yaw) * 0.45, y: eye - 0.12, z: actor.pos.z - Math.cos(actor.yaw) * 0.45,
      tx: hx, ty: hy, tz: hz, hitActor: !!victimHit,
    });
    if (victimHit) {
      anyHit = true;
      let dmg = def.dmg;
      if (dist > 25) dmg *= def.falloff;
      if (dist > 45) dmg *= def.falloff;
      const dealt = applyDamage(victim, dmg, victimHit.zone);
      if (actor.isPlayer) match.events.push({ k: 'hitmark', kill: !victim.alive, dmg: dealt });
      if (victim.isPlayer) match.events.push({ k: 'hurt', from: Math.atan2(actor.pos.x - victim.pos.x, actor.pos.z - victim.pos.z), dmg: dealt });
      if (!victim.alive && victim.deathT < 0) {
        victim.deathT = match.time;
        victim.deaths += 1;
        actor.kills += 1;
        actor.money += 300;
        match.onKill(actor, victim, victimHit.zone);
      }
    }
  }
  return anyHit;
}

export function startReload(match, actor) {
  const state = actor.inv[actor.cur];
  if (!state || !WEAPONS[state.id]) return;
  const def = WEAPONS[state.id];
  if (state.reloading || state.mag >= def.mag || state.reserve <= 0) return;
  state.reloading = true;
  state.reloadT = def.reload;
  match.events.push({ k: 'reload', actor });
}

// Per-step weapon handling for one actor. trigger: the actor wants to fire this step.
export function stepWeapon(match, actor, dt, trigger) {
  actor.switchT = Math.max(0, (actor.switchT || 0) - dt);
  const cur = actor.cur;
  if (GRENADES[cur]) {
    if (trigger && actor.switchT <= 0 && actor.inv[cur] > 0) {
      actor.inv[cur] -= 1;
      actor.switchT = 0.55;
      throwNade(match, actor, cur);
      actor.cur = actor.inv.primary ? 'primary' : 'sidearm';
      actor.switchT = 0.4;
    }
    return;
  }
  const state = actor.inv[cur];
  if (!state) return;
  const def = WEAPONS[state.id];
  state.cooldown -= dt;
  state.bloom = Math.max(0, state.bloom - def.recover * dt);
  if (!trigger) state.burst = 0;
  if (state.reloading) {
    state.reloadT -= dt;
    if (state.reloadT <= 0) {
      const need = def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
      state.reloading = false;
    }
    return;
  }
  if (!trigger || state.cooldown > 0 || actor.switchT > 0) return;
  if (state.mag <= 0) {
    state.cooldown = 0.28;
    match.events.push({ k: 'dry', actor });
    startReload(match, actor);
    return;
  }
  fireOne(match, actor, state, def);
}

export function throwNade(match, actor, kind) {
  const eye = eyeOf(actor);
  dirFromAngles(actor.yaw, actor.pitch + 0.06, _dir);
  match.nades.push({
    kind,
    x: actor.pos.x + _dir.x * 0.5, y: eye + 0.1, z: actor.pos.z + _dir.z * 0.5,
    vx: _dir.x * 15 + actor.vel.x * 0.4, vy: _dir.y * 15 + 2.2, vz: _dir.z * 15 + actor.vel.z * 0.4,
    fuse: kind === 'frag' ? 1.7 : kind === 'flash' ? 1.25 : 1.1,
    owner: actor,
    resting: 0,
  });
  match.events.push({ k: 'throw', actor });
  match.addNoise(actor.pos.x, actor.pos.z, 6, actor.team);
}

// Segment vs active smoke spheres: smoke blocks sight, never bullets.
export function smokeBlocks(match, ax, ay, az, bx, by, bz) {
  for (const s of match.smokes) {
    if (match.time > s.until) continue;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) continue;
    let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t - s.x;
    const py = ay + dy * t - s.y;
    const pz = az + dz * t - s.z;
    if (px * px + py * py + pz * pz < s.r * s.r) return true;
  }
  return false;
}

export function stepNades(match, dt) {
  const list = match.nades;
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    n.fuse -= dt;
    if (n.fuse <= 0) {
      list.splice(i, 1);
      detonate(match, n);
      continue;
    }
    n.vy -= 13.5 * dt;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    n.z += n.vz * dt;
    if (n.y < 0.1) {
      n.y = 0.1;
      n.vy = Math.abs(n.vy) > 1.4 ? -n.vy * 0.42 : 0;
      n.vx *= 0.72;
      n.vz *= 0.72;
      if (n.vy === 0) n.resting += dt;
      match.events.push({ k: 'bounce', x: n.x, y: n.y, z: n.z });
    }
    match.events.push({ k: 'nadepos', nade: n });
  }
}

function detonate(match, n) {
  if (n.kind === 'smoke') {
    match.smokes.push({ x: n.x, y: 1.1, z: n.z, r: 4.3, until: match.time + 15 });
    match.events.push({ k: 'smoke', x: n.x, y: n.y, z: n.z });
    return;
  }
  if (n.kind === 'flash') {
    match.events.push({ k: 'flashpop', x: n.x, y: n.y, z: n.z });
    for (const a of match.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - n.x, a.pos.z - n.z);
      if (d > 24) continue;
      const eye = eyeOf(a);
      const { losClear } = match.los;
      if (!losClear(n.x, n.y, n.z, a.pos.x, eye, a.pos.z)) continue;
      dirFromAngles(a.yaw, a.pitch, _dir);
      const fx = (n.x - a.pos.x) / (d || 1);
      const fz = (n.z - a.pos.z) / (d || 1);
      const facing = _dir.x * fx + _dir.z * fz;
      const strength = d < 3.5 ? 1 : facing;
      if (strength > 0.15) a.blindUntil = Math.max(a.blindUntil, match.time + 0.7 + 2.1 * strength * (1 - d / 26));
    }
    return;
  }
  // frag
  match.events.push({ k: 'explosion', x: n.x, y: n.y, z: n.z, big: false });
  match.addNoise(n.x, n.z, 40, null);
  for (const a of match.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.pos.x - n.x, a.pos.y + 0.6 - n.y, a.pos.z - n.z);
    if (d > 5.6) continue;
    const { losClear } = match.los;
    const clear = losClear(n.x, n.y + 0.3, n.z, a.pos.x, a.pos.y + 0.7, a.pos.z);
    const dmg = 92 * (1 - d / 5.6) * (clear ? 1 : 0.25);
    if (dmg < 4) continue;
    const dealt = applyDamage(a, dmg, 'body');
    if (a.isPlayer) match.events.push({ k: 'hurt', from: Math.atan2(n.x - a.pos.x, n.z - a.pos.z), dmg: dealt });
    if (n.owner?.isPlayer && a.team !== n.owner.team) match.events.push({ k: 'hitmark', kill: !a.alive, dmg: dealt });
    if (!a.alive && a.deathT < 0) {
      a.deathT = match.time;
      a.deaths += 1;
      if (n.owner && n.owner !== a) {
        n.owner.kills += 1;
        n.owner.money += 300;
      }
      match.onKill(n.owner, a, 'frag');
    }
  }
}
