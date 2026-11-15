// HARBOURLIGHT boot and the one loop: a fixed 60 Hz simulation (the Match) feeding
// rendering, HUD and sound at the display's rate. Before the player clicks in, a
// bot demo match plays behind the menu — the same code path, with a bot driving
// the player's body. ?shot=menu|combat|buy|end&seed=N poses a deterministic frame
// for screenshots and sets window.__shotReady when it is painted.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { buildMap, SITES } from './map.js';
import { Match } from './match.js';
import { Input } from './input.js';
import { Hud, BUY_ITEMS } from './hud.js';
import { Fx, buildViewmodel } from './fx.js';
import { WEAPONS, GRENADES, makeWeaponState, spreadOf, startReload, stepWeapon } from './weapons.js';
import { eyeOf } from './actors.js';
import * as SFX from './audio.js';

const FIXED = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!shot });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x93a7ba, 0x2c3138, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb36b, 2.0);
sun.position.set(-34, 40, -20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -46;
sun.shadow.camera.right = 46;
sun.shadow.camera.top = 46;
sun.shadow.camera.bottom = -46;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0006;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x6f87a0, 0.35);
fill.position.set(30, 24, 30);
scene.add(fill);

buildMap(scene);
const fx = new Fx(scene);
const viewmodel = buildViewmodel();
camera.add(viewmodel.group);

let match = new Match(seed, true);
let playing = false;
const hud = new Hud();
hud.onBuyRequest = (item) => {
  if (match.buy(match.player, item)) SFX.sfxBuy();
  else SFX.sfxDenied();
};

const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const endEl = document.getElementById('end-screen');
const input = new Input(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    menuEl.hidden = true;
    pauseEl.style.display = 'none';
    playing = true;
  } else if (playing && match.phase !== 'matchEnd') {
    pauseEl.style.display = 'grid';
  }
});
document.getElementById('play-btn').addEventListener('click', () => {
  SFX.initAudio();
  startLiveMatch();
  input.requestLock();
});
document.getElementById('again-btn').addEventListener('click', () => {
  endEl.hidden = true;
  startLiveMatch();
  input.requestLock();
});
pauseEl.addEventListener('click', () => input.requestLock());

function startLiveMatch() {
  match = new Match((Date.now() % 100000) + 11, false);
  hud.buyWanted = true;
  viewmodel.setKind('pistol');
}

let lastHurtSfx = 0;
function consumeEvents() {
  const cam = camera.position;
  for (const ev of match.events) {
    fx.handle(match, ev, viewmodel);
    switch (ev.k) {
      case 'shot': {
        if (ev.first === false) break;
        const d = Math.hypot(ev.x - cam.x, ev.z - cam.z);
        SFX.sfxShot(ev.kind, d);
        if (match.player.alive && d < 0.8) viewmodel.flashT = 0.05;
        break;
      }
      case 'hitmark':
        hud.hitMarker(ev.kill);
        SFX.sfxHit(ev.kill);
        break;
      case 'hurt':
        hud.hurt(ev.from, match.player.yaw);
        if (match.time - lastHurtSfx > 0.12) {
          SFX.sfxHurt();
          lastHurtSfx = match.time;
        }
        break;
      case 'reload':
        if (ev.actor === match.player) SFX.sfxReload();
        break;
      case 'dry':
        if (ev.actor === match.player) SFX.sfxDryFire();
        break;
      case 'throw':
        if (ev.actor === match.player) SFX.sfxThrow();
        break;
      case 'bounce': {
        const d = Math.hypot(ev.x - cam.x, ev.z - cam.z);
        if (d < 20) SFX.sfxBounce(d);
        break;
      }
      case 'explosion':
        SFX.sfxExplosion(Math.hypot(ev.x - cam.x, ev.z - cam.z));
        break;
      case 'flashpop':
        SFX.sfxFlashPop(Math.hypot(ev.x - cam.x, ev.z - cam.z));
        break;
      case 'beep':
        SFX.sfxBeep(ev.final);
        break;
      case 'planted':
        SFX.sfxBeep(true);
        break;
      case 'roundStart':
        SFX.sfxRoundStart();
        hud.buyWanted = false;
        break;
      case 'roundSetup':
        if (!match.demo) hud.buyWanted = true;
        break;
      case 'roundEnd':
        SFX.sfxSting(ev.winner === 'atk');
        break;
      case 'matchEnd':
        if (match.demo) match = new Match((seed * 31 + match.round * 7) % 100000, true);
        else showEnd();
        break;
      default:
        break;
    }
  }
  match.events.length = 0;
}

