// The view layer: character bodies with walk cycles, the first-person viewmodel,
// tracers, muzzle flashes, impact sparks, smoke clouds, grenade and charge props.
// Everything here is pooled — the hot loop reuses meshes instead of allocating.
import * as THREE from 'three';
import { PALETTE, TEAMS } from './palette.js';
import { eyeOf } from './actors.js';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function part(group, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  group.add(m);
  return m;
}

const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.9 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.45, metalness: 0.6 });
const teamMats = {
  atk: new THREE.MeshStandardMaterial({ color: PALETTE.atk, roughness: 0.75 }),
  def: new THREE.MeshStandardMaterial({ color: PALETTE.def, roughness: 0.75 }),
};

export function buildBody(team) {
  const g = new THREE.Group();
  const upper = new THREE.Group();
  g.add(upper);
  const tm = teamMats[team];
  const legL = part(g, darkMat, 0.17, 0.78, 0.2, -0.13, 0.39, 0);
  const legR = part(g, darkMat, 0.17, 0.78, 0.2, 0.13, 0.39, 0);
  legL.geometry = boxGeo;
  // Pivot legs at the hip: wrap each leg mesh in a group positioned at hip height.
  const hipL = new THREE.Group();
  const hipR = new THREE.Group();
  hipL.position.set(-0.13, 0.8, 0);
  hipR.position.set(0.13, 0.8, 0);
  g.remove(legL);
  g.remove(legR);
  legL.position.set(0, -0.39, 0);
  legR.position.set(0, -0.39, 0);
  hipL.add(legL);
  hipR.add(legR);
  g.add(hipL, hipR);
  part(upper, tm, 0.54, 0.64, 0.3, 0, 1.12, 0);                    // torso
  part(upper, darkMat, 0.4, 0.3, 0.18, 0, 1.08, 0.22);             // back pack
  part(upper, skinMat, 0.24, 0.26, 0.24, 0, 1.56, 0);              // head
  part(upper, tm, 0.27, 0.1, 0.27, 0, 1.68, 0);                    // helmet band
  const armL = part(upper, tm, 0.13, 0.52, 0.13, -0.34, 1.14, -0.12);
  const armR = part(upper, tm, 0.13, 0.52, 0.13, 0.34, 1.14, -0.12);
  armL.rotation.x = -0.9;
  armR.rotation.x = -1.15;
  const gun = part(upper, gunMat, 0.09, 0.14, 0.78, 0.12, 1.22, -0.42);
  return { group: g, upper, hipL, hipR, gun, phase: Math.random() * 6 };
}

