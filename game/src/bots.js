// Bot brains: a think tick every ~0.1 s per bot (staggered) drives perception,
// route following on the waypoint graph, engagement discipline and objective play.
// Bots see through line-of-sight and smoke, hear gunfire the match broadcasts, react
// with a human-like delay, aim with error that settles the longer they track a
// target, and fire in bursts — they stop to shoot, because moving ruins accuracy
// for them exactly as it does for the player.
import { NODES, buildGraph, findPath, nearestNode, losClear, SITES, HOLDS } from './map.js';
import { eyeOf } from './actors.js';
import { dirFromAngles, smokeBlocks, startReload } from './weapons.js';
import { angleLerp, clamp, dist2d } from './rng.js';

const graph = buildGraph();
const _dir = { x: 0, y: 0, z: 0 };

export function makeBrain(rng, role) {
  return {
    role,
    thinkT: rng.range(0, 0.1),
    route: [],
    ri: 0,
    goalNode: -1,
    seen: null,
    seenSince: -9,
    reactAt: 0,
    lastKnown: null,
    lastKnownT: -9,
    burstLeft: 0,
    pauseUntil: 0,
    aimErr: 0.05,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    scanYaw: 0,
    scanT: 0,
    holdNode: -1,
    nadeUsed: false,
    executeSmoked: false,
  };
}

function visible(match, me, foe) {
  const eye = eyeOf(me);
  const dx = foe.pos.x - me.pos.x;
  const dz = foe.pos.z - me.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 62) return false;
  dirFromAngles(me.yaw, 0, _dir);
  const facing = dist < 6 ? 1 : (_dir.x * dx + _dir.z * dz) / (dist || 1);
  if (facing < -0.25) return false; // not even in peripheral view
  const ty = foe.pos.y + 1.12;
  if (!losClear(me.pos.x, eye, me.pos.z, foe.pos.x, ty, foe.pos.z)) return false;
  if (smokeBlocks(match, me.pos.x, eye, me.pos.z, foe.pos.x, ty, foe.pos.z)) return false;
  return true;
}

function setRoute(match, me, goalNode) {
  const b = me.bot;
  if (b.goalNode === goalNode && b.route.length) return;
  b.goalNode = goalNode;
  b.route = findPath(graph, nearestNode(me.pos.x, me.pos.z), goalNode);
  b.ri = 0;
}

function followRoute(me, input, speedWalk = false) {
  const b = me.bot;
  while (b.ri < b.route.length) {
    const [nx, nz] = NODES[b.route[b.ri]];
    if (dist2d(me.pos.x, me.pos.z, nx, nz) < 1.0) b.ri += 1;
    else break;
  }
  if (b.ri >= b.route.length) return true;
  const [nx, nz] = NODES[b.route[b.ri]];
  input.mx = nx - me.pos.x;
  input.mz = nz - me.pos.z;
  input.walk = speedWalk;
  const targetYaw = Math.atan2(-input.mx, -input.mz);
  me.yaw = angleLerp(me.yaw, targetYaw, 0.22);
  me.pitch = angleLerp(me.pitch, 0, 0.2);
  return false;
}

function engage(match, me, input, foe, dt) {
  const b = me.bot;
  const dist = dist2d(me.pos.x, me.pos.z, foe.pos.x, foe.pos.z);
  // Aim at the chest, drifting toward the head at close range with a rifle.
  const aimY = foe.pos.y + (dist < 16 && me.cur === 'primary' ? 1.34 : 1.12);
  const eye = eyeOf(me);
  const targetYaw = Math.atan2(-(foe.pos.x - me.pos.x), -(foe.pos.z - me.pos.z));
  const targetPitch = Math.atan2(aimY - eye, dist);
  b.aimErr = Math.max(0.013, b.aimErr - dt * 0.028);
  const errYaw = Math.sin(match.time * 2.7 + me.id * 3.1) * b.aimErr;
  const errPitch = Math.cos(match.time * 3.1 + me.id * 1.7) * b.aimErr * 0.7;
  me.yaw = angleLerp(me.yaw, targetYaw + errYaw, Math.min(1, dt * 11));
  me.pitch = angleLerp(me.pitch, targetPitch + errPitch, Math.min(1, dt * 11));
  // Bots plant their feet to shoot; at long range they may shuffle sideways between bursts.
  if (match.time < b.pauseUntil && dist > 15) {
    input.mx = Math.cos(me.yaw) * (me.id % 2 ? 1 : -1);
    input.mz = -Math.sin(me.yaw) * (me.id % 2 ? 1 : -1);
    input.walk = true;
  }
  input.crouch = dist > 20 && me.id % 3 === 0;
  if (match.time < b.reactAt) return;
  const state = me.inv[me.cur];
  if (state && state.mag === 0) {
    startReload(match, me);
    return;
  }
  if (match.time < b.pauseUntil) return;
  if (b.burstLeft <= 0) b.burstLeft = match.rng.int(3, 5);
  input.fire = true;
  if (state) {
    if (b.lastMag !== undefined && state.mag < b.lastMag) b.burstLeft -= b.lastMag - state.mag;
    b.lastMag = state.mag;
  }
  if (b.burstLeft <= 0) b.pauseUntil = match.time + match.rng.range(0.3, 0.62);
}