function showEnd() {
  const p = match.player;
  const won = match.matchWinner === 'atk';
  document.getElementById('end-title').textContent = won ? 'BREAKERS TAKE THE YARD' : 'WARDENS HOLD THE YARD';
  document.getElementById('end-sub').textContent =
    `Final score ${match.scores.atk}–${match.scores.def}. You finished with ${p.kills} kills and ${p.deaths} deaths over ${match.round} rounds.`;
  endEl.hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

const SLOT_KEYS = { Digit1: 'primary', Digit2: 'sidearm', Digit4: 'frag', Digit5: 'smoke', Digit6: 'flash' };
function handlePressed(code) {
  const p = match.player;
  if (match.demo || !p.alive) return;
  if (code === 'KeyB' && match.phase === 'buy') {
    hud.buyWanted = !hud.buyWanted;
    return;
  }
  if (match.phase === 'buy' && hud.buyWanted && /^Digit[1-8]$/.test(code)) {
    const entry = BUY_ITEMS[Number(code.slice(5)) - 1];
    if (entry) hud.onBuyRequest(entry.item);
    return;
  }
  if (code === 'KeyR') {
    startReload(match, p);
    return;
  }
  const slot = SLOT_KEYS[code];
  if (slot) {
    if (slot === 'primary' && !p.inv.primary) return;
    if (GRENADES[slot] && p.inv[slot] <= 0) return;
    if (p.cur !== slot) {
      p.cur = slot;
      p.switchT = 0.32;
      const kind = slot === 'primary' ? WEAPONS[p.inv.primary.id].kind : slot === 'sidearm' ? 'pistol' : null;
      if (kind) viewmodel.setKind(kind);
    }
  }
}

function drivePlayer() {
  const p = match.player;
  const look = input.takeLook();
  if (input.locked && p.alive) {
    p.yaw -= look.x * 0.0021;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - look.y * 0.0021));
  }
  const f = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
  const r = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  p.input.mx = -sy * f + cy * r;
  p.input.mz = -cy * f - sy * r;
  p.input.jump = input.keys.has('Space');
  p.input.crouch = input.crouchHeld;
  p.input.walk = input.walkHeld;
  p.input.fire = input.firing && input.locked && p.alive;
  p.input.channel = input.channelHeld && p.alive;
  for (const code of input.drainPressed()) handlePressed(code);
}

let bobPhase = 0;
function syncCamera(dt) {
  const p = match.player;
  const kickP = p.kickP || 0;
  const kickY = p.kickY || 0;
  bobPhase += p.speed2d * dt * 1.7;
  const bob = Math.sin(bobPhase) * 0.028 * Math.min(1, p.speed2d / 4);
  const shake = fx.shake;
  camera.position.set(
    p.pos.x + (Math.random() - 0.5) * shake * 0.05,
    eyeOf(p) + bob + (Math.random() - 0.5) * shake * 0.05,
    p.pos.z,
  );
  camera.rotation.set(p.pitch + kickP, p.yaw + kickY, 0, 'YXZ');
  // Weapon view: kickback, bob and reload dip.
  const state = p.inv[p.cur];
  const reloading = state && state.reloading ? 1 : 0;
  viewmodel.group.position.set(
    0.24 + Math.sin(bobPhase * 0.5) * 0.006 * Math.min(1, p.speed2d / 4),
    -0.22 + Math.abs(Math.cos(bobPhase)) * 0.008 * Math.min(1, p.speed2d / 4) - reloading * 0.14,
    -0.45 + kickP * 1.4,
  );
  viewmodel.group.rotation.x = kickP * 1.8 + reloading * 0.5;
  viewmodel.flash.material.opacity = viewmodel.flashT > 0 ? 0.9 : 0;
  viewmodel.flash.rotation.z = Math.random() * 3;
  // DMR scope
  const def = WEAPONS[p.cur === 'primary' ? p.inv.primary?.id : p.cur];
  const scoped = !!(def && def.zoom && input.aiming && input.locked && p.alive);
  const targetFov = scoped ? 74 / def.zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.2) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  hud.setScoped(scoped);
  viewmodel.group.visible = !scoped && p.alive;
}

function decayKicks(dt) {
  const f = Math.exp(-8.5 * dt);
  for (const a of match.actors) {
    a.kickP = (a.kickP || 0) * f;
    a.kickY = (a.kickY || 0) * f;
  }
  viewmodel.flashT = Math.max(0, viewmodel.flashT - dt);
}

