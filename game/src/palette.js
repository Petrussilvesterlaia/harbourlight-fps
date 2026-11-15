// HARBOURLIGHT palette: a dockyard at dusk. One slate family for the yard, rust and
// teal for the two crews, amber for every accent the eye should land on.
export const PALETTE = {
  sky: 0x1b232d,
  fog: 0x232e38,
  ground: 0x3b4249,
  groundDark: 0x2e343a,
  concrete: 0x5b646d,
  concreteLight: 0x78828c,
  steel: 0x46525e,
  warehouse: 0x54493a,
  warehouseRoof: 0x3a332a,
  wood: 0x7a5c38,
  rust: 0xb4552d,
  ochre: 0xc8912f,
  olive: 0x6b7040,
  teal: 0x2d7f7a,
  slateBlue: 0x3f6185,
  accent: 0xf0a830,
  atk: 0xe06428,
  def: 0x2fa8a0,
  ink: 0xe9e6df,
  danger: 0xe0483e,
  white: 0xffffff,
};

// Team metadata shared by HUD, bodies and bots.
export const TEAMS = {
  atk: { name: 'Breakers', color: PALETTE.atk, css: '#e06428' },
  def: { name: 'Wardens', color: PALETTE.def, css: '#2fa8a0' },
};