function holdPosition(match, me, input, node) {
  const b = me.bot;
  const [hx, hz] = NODES[node];
  if (dist2d(me.pos.x, me.pos.z, hx, hz) > 1.1) {
    setRoute(match, me, node);
    followRoute(me, input);
    return;
  }
  b.scanT -= 1 / 60;
  if (b.scanT <= 0) {
    b.scanT = match.rng.range(1.2, 2.6);
    b.scanYaw = me.yaw + match.rng.range(-1.1, 1.1);
  }
  me.yaw = angleLerp(me.yaw, b.scanYaw, 0.05);
  input.crouch = me.id % 2 === 0;
}

export function stepBot(match, me, dt) {
  const b = me.bot;
  const input = me.input;
  input.mx = 0;
  input.mz = 0;
  input.fire = false;
  input.jump = false;
  input.walk = false;
  input.crouch = false;
  input.channel = false;
  if (!me.alive || match.phase === 'buy' || match.phase === 'roundEnd' || match.phase === 'matchEnd') return;

  b.thinkT -= dt;
  const thinking = b.thinkT <= 0;
  if (thinking) {
    b.thinkT = 0.1;
    // Perception
    let foe = null;
    for (const other of match.actors) {
      if (other.team === me.team || !other.alive) continue;
      if (visible(match, me, other)) {
        foe = other;
        break;
      }
    }
    if (foe) {
      if (b.seen !== foe) {
        b.seen = foe;
        b.seenSince = match.time;
        b.reactAt = match.time + match.rng.range(0.26, 0.46);
        b.aimErr = 0.055;
      }
      b.lastKnown = { x: foe.pos.x, z: foe.pos.z };
      b.lastKnownT = match.time;
    } else if (b.seen && match.time - b.lastKnownT > 1.1) {
      b.seen = null;
    }
    // Hearing: fresh enemy noise pulls attention to its square.
    if (!b.seen) {
      for (const n of match.noises) {
        if (n.team === me.team || match.time - n.t > 0.6) continue;
        if (dist2d(me.pos.x, me.pos.z, n.x, n.z) < n.r) {
          b.lastKnown = { x: n.x, z: n.z };
          b.lastKnownT = match.time;
        }
      }
    }
    // Stuck detection
    if (Math.hypot(me.pos.x - b.lastX, me.pos.z - b.lastZ) < 0.05 && (input.mx || input.mz)) b.stuckT += 0.1;
    else b.stuckT = 0;
    b.lastX = me.pos.x;
    b.lastZ = me.pos.z;
  }
  if (b.stuckT > 0.7) {
    input.jump = true;
    b.stuckT = 0;
  }

  // Weapon selection: grenade trick first, then the best gun in hand.
  if (b.pendingNade && !b.seen) {
    me.cur = b.pendingNade;
    input.fire = true;
    b.pendingNade = null;
    return;
  }
  if (me.cur !== 'primary' && me.cur !== 'sidearm') me.cur = me.inv.primary ? 'primary' : 'sidearm';
  if (!me.inv[me.cur]) me.cur = 'sidearm';

  if (b.seen) {
    engage(match, me, input, b.seen, dt);
    return;
  }
  b.aimErr = 0.055;

  const charge = match.charge;
  if (me.team === 'atk') stepAttacker(match, me, input, thinking);
  else stepDefender(match, me, input, thinking);

  // Investigate a heard contact: decided on think ticks, then steered to briefly.
  if (thinking && !b.seen && b.lastKnown && match.time - b.lastKnownT < 3.5 && charge.state !== 'planted' && match.rng.chance(0.45)) {
    b.invest = { x: b.lastKnown.x, z: b.lastKnown.z, until: match.time + 3 };
  }
  if (b.invest && match.time < b.invest.until && charge.state !== 'planted') {
    if (dist2d(me.pos.x, me.pos.z, b.invest.x, b.invest.z) > 3) {
      input.mx = b.invest.x - me.pos.x;
      input.mz = b.invest.z - me.pos.z;
      me.yaw = angleLerp(me.yaw, Math.atan2(-input.mx, -input.mz), 0.2);
    } else {
      b.invest = null;
    }
  }
}