let accumulator = 0;
let lastTime = performance.now();
let shotCam = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.5);
  lastTime = now;
  if (!match.demo) drivePlayer();
  else input.drainPressed();
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED && steps < 30) {
    match.step(FIXED);
    accumulator -= FIXED;
    steps += 1;
  }
  if (accumulator > FIXED * 30) accumulator = 0;
  consumeEvents();
  decayKicks(dt);
  fx.syncBodies(match, dt);
  fx.syncProps(match);
  fx.step(dt);
  if (shotCam) {
    camera.position.copy(shotCam.pos);
    camera.lookAt(shotCam.look);
  } else {
    syncCamera(dt);
  }
  // Crosshair bloom mirrors the true spread of the held weapon.
  const p = match.player;
  const state = p.inv[p.cur];
  const def = state ? WEAPONS[state.id] : null;
  if (def && state) hud.setCrosshairSpread(4 + spreadOf(def, p, state.bloom) * 620);
  hud.update(match, dt, input);
  renderer.render(scene, camera);
}

function settle(n) {
  for (let i = 0; i < n; i++) match.step(FIXED);
  consumeEvents();
}

function poseShot(name) {
  hud.buyWanted = false;
  if (name === 'menu') {
    match = new Match(seed, true);
    settle(60 * 26);
    if (match.player.mesh) match.player.mesh.visible = true;
    shotCam = { pos: new THREE.Vector3(-26, 4.4, 13), look: new THREE.Vector3(12, 0.8, -8) };
    menuEl.hidden = false;
    return;
  }
  menuEl.hidden = true;
  if (name === 'combat') {
    match = new Match(seed, false);
    const p = match.player;
    p.inv.primary = makeWeaponState('vk7');
    p.cur = 'primary';
    p.armorPts = 45;
    p.hp = 72;
    p.money = 1350;
    viewmodel.setKind('rifle');
    match.phase = 'live';
    match.round = 5;
    match.scores.atk = 3;
    match.scores.def = 2;
    match.roundTime = 47;
    p.pos.x = -6;
    p.pos.z = -6.5;
    p.pos.y = 0;
    const foe = match.actors[5];
    foe.pos.x = 4;
    foe.pos.z = -6;
    foe.pos.y = 0;
    foe.yaw = 0.4;
    const foe2 = match.actors[8];
    foe2.pos.x = 14;
    foe2.pos.z = -8;
    foe2.pos.y = 0;
    foe2.yaw = -0.4;
    const mate = match.actors[2];
    mate.pos.x = -10;
    mate.pos.z = -7.5;
    mate.pos.y = 0;
    mate.yaw = -1.2;
    p.yaw = Math.atan2(-(foe.pos.x - p.pos.x), -(foe.pos.z - p.pos.z));
    p.pitch = Math.atan2(1.15 - eyeOf(p), Math.hypot(foe.pos.x - p.pos.x, foe.pos.z - p.pos.z));
    settle(2);
    stepWeapon(match, p, FIXED, true);
    settle(1);
    hud.hitMarker(false);
    return;
  }
  if (name === 'buy') {
    match = new Match(seed, false);
    const p = match.player;
    match.round = 2;
    p.money = 4350;
    p.inv.primary = makeWeaponState('vk7');
    p.cur = 'primary';
    hud.buyWanted = true;
    settle(2);
    return;
  }
  if (name === 'end') {
    match = new Match(seed, false);
    match.scores.atk = 7;
    match.scores.def = 4;
    match.round = 11;
    match.matchWinner = 'atk';
    match.phase = 'matchEnd';
    const tally = [[9, 3], [7, 5], [6, 6], [5, 4], [4, 7], [6, 5], [5, 6], [4, 8], [3, 7], [2, 9]];
    match.actors.forEach((a, i) => {
      a.kills = tally[i][0];
      a.deaths = tally[i][1];
    });
    settle(2);
    showEnd();
    return;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) {
  poseShot(shot);
  fx.syncBodies(match, 0.016);
  if (shot === 'menu' && match.player.mesh) match.player.mesh.visible = true;
  if (shot === 'end') document.getElementById('scoreboard').style.display = 'none';
  fx.syncProps(match);
  if (!shotCam) syncCamera(0.016);
  else {
    camera.position.copy(shotCam.pos);
    camera.lookAt(shotCam.look);
  }
  hud.update(match, 0.016, input);
  renderer.render(scene, camera);
  window.__shotReady = true;
} else {
  requestAnimationFrame(frame);
}