const GUN_SHAPES = {
  pistol: [0.07, 0.16, 0.3], smg: [0.08, 0.2, 0.52], shotgun: [0.09, 0.18, 0.72],
  rifle: [0.08, 0.22, 0.78], dmr: [0.08, 0.2, 0.98],
};
export function buildViewmodel() {
  const g = new THREE.Group();
  const gun = new THREE.Mesh(boxGeo, gunMat);
  gun.castShadow = false;
  const barrel = new THREE.Mesh(boxGeo, darkMat);
  const grip = new THREE.Mesh(boxGeo, darkMat);
  g.add(gun, barrel, grip);
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const grad = x.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.25, 'rgba(255,180,80,0.85)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = grad;
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(255,220,160,0.9)';
    x.fillRect(58, 4, 12, 120);
    x.fillRect(4, 58, 120, 12);
    return new THREE.CanvasTexture(c);
  })();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  g.add(flash);
  g.position.set(0.24, -0.22, -0.45);
  return {
    group: g,
    flash,
    flashT: 0,
    setKind(kind) {
      const [w, h, d] = GUN_SHAPES[kind] || GUN_SHAPES.rifle;
      gun.scale.set(w, h, d);
      gun.position.set(0, 0, -d / 2);
      barrel.scale.set(w * 0.45, h * 0.4, 0.22);
      barrel.position.set(0, h * 0.22, -d - 0.08);
      grip.scale.set(w * 0.8, 0.16, 0.09);
      grip.position.set(0, -0.13, -0.1);
      grip.rotation.x = 0.5;
      flash.position.set(0, h * 0.22, -d - 0.22);
    },
  };
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.bodies = new Map();
    this.tracers = [];
    this.sparks = [];
    this.smokes = new Map();
    this.nadeMeshes = new Map();
    this.flashLight = new THREE.PointLight(0xffc46b, 0, 18, 1.8);
    scene.add(this.flashLight);
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 40; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, tracerMat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb35c });
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), sparkMat);
      m.visible = false;
      scene.add(m);
      this.sparks.push({ m, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa4ab, transparent: true, opacity: 0.52, roughness: 1, depthWrite: false });
    this.nadeMat = new THREE.MeshStandardMaterial({ color: 0x30363c, roughness: 0.5, metalness: 0.4 });
    this.chargeMesh = this.buildCharge();
    scene.add(this.chargeMesh);
    this.shake = 0;
  }

  buildCharge() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x8a3324, roughness: 0.6 }));
    body.scale.set(0.42, 0.3, 0.16);
    body.position.y = 0.15;
    body.castShadow = true;
    const lamp = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff4030 }));
    lamp.scale.set(0.07, 0.07, 0.07);
    lamp.position.set(0.12, 0.34, 0);
    g.add(body, lamp);
    g.userData.lamp = lamp;
    g.visible = false;
    return g;
  }

  ensureBody(actor) {
    if (!this.bodies.has(actor.id)) {
      const body = buildBody(actor.team);
      actor.mesh = body.group;
      this.scene.add(body.group);
      this.bodies.set(actor.id, body);
    }
    return this.bodies.get(actor.id);
  }

  syncBodies(match, dt) {
    for (const actor of match.actors) {
      const body = this.ensureBody(actor);
      const g = body.group;
      g.visible = !actor.isPlayer;
      g.position.set(actor.pos.x, actor.pos.y, actor.pos.z);
      g.rotation.y = actor.yaw;
      if (!actor.alive) {
        const t = Math.min(1, (match.time - Math.max(actor.deathT, 0)) / 0.4);
        g.rotation.x = -Math.PI / 2 * Math.max(0, t);
        g.position.y = actor.pos.y + 0.12 * Math.max(0, t);
        continue;
      }
      g.rotation.x = 0;
      body.phase += actor.speed2d * dt * 2.1;
      const swing = Math.sin(body.phase) * 0.5 * Math.min(1, actor.speed2d / 4);
      body.hipL.rotation.x = swing;
      body.hipR.rotation.x = -swing;
      body.upper.position.y = actor.crouch ? -0.42 : 0;
      body.upper.rotation.x = actor.pitch * 0.55;
      if (actor.blindUntil > match.time) body.upper.rotation.y = Math.sin(match.time * 7 + actor.id) * 0.2;
      else body.upper.rotation.y = 0;
    }
  }

  tracer(x, y, z, tx, ty, tz) {
    const slot = this.tracers.find((t) => t.life <= 0);
    if (!slot) return;
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, x, y, z);
    pos.setXYZ(1, tx, ty, tz);
    pos.needsUpdate = true;
    slot.line.visible = true;
    slot.life = 0.055;
  }

  spark(x, y, z, n = 3) {
    for (let i = 0; i < n; i++) {
      const slot = this.sparks.find((s) => s.life <= 0);
      if (!slot) return;
      slot.m.position.set(x, y, z);
      slot.vx = (Math.random() - 0.5) * 2.4;
      slot.vy = Math.random() * 2.2;
      slot.vz = (Math.random() - 0.5) * 2.4;
      slot.life = 0.32;
      slot.m.visible = true;
    }
  }

  boom(x, y, z, big) {
    this.flashLight.position.set(x, y + 0.6, z);
    this.flashLight.intensity = big ? 260 : 120;
    this.spark(x, y + 0.3, z, big ? 12 : 6);
    this.shake = Math.min(0.5, this.shake + (big ? 0.34 : 0.15));
  }

  handle(match, ev, viewmodel) {
    switch (ev.k) {
      case 'shot': {
        this.tracer(ev.x, ev.y, ev.z, ev.tx, ev.ty, ev.tz);
        if (ev.hitActor) this.spark(ev.tx, ev.ty, ev.tz, 2);
        else this.spark(ev.tx, ev.ty, ev.tz, 3);
        break;
      }
      case 'explosion':
        this.boom(ev.x, ev.y, ev.z, ev.big);
        break;
      case 'flashpop':
        this.flashLight.position.set(ev.x, ev.y + 0.4, ev.z);
        this.flashLight.intensity = 160;
        break;
      default:
        break;
    }
    void viewmodel;
  }

  syncProps(match) {
    // Grenade meshes follow the simulated projectiles.
    const seen = new Set();
    for (const n of match.nades) {
      seen.add(n);
      if (!this.nadeMeshes.has(n)) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.nadeMat);
        m.castShadow = true;
        this.scene.add(m);
        this.nadeMeshes.set(n, m);
      }
      this.nadeMeshes.get(n).position.set(n.x, n.y, n.z);
    }
    for (const [n, m] of this.nadeMeshes) {
      if (!seen.has(n)) {
        this.scene.remove(m);
        this.nadeMeshes.delete(n);
      }
    }
    // Smoke clouds follow the simulated smoke volumes.
    const seenSmoke = new Set();
    for (const s of match.smokes) {
      if (match.time > s.until) continue;
      seenSmoke.add(s);
      if (!this.smokes.has(s)) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), this.smokeMat);
        this.scene.add(m);
        this.smokes.set(s, m);
      }
      const m = this.smokes.get(s);
      const age = match.time - (s.until - 15);
      const grow = Math.min(1, age / 1.1);
      const fade = Math.min(1, (s.until - match.time) / 2);
      m.scale.setScalar(Math.max(0.2, s.r * grow));
      m.material = this.smokeMat;
      m.position.set(s.x, s.y + 0.4, s.z);
      m.visible = fade > 0.02;
    }
    for (const [s, m] of this.smokes) {
      if (!seenSmoke.has(s)) {
        this.scene.remove(m);
        this.smokes.delete(s);
      }
    }
    // The charge: carried charges ride on the carrier's back, dropped/planted sit on the ground.
    const c = match.charge;
    const mesh = this.chargeMesh;
    if (c.state === 'carried' && c.carrier) {
      mesh.visible = !c.carrier.isPlayer;
      mesh.position.set(c.carrier.pos.x, c.carrier.pos.y + 1.15, c.carrier.pos.z);
      mesh.rotation.y = c.carrier.yaw;
    } else if (c.state === 'dropped' || c.state === 'planted') {
      mesh.visible = true;
      mesh.position.set(c.x, c.groundY || 0, c.z);
      mesh.rotation.y = c.rot || 0;
      const blinkRate = c.state === 'planted' ? (c.detonateAt - match.time < 10 ? 9 : 3) : 1.5;
      mesh.userData.lamp.material.color.setHex(Math.sin(match.time * blinkRate * Math.PI) > 0 ? 0xff4030 : 0x551512);
    } else {
      mesh.visible = false;
    }
  }

  step(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        s.m.position.x += s.vx * dt;
        s.m.position.y += s.vy * dt;
        s.m.position.z += s.vz * dt;
        s.vy -= 7 * dt;
        s.m.scale.setScalar(Math.max(0.2, s.life / 0.32));
        if (s.life <= 0) s.m.visible = false;
      }
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 900);
    this.shake = Math.max(0, this.shake - dt * 1.4);
  }
}

export { TEAMS, eyeOf };
