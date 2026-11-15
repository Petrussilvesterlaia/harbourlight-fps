// The match: one state object, stepped at a fixed 60 Hz. It owns the round flow
// (buy -> live -> planted -> round end), the economy, the breach charge, noise
// broadcasts that bots hear, and every event the view and sound layers consume.
// Rendering and DOM live elsewhere; this file is the whole simulation's home.
import { SPAWNS, SITES, HOLDS, losClear } from './map.js';
import { createActor, stepMovement, inSite, supportHeight } from './actors.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, ARMOR_POINTS, makeWeaponState, stepWeapon, stepNades } from './weapons.js';
import { makeBrain, stepBot } from './bots.js';
import { Rng } from './rng.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 20;
export const PLANT_TIME = 3.2;
export const DISARM_TIME = 5;
export const DETONATE_TIME = 40;
export const WIN_SCORE = 7;

const ATK_NAMES = ['Vex', 'Marlow', 'Ilya', 'Sable'];
const DEF_NAMES = ['Ondine', 'Ferro', 'Kaspar', 'Wren', 'Holt'];
const ATK_ROLES = ['entry', 'entry', 'support', 'lurk'];

export class Match {
  constructor(seed, demo = false) {
    this.rng = new Rng(seed);
    this.demo = demo;
    this.time = 0;
    this.actors = [];
    this.events = [];
    this.feed = [];
    this.noises = [];
    this.nades = [];
    this.smokes = [];
    this.los = { losClear };
    this.phase = 'buy';
    this.phaseT = BUY_TIME;
    this.roundTime = ROUND_TIME;
    this.round = 0;
    this.scores = { atk: 0, def: 0 };
    this.lossStreak = { atk: 0, def: 0 };
    this.planSite = 'A';
    this.channel = null;
    this.lastResult = null;
    this.matchWinner = null;
    this.nextBeep = 0;
    this.charge = { state: 'carried', carrier: null, x: 0, z: 0, groundY: 0, site: null, detonateAt: 0, rot: 0 };

    const player = createActor('atk', 'You', true);
    this.player = player;
    this.actors.push(player);
    ATK_NAMES.forEach((name, i) => {
      const a = createActor('atk', name);
      a.bot = makeBrain(this.rng, ATK_ROLES[i]);
      a.input = blankInput();
      this.actors.push(a);
    });
    DEF_NAMES.forEach((name, i) => {
      const a = createActor('def', name);
      const role = i < 2 ? 'holdA' : i < 4 ? 'holdB' : 'mid';
      a.bot = makeBrain(this.rng, role);
      a.bot.holdNode = role === 'holdA' ? HOLDS.A[i] : role === 'holdB' ? HOLDS.B[i - 2] : HOLDS.mid[0];
      a.input = blankInput();
      this.actors.push(a);
    });
    player.input = blankInput();
    if (demo) {
      player.bot = makeBrain(this.rng, 'entry');
    }
    for (const a of this.actors) this.resetLoadout(a, true);
    this.nextRound();
  }

  resetLoadout(a, fresh = false) {
    if (fresh || !a.inv.sidearm) a.inv.sidearm = makeWeaponState('p9');
    else {
      a.inv.sidearm.mag = WEAPONS.p9.mag;
      a.inv.sidearm.reserve = WEAPONS.p9.reserve;
    }
    if (fresh) {
      a.inv.primary = null;
      a.inv.frag = 0;
      a.inv.smoke = 0;
      a.inv.flash = 0;
      a.armorPts = 0;
    }
    a.cur = a.inv.primary ? 'primary' : 'sidearm';
  }

  aliveCount(team) {
    let n = 0;
    for (const a of this.actors) if (a.team === team && a.alive) n += 1;
    return n;
  }

  addNoise(x, z, r, team) {
    this.noises.push({ x, z, r, team, t: this.time });
    if (this.noises.length > 24) this.noises.shift();
  }

  onKill(attacker, victim, zone) {
    this.feed.push({
      killer: attacker ? attacker.name : '—',
      killerTeam: attacker ? attacker.team : null,
      victim: victim.name,
      victimTeam: victim.team,
      zone,
      t: this.time,
    });
    if (this.feed.length > 6) this.feed.shift();
    if (this.charge.carrier === victim && this.charge.state === 'carried') {
      this.charge.state = 'dropped';
      this.charge.carrier = null;
      this.charge.x = victim.pos.x;
      this.charge.z = victim.pos.z;
      this.charge.groundY = victim.pos.y;
      this.events.push({ k: 'chargestate', state: 'dropped' });
    }
  }

