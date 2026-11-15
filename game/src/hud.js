// Every DOM element of the HUD: vitals, ammunition, money, the round clock, team
// scores and alive pips, the kill feed, the buy menu, the scoreboard, the canvas
// minimap, banners and the centre prompts. It only reads match state and reports
// clicks back; the simulation never reaches into the DOM.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';
import { colliders, SITES, BOUNDS } from './map.js';
import { TEAMS } from './palette.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const BUY_ITEMS = [
  { item: 'vk7', key: '1' }, { item: 'raptor', key: '2' }, { item: 'breach', key: '3' }, { item: 'longshot', key: '4' },
  { item: 'armor', key: '5' }, { item: 'frag', key: '6' }, { item: 'smoke', key: '7' }, { item: 'flash', key: '8' },
];
function itemInfo(item) {
  if (item === 'armor') return { name: 'Composite Vest', price: ARMOR_PRICE, desc: 'Absorbs half of every hit' };
  if (WEAPONS[item]) {
    const w = WEAPONS[item];
    return { name: w.name, price: w.price, desc: `${w.dmg} dmg · ${w.rpm} rpm · ${w.mag} rounds` };
  }
  return { name: GRENADES[item].name, price: GRENADES[item].price, desc: item === 'frag' ? 'Area damage' : item === 'smoke' ? 'Blocks sight for 15 s' : 'Blinds anyone facing it' };
}

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'crosshair', 'hitmarker', 'dmg-vignette', 'dmg-dir', 'flash-overlay', 'scope-overlay',
      'minimap', 'score-atk', 'score-def', 'timer', 'phase-label', 'pips-atk', 'pips-def', 'killfeed',
      'hp-num', 'hp-fill', 'armor-num', 'armor-fill', 'money', 'ammo-mag', 'ammo-res', 'weapon-name',
      'nade-frag', 'nade-smoke', 'nade-flash', 'charge-note', 'banner', 'banner-title', 'banner-sub',
      'progress', 'progress-label', 'progress-fill', 'buy-menu', 'buy-money', 'buy-grid', 'buy-count',
      'scoreboard', 'sb-rows', 'menu', 'end-screen', 'end-title', 'end-sub', 'center-msg', 'round-label']) {
      this.el[id] = $(id);
    }
    this.mapCtx = this.el.minimap.getContext('2d');
    this.feedSignature = '';
    this.buySignature = '';
    this.hitT = 0;
    this.hurtT = 0;
    this.onBuyRequest = null;
    this.el['buy-grid'].addEventListener('click', (e) => {
      const card = e.target.closest('[data-item]');
      if (card && this.onBuyRequest) this.onBuyRequest(card.dataset.item);
    });
  }

  setCrosshairSpread(px) {
    this.el.crosshair.style.setProperty('--sp', `${px}px`);
  }
  setScoped(on) {
    this.el['scope-overlay'].style.opacity = on ? '1' : '0';
    this.el.crosshair.style.opacity = on ? '0' : '1';
  }
  hitMarker(kill) {
    this.hitT = kill ? 0.32 : 0.14;
    this.el.hitmarker.classList.toggle('kill', kill);
    this.el.hitmarker.style.opacity = '1';
  }
  hurt(fromAngle, playerYaw) {
    this.hurtT = 0.7;
    const rel = fromAngle - playerYaw;
    this.el['dmg-dir'].style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
    this.el['dmg-vignette'].style.opacity = '0.85';
  }

  update(match, dt, input) {
    const p = match.player;
    const el = this.el;
    this.hitT = Math.max(0, this.hitT - dt);
    if (this.hitT === 0) el.hitmarker.style.opacity = '0';
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.hurtT === 0) el['dmg-vignette'].style.opacity = '0';

    // Vitals and money
    el['hp-num'].textContent = Math.max(0, Math.ceil(p.hp));
    el['hp-fill'].style.width = `${Math.max(0, p.hp)}%`;
    el['hp-fill'].style.background = p.hp <= 30 ? 'var(--danger)' : 'var(--ink)';
    el['armor-num'].textContent = Math.ceil(p.armorPts);
    el['armor-fill'].style.width = `${p.armorPts}%`;
    el.money.textContent = `$${p.money}`;

    // Weapon readout
    const state = p.inv[p.cur];
    if (state && WEAPONS[state.id]) {
      el['weapon-name'].textContent = WEAPONS[state.id].name + (state.reloading ? ' — reloading' : '');
      el['ammo-mag'].textContent = state.mag;
      el['ammo-res'].textContent = `/ ${state.reserve}`;
      el['ammo-mag'].style.color = state.mag === 0 ? 'var(--danger)' : '';
    } else if (GRENADES[p.cur]) {
      el['weapon-name'].textContent = GRENADES[p.cur].name;
      el['ammo-mag'].textContent = p.inv[p.cur];
      el['ammo-res'].textContent = 'click to throw';
    }
    el['nade-frag'].classList.toggle('off', p.inv.frag === 0);
    el['nade-smoke'].classList.toggle('off', p.inv.smoke === 0);
    el['nade-flash'].classList.toggle('off', p.inv.flash === 0);

    // Clock, scores, pips
    el.timer.textContent = fmtTime(match.timeLeft());
    el.timer.style.color = match.phase === 'planted' ? 'var(--danger)' : '';
    el['score-atk'].textContent = match.scores.atk;
    el['score-def'].textContent = match.scores.def;
    el['round-label'].textContent = `Round ${match.round} · first to 7`;
    el['phase-label'].textContent =
      match.phase === 'buy' ? 'BUY PHASE' :
      match.phase === 'live' ? (match.demo ? 'DEMO — bots at work' : 'ROUND LIVE') :
      match.phase === 'planted' ? 'CHARGE PLANTED' :
      match.phase === 'roundEnd' ? 'ROUND OVER' : 'MATCH OVER';
    const pips = (team) => match.actors.filter((a) => a.team === team).map((a) => `<i class="${a.alive ? '' : 'dead'}"></i>`).join('');
    el['pips-atk'].innerHTML = pips('atk');
    el['pips-def'].innerHTML = pips('def');

    // Charge note and centre prompt
    const c = match.charge;
    let note = '';
    let centre = '';
    if (!p.alive && !match.demo) centre = 'You are down — your crew fights on';
    else if (c.state === 'carried' && c.carrier === p) {
      note = '◆ YOU CARRY THE CHARGE';
      const inA = p.pos.x > SITES.A.x0 && p.pos.x < SITES.A.x1 && p.pos.z > SITES.A.z0 && p.pos.z < SITES.A.z1;
      const inB = p.pos.x > SITES.B.x0 && p.pos.x < SITES.B.x1 && p.pos.z > SITES.B.z0 && p.pos.z < SITES.B.z1;
      centre = inA || inB ? 'Hold E to arm the charge' : 'Carry the charge to the Drydock (A) or the Depot (B)';
    } else if (c.state === 'dropped') note = '◆ THE CHARGE IS DOWN';
    else if (c.state === 'planted') note = `◆ CHARGE PLANTED AT ${c.site} — GUARD IT`;
    el['charge-note'].textContent = note;
    el['center-msg'].textContent = match.phase === 'buy' && !match.demo ? 'Buy phase — press B for the buy menu' : centre;

    // Channel progress
    if (match.channel && (match.channel.actor === p || match.demo)) {
      el.progress.style.display = 'block';
      el['progress-label'].textContent = match.channel.kind === 'plant' ? 'ARMING THE CHARGE…' : 'DISARMING…';
      el['progress-fill'].style.width = `${Math.round((match.channel.frac || 0) * 100)}%`;
    } else {
      el.progress.style.display = 'none';
    }

    // Kill feed (rebuilt only when it changes)
    const sig = match.feed.map((f) => `${f.killer}${f.victim}${f.t}`).join('|');
    if (sig !== this.feedSignature) {
      this.feedSignature = sig;
      el.killfeed.innerHTML = match.feed
        .filter((f) => match.time - f.t < 6)
        .map((f) => `<div><b class="${f.killerTeam}">${f.killer}</b> ▸ <b class="${f.victimTeam}">${f.victim}</b>${f.zone === 'head' ? ' ⌖' : ''}</div>`)
        .join('');
    }

    // Banner on round end
    if (match.phase === 'roundEnd' && match.lastResult) {
      el.banner.style.display = 'block';
      const mine = match.lastResult.winner === 'atk';
      el['banner-title'].textContent = match.demo ? (mine ? 'BREAKERS TAKE THE ROUND' : 'WARDENS TAKE THE ROUND') : mine ? 'ROUND WON' : 'ROUND LOST';
      el['banner-title'].style.color = mine ? TEAMS.atk.css : TEAMS.def.css;
      el['banner-sub'].textContent = match.lastResult.reason;
    } else {
      el.banner.style.display = 'none';
    }

    // Buy menu
    const buyOpen = match.phase === 'buy' && !match.demo && this.buyWanted;
    el['buy-menu'].style.display = buyOpen ? 'grid' : 'none';
    if (buyOpen) {
      const sig2 = `${p.money}|${p.inv.primary?.id}|${p.armorPts}|${p.inv.frag}${p.inv.smoke}${p.inv.flash}|${Math.ceil(match.phaseT)}`;
      if (sig2 !== this.buySignature) {
        this.buySignature = sig2;
        el['buy-money'].textContent = `$${p.money}`;
        el['buy-count'].textContent = `${Math.ceil(match.phaseT)}s`;
        el['buy-grid'].innerHTML = BUY_ITEMS.map(({ item, key }) => {
          const info = itemInfo(item);
          const owned = (WEAPONS[item] && p.inv.primary?.id === item) || (item === 'armor' && p.armorPts >= 100) || (GRENADES[item] && p.inv[item] >= 1);
          const afford = p.money >= info.price;
          return `<button class="buy-card ${owned ? 'owned' : ''} ${afford ? '' : 'poor'}" data-item="${item}">
            <span class="buy-key">${key}</span><span class="buy-name">${info.name}</span>
            <span class="buy-desc">${info.desc}</span><span class="buy-price">${owned ? 'OWNED' : '$' + info.price}</span></button>`;
        }).join('');
      }
    }

    // Scoreboard
    const showSb = (input && input.scoreboardHeld) || match.phase === 'matchEnd';
    el.scoreboard.style.display = showSb ? 'grid' : 'none';
    if (showSb) {
      const rows = [...match.actors].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      el['sb-rows'].innerHTML = rows.map((a) =>
        `<tr class="${a.team} ${a.isPlayer ? 'me' : ''}"><td>${a.name}${a.alive ? '' : ' ✝'}</td><td>${a.team === 'atk' ? 'Breakers' : 'Wardens'}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`).join('');
    }

    // Flash blindness fades as the effect wears off
    const blindLeft = p.blindUntil - match.time;
    el['flash-overlay'].style.opacity = blindLeft > 0 ? String(Math.min(1, blindLeft / 1.2)) : '0';

    this.drawMinimap(match);
  }

  drawMinimap(match) {
    const g = this.mapCtx;
    const W = 176;
    const H = 138;
    const sx = W / (BOUNDS.x1 - BOUNDS.x0);
    const sz = H / (BOUNDS.z1 - BOUNDS.z0);
    const px = (x) => (x - BOUNDS.x0) * sx;
    const pz = (z) => (z - BOUNDS.z0) * sz;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#20262d';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#454e57';
    for (const c of colliders) {
      if (c.y0 > 0.1) continue;
      g.fillRect(px(c.x0), pz(c.z0), (c.x1 - c.x0) * sx, (c.z1 - c.z0) * sz);
    }
    g.strokeStyle = 'rgba(240,168,48,0.8)';
    g.lineWidth = 1;
    for (const s of [SITES.A, SITES.B]) g.strokeRect(px(s.x0), pz(s.z0), (s.x1 - s.x0) * sx, (s.z1 - s.z0) * sz);
    const c = match.charge;
    if (c.state === 'dropped' || c.state === 'planted') {
      g.fillStyle = Math.sin(match.time * 6) > 0 ? '#ff5040' : '#ffb0a0';
      g.beginPath();
      g.arc(px(c.x), pz(c.z), 3, 0, 7);
      g.fill();
    }
    for (const a of match.actors) {
      if (!a.alive) continue;
      if (a.isPlayer) continue;
      if (a.team !== match.player.team) {
        // Enemies appear only as a fading blip just after they fire.
        if (match.time - a.lastShotT < 2.5) {
          g.fillStyle = 'rgba(224,72,62,0.75)';
          g.beginPath();
          g.arc(px(a.pos.x), pz(a.pos.z), 2.4, 0, 7);
          g.fill();
        }
        continue;
      }
      g.fillStyle = TEAMS[a.team].css;
      g.beginPath();
      g.arc(px(a.pos.x), pz(a.pos.z), 2.6, 0, 7);
      g.fill();
    }
    const p = match.player;
    g.save();
    g.translate(px(p.pos.x), pz(p.pos.z));
    g.rotate(-p.yaw);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -4.6);
    g.lineTo(3.2, 3.6);
    g.lineTo(-3.2, 3.6);
    g.closePath();
    g.fill();
    g.restore();
  }
}