function stepAttacker(match, me, input, thinking) {
  const b = me.bot;
  const charge = match.charge;
  const site = SITES[match.planSite];
  const siteNode = match.planSite === 'A' ? 9 : 17;

  if (charge.state === 'planted') {
    // Fall back and guard the charge from the site's hold points.
    const holds = HOLDS[match.planSite];
    holdPosition(match, me, input, holds[me.id % holds.length]);
    return;
  }
  if (charge.state === 'dropped') {
    // Nearest attacker recovers the charge.
    let nearest = null;
    let nd = Infinity;
    for (const a of match.actors) {
      if (a.team !== 'atk' || !a.alive || a.isPlayer) continue;
      const d = dist2d(a.pos.x, a.pos.z, charge.x, charge.z);
      if (d < nd) {
        nd = d;
        nearest = a;
      }
    }
    if (nearest === me) {
      input.mx = charge.x - me.pos.x;
      input.mz = charge.z - me.pos.z;
      me.yaw = angleLerp(me.yaw, Math.atan2(-input.mx, -input.mz), 0.22);
      return;
    }
  }
  if (charge.carrier === me) {
    // Carry it in; plant when the site is reached and no contact is fresh.
    if (me.pos.x > site.x0 && me.pos.x < site.x1 && me.pos.z > site.z0 && me.pos.z < site.z1) {
      if (match.time - b.lastKnownT > 2.2 || dist2d(me.pos.x, me.pos.z, site.cx, site.cz) < 2) {
        input.mx = site.cx - me.pos.x;
        input.mz = site.cz - me.pos.z;
        if (dist2d(me.pos.x, me.pos.z, site.cx, site.cz) < 1.6) {
          input.mx = 0;
          input.mz = 0;
          input.channel = true;
          me.yaw = angleLerp(me.yaw, me.team === 'atk' ? -Math.PI / 2 : 0, 0.1);
        }
        return;
      }
    }
    setRoute(match, me, siteNode);
    followRoute(me, input);
    return;
  }
  if (b.role === 'lurk') {
    const other = match.planSite === 'A' ? 17 : 9;
    if (match.time < 34) holdPosition(match, me, input, HOLDS.mid[0]);
    else {
      setRoute(match, me, other);
      followRoute(me, input, true);
    }
    return;
  }
  if (b.role === 'support' && !b.executeSmoked && me.inv.smoke > 0) {
    const linkNode = match.planSite === 'A' ? 7 : 15;
    if (dist2d(me.pos.x, me.pos.z, NODES[linkNode][0], NODES[linkNode][1]) < 2.5) {
      b.executeSmoked = true;
      b.pendingNade = 'smoke';
      me.yaw = Math.atan2(-(site.cx - me.pos.x), -(site.cz - me.pos.z));
      me.pitch = 0.12;
    }
  }
  setRoute(match, me, siteNode);
  followRoute(me, input);
}

function stepDefender(match, me, input) {
  const b = me.bot;
  const charge = match.charge;
  if (charge.state === 'planted') {
    const site = SITES[charge.site];
    if (dist2d(me.pos.x, me.pos.z, charge.x, charge.z) < 1.7) {
      // One disarms while the rest cover: the closest defender takes the kit role.
      let nearest = null;
      let nd = Infinity;
      for (const a of match.actors) {
        if (a.team !== 'def' || !a.alive) continue;
        const d = dist2d(a.pos.x, a.pos.z, charge.x, charge.z);
        if (d < nd) {
          nd = d;
          nearest = a;
        }
      }
      if (nearest === me && match.time - b.lastKnownT > 1.2) {
        input.channel = true;
        input.crouch = true;
        return;
      }
    }
    setRoute(match, me, charge.site === 'A' ? 9 : 17);
    followRoute(me, input);
    return;
  }
  // Hold the assigned post; rotate a spare holder toward fresh contact on the other site.
  let node = b.holdNode;
  if (b.role === 'mid') node = HOLDS.mid[me.id % HOLDS.mid.length];
  holdPosition(match, me, input, node);
}