  buy(actor, item) {
    if (this.phase !== 'buy') return false;
    if (WEAPONS[item] && item !== 'p9') {
      if (actor.money < WEAPONS[item].price) return false;
      actor.money -= WEAPONS[item].price;
      actor.inv.primary = makeWeaponState(item);
      actor.cur = 'primary';
      return true;
    }
    if (item === 'armor') {
      if (actor.money < ARMOR_PRICE || actor.armorPts >= ARMOR_POINTS) return false;
      actor.money -= ARMOR_PRICE;
      actor.armorPts = ARMOR_POINTS;
      return true;
    }
    if (GRENADES[item]) {
      if (actor.money < GRENADES[item].price || actor.inv[item] >= 1) return false;
      actor.money -= GRENADES[item].price;
      actor.inv[item] += 1;
      return true;
    }
    return false;
  }

  botBuy(a) {
    if (!a.bot) return;
    if (!a.inv.primary) {
      if (a.money >= 2700) this.buy(a, 'vk7');
      else if (a.money >= 1200 && this.round > 1) this.buy(a, this.rng.chance(0.6) ? 'raptor' : 'breach');
    }
    if (a.armorPts < 50 && a.money >= 650) this.buy(a, 'armor');
    if (a.money > 2000 && a.inv.frag === 0) this.buy(a, 'frag');
    if (a.money > 2400 && a.inv.smoke === 0 && a.bot.role === 'support') this.buy(a, 'smoke');
  }

  nextRound() {
    this.round += 1;
    this.phase = 'buy';
    this.phaseT = BUY_TIME;
    this.roundTime = ROUND_TIME;
    this.channel = null;
    this.nades.length = 0;
    this.smokes.length = 0;
    this.planSite = this.rng.chance(0.5) ? 'A' : 'B';
    const atkSpawns = [...SPAWNS.atk];
    const defSpawns = [...SPAWNS.def];
    for (const a of this.actors) {
      const spawns = a.team === 'atk' ? atkSpawns : defSpawns;
      const [sx, sz] = spawns.pop() || spawns[0] || [0, 0];
      a.pos.x = sx;
      a.pos.z = sz;
      a.pos.y = supportHeight(sx, sz, 99);
      a.vel.x = a.vel.y = a.vel.z = 0;
      a.yaw = a.team === 'atk' ? -Math.PI / 2 : Math.PI / 2;
      a.pitch = 0;
      a.hp = 100;
      a.alive = true;
      a.deathT = -9;
      a.blindUntil = -9;
      a.crouch = false;
      a.kickP = 0;
      a.kickY = 0;
      if (!a.aliveBefore) this.resetLoadout(a, !a.keptGear);
      a.bot && (a.bot.route = [], a.bot.ri = 0, a.bot.goalNode = -1, a.bot.seen = null, a.bot.lastKnown = null, a.bot.nadeUsed = false, a.bot.executeSmoked = false, a.bot.invest = null);
      this.botBuy(a);
    }
    // The player carries the charge in; if this is a demo, a bot does.
    const carrier = this.demo ? this.actors.find((a) => a.team === 'atk' && a.bot && !a.isPlayer) : this.player;
    this.charge = { state: 'carried', carrier, x: 0, z: 0, groundY: 0, site: null, detonateAt: 0, rot: 0 };
    this.events.push({ k: 'roundSetup', round: this.round });
  }

