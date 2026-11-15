// All sound is synthesised WebAudio: no audio files, nothing fetched. One shared
// noise buffer, short oscillator/noise envelopes per effect, distance gain so a
// firefight across the yard sounds far away. The context opens on the first user
// gesture (the Play click), as browsers require.
let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function env(gain, t0, peak, decay) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

function noiseBurst({ at = 0, dur = 0.12, freq = 1800, q = 0.8, peak = 0.5, type = 'bandpass' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  env(gain, t0, peak, dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function tone({ at = 0, freq = 440, end = null, dur = 0.12, peak = 0.25, type = 'square' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (end !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(end, 1), t0 + dur);
  const gain = ctx.createGain();
  env(gain, t0, peak, dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const distGain = (dist) => Math.max(0.03, Math.min(1, 9 / (9 + dist)));

// Gunshots, voiced per weapon class; dist in metres from the listener.
export function sfxShot(kind, dist = 0) {
  const g = distGain(dist);
  if (kind === 'dmr') {
    noiseBurst({ dur: 0.34, freq: 900, peak: 0.85 * g });
    tone({ freq: 160, end: 40, dur: 0.3, peak: 0.5 * g, type: 'sawtooth' });
  } else if (kind === 'shotgun') {
    noiseBurst({ dur: 0.26, freq: 700, peak: 0.8 * g });
    tone({ freq: 120, end: 45, dur: 0.22, peak: 0.45 * g, type: 'sawtooth' });
  } else if (kind === 'smg') {
    noiseBurst({ dur: 0.09, freq: 2400, peak: 0.42 * g });
    tone({ freq: 300, end: 90, dur: 0.07, peak: 0.22 * g, type: 'sawtooth' });
  } else if (kind === 'pistol') {
    noiseBurst({ dur: 0.11, freq: 2000, peak: 0.5 * g });
    tone({ freq: 260, end: 80, dur: 0.09, peak: 0.25 * g, type: 'sawtooth' });
  } else {
    noiseBurst({ dur: 0.16, freq: 1500, peak: 0.62 * g });
    tone({ freq: 210, end: 60, dur: 0.13, peak: 0.32 * g, type: 'sawtooth' });
  }
  if (dist < 2) noiseBurst({ dur: 0.05, freq: 4200, peak: 0.3, type: 'highpass' });
}

export function sfxDryFire() {
  tone({ freq: 1200, dur: 0.04, peak: 0.12, type: 'square' });
}
export function sfxReload() {
  noiseBurst({ dur: 0.05, freq: 900, peak: 0.2 });
  noiseBurst({ at: 0.32, dur: 0.05, freq: 1300, peak: 0.24 });
  noiseBurst({ at: 0.62, dur: 0.06, freq: 700, peak: 0.28 });
}
export function sfxHit(kill) {
  tone({ freq: kill ? 1560 : 1180, dur: kill ? 0.14 : 0.07, peak: 0.22, type: 'sine' });
  if (kill) tone({ at: 0.07, freq: 1980, dur: 0.12, peak: 0.2, type: 'sine' });
}
export function sfxHurt() {
  tone({ freq: 180, end: 90, dur: 0.16, peak: 0.3, type: 'sawtooth' });
}
export function sfxBuy() {
  tone({ freq: 880, dur: 0.06, peak: 0.18, type: 'sine' });
  tone({ at: 0.06, freq: 1320, dur: 0.08, peak: 0.18, type: 'sine' });
}
export function sfxDenied() {
  tone({ freq: 220, dur: 0.1, peak: 0.18, type: 'square' });
}
export function sfxThrow() {
  noiseBurst({ dur: 0.14, freq: 600, peak: 0.16, type: 'lowpass' });
}
export function sfxBounce(dist = 0) {
  tone({ freq: 340, dur: 0.05, peak: 0.2 * distGain(dist), type: 'triangle' });
}
export function sfxExplosion(dist = 0) {
  const g = distGain(dist);
  noiseBurst({ dur: 0.7, freq: 240, peak: 1.0 * g, type: 'lowpass' });
  tone({ freq: 90, end: 28, dur: 0.65, peak: 0.7 * g, type: 'sine' });
}
export function sfxFlashPop(dist = 0) {
  const g = distGain(dist);
  noiseBurst({ dur: 0.08, freq: 3400, peak: 0.5 * g, type: 'highpass' });
  tone({ freq: 2400, end: 3000, dur: 0.3, peak: 0.1 * g, type: 'sine' });
}
export function sfxBeep(final = false) {
  tone({ freq: final ? 1760 : 1240, dur: final ? 0.22 : 0.08, peak: 0.22, type: 'sine' });
}
export function sfxPlantTick() {
  tone({ freq: 980, dur: 0.05, peak: 0.14, type: 'sine' });
}
export function sfxSting(win) {
  const base = win ? [523, 659, 784] : [392, 330, 262];
  base.forEach((f, i) => tone({ at: i * 0.13, freq: f, dur: 0.24, peak: 0.22, type: 'triangle' }));
}
export function sfxRoundStart() {
  tone({ freq: 660, dur: 0.09, peak: 0.2, type: 'triangle' });
  tone({ at: 0.11, freq: 990, dur: 0.14, peak: 0.2, type: 'triangle' });
}