  prepareRoundEnd(winner, reason) {
    this.phase = 'roundEnd';
    this.phaseT = 4.6;
    this.scores[winner] += 1;
    const loser = winner === 'atk' ? 'def' : 'atk';
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] += 1;
    const lossPay = 900 + 250 * Math.min(this.lossStreak[loser] - 1, 2);
    for (const a of this.actors) {
      a.money += a.team === winner ? 1400 : lossPay;
      a.keptGear = a.alive;
      a.aliveBefore = a.alive;
    }
    this.lastResult = { winner, reason, round: this.round };
    this.events.push({ k: 'roundEnd', winner, reason });
    if (this.scores[winner] >= WIN_SCORE) this.matchWinner = winner;
  }

  step(dt) {
    this.time += dt;
    // Phase clocks
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'live';
        this.events.push({ k: 'roundStart' });
      }
    } else if (this.phase === 'live') {
      this.roundTime -= dt;
      if (this.roundTime <= 0) {
        this.prepareRoundEnd('def', 'Time expired — the Wardens held the yard');
      }
    } else if (this.phase === 'planted') {
      if (this.time >= this.nextBeep) {
        this.nextBeep = this.time + (this.charge.detonateAt - this.time < 10 ? 0.45 : 1);
        this.events.push({ k: 'beep', final: this.charge.detonateAt - this.time < 1 });
      }
      if (this.time >= this.charge.detonateAt) {
        this.events.push({ k: 'explosion', x: this.charge.x, y: 1, z: this.charge.z, big: true });
        this.charge.state = 'done';
        this.prepareRoundEnd('atk', 'The charge detonated');
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.matchWinner) {
          this.phase = 'matchEnd';
          this.events.push({ k: 'matchEnd', winner: this.matchWinner });
        } else {
          this.nextRound();
        }
      }
    }

    const fighting = this.phase === 'live' || this.phase === 'planted';

    // Brains first: they write each actor's input for this step.
    for (const a of this.actors) {
      if (a.bot && a.alive) stepBot(this, a, dt);
    }
    // Bodies and weapons.
    for (const a of this.actors) {
      if (!a.alive) continue;
      const input = a.input;
      if (this.phase !== 'buy' && this.phase !== 'roundEnd' && this.phase !== 'matchEnd') {
        const moveFactor = a.cur === 'primary' || a.cur === 'sidearm' ? (WEAPONS[a.cur === 'primary' ? a.inv.primary?.id : 'p9']?.move ?? 1) : 1;
        stepMovement(a, { x: input.mx, z: input.mz, jump: input.jump, crouch: input.crouch, walk: input.walk }, dt, moveFactor);
        a.crouch = !!input.crouch;
      }
      stepWeapon(this, a, dt, fighting && !!input.fire);
    }
    stepNades(this, dt);
    this.stepCharge(dt, fighting);

    // Housekeeping
    this.noises = this.noises.filter((n) => this.time - n.t < 1.5);
    this.smokes = this.smokes.filter((s) => this.time <= s.until);

    // Elimination wins (a planted charge must still be disarmed: attackers dying does not save the Wardens).
    if (this.phase === 'live') {
      if (this.aliveCount('def') === 0) this.prepareRoundEnd('atk', 'Wardens eliminated');
      else if (this.aliveCount('atk') === 0) this.prepareRoundEnd('def', 'Breakers eliminated');
    } else if (this.phase === 'planted') {
      if (this.aliveCount('def') === 0) this.prepareRoundEnd('atk', 'Wardens eliminated');
    }
  }

  stepCharge(dt, fighting) {
    const c = this.charge;
    if (!fighting) {
      this.channel = null;
      return;
    }
    let active = null;
    if (c.state === 'carried' && c.carrier && c.carrier.alive) {
      const carrier = c.carrier;
      const siteKey = inSite(SITES.A, carrier.pos.x, carrier.pos.z) ? 'A' : inSite(SITES.B, carrier.pos.x, carrier.pos.z) ? 'B' : null;
      if (siteKey && carrier.input.channel && carrier.speed2d < 0.6) {
        const ch = this.channel && this.channel.actor === carrier && this.channel.kind === 'plant'
          ? this.channel
          : { actor: carrier, kind: 'plant', t: 0 };
        ch.t += dt;
        ch.frac = ch.t / PLANT_TIME;
        active = ch;
        if (ch.t >= PLANT_TIME) {
          c.state = 'planted';
          c.site = siteKey;
          c.x = carrier.pos.x;
          c.z = carrier.pos.z;
          c.groundY = carrier.pos.y;
          c.detonateAt = this.time + DETONATE_TIME;
          c.carrier = null;
          carrier.money += 300;
          this.nextBeep = this.time + 1;
          this.phase = 'planted';
          this.events.push({ k: 'planted', site: siteKey });
          active = null;
        }
      }
    } else if (c.state === 'dropped') {
      for (const a of this.actors) {
        if (a.team === 'atk' && a.alive && Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < 1.3) {
          c.state = 'carried';
          c.carrier = a;
          this.events.push({ k: 'chargestate', state: 'carried' });
          break;
        }
      }
    } else if (c.state === 'planted') {
      for (const a of this.actors) {
        if (a.team !== 'def' || !a.alive) continue;
        if (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < 1.8 && a.input.channel && a.speed2d < 0.6) {
          const ch = this.channel && this.channel.actor === a && this.channel.kind === 'disarm'
            ? this.channel
            : { actor: a, kind: 'disarm', t: 0 };
          ch.t += dt;
          ch.frac = ch.t / DISARM_TIME;
          active = ch;
          if (ch.t >= DISARM_TIME) {
            a.money += 300;
            c.state = 'done';
            this.events.push({ k: 'disarmed' });
            this.prepareRoundEnd('def', 'The charge was disarmed');
            active = null;
          }
          break;
        }
      }
    }
    this.channel = active;
  }

  timeLeft() {
    if (this.phase === 'buy') return Math.max(0, this.phaseT);
    if (this.phase === 'live') return Math.max(0, this.roundTime);
    if (this.phase === 'planted') return Math.max(0, this.charge.detonateAt - this.time);
    return 0;
  }
}

function blankInput() {
  return { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, channel: false };
}
