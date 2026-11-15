[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Petrussilvesterlaia/harbourlight-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Petrussilvesterlaia/harbourlight-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# HARBOURLIGHT

A round-based tactical FPS in three.js, built for the make.fun threejs-fps bounty.
Two crews of five fight over a dockyard at dusk: the **Breakers** carry a breach
charge to the Drydock (site A) or the Depot (site B); the **Wardens** hold the
yard against them. First crew to 7 rounds takes the yard.

Everything is original — map, names, art, and sounds (all audio is synthesized
with WebAudio; there are no external assets). The game is a static site: ES
modules, no build step, no network requests, playable offline in desktop Chrome.

## Play

```sh
node serve.ts --port 8137   # then open http://localhost:8137
```

Click **Play**, buy with the number keys during the 20-second buy phase, and
fight the round out. WASD moves, mouse looks, Ctrl crouches (tighter spread),
Shift walks, E arms or disarms the charge, Tab shows the scoreboard.

A bot demo match plays behind the menu, so the yard is alive before you click.

## The game

- **Rounds & objective** — 20 s buy phase, 100 s live rounds, 40 s charge fuse.
  Win by eliminating the other crew, by detonating the charge, or by disarming
  it. The carrier drops the charge when killed; a teammate can pick it up.
- **Economy** — $800 start, kill/plant/disarm bonuses, win/loss income with a
  loss streak bonus, team-shared plant money. Weapons are kept while you live
  and lost when you fall.
- **Arsenal** — P9 Sidearm, Raptor-9 SMG, Breach-12 shotgun, VK-7 Rifle and the
  scoped Longshot DMR, plus a Composite Vest and three grenades: Frag Charge,
  Smoke Canister (blocks bot line of sight) and Flash Orb.
- **Gunplay** — spread grows with movement, airtime and sustained fire, and
  shrinks when you stop, crouch or fire in bursts; the first shot is nearly
  pinpoint. Fixed recoil pattern, head/body/leg damage zones, vest absorption.
- **Bots** — waypoint-graph navigation with lane roles (entry, support, lurk,
  hold, mid), line-of-sight and hearing perception, reaction delays and aim
  error that settles over time, burst discipline, their own buying, and
  plant/disarm/pickup behaviour.
- **Presentation** — one harbour map with two sites, a catwalk over mid and a
  crane over the Drydock; fog, shadowed dusk light, tracers, hit markers,
  damage direction indicators, a live minimap and a full scoreboard.

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the kit library.
- `game/` — the game itself. `game/src/` holds one module per concern
  (simulation on a fixed 60 Hz step, rendering and HUD on top of it):
  `match.js` rounds/economy/objective, `bots.js` crew AI, `weapons.js`
  gunplay and grenades, `map.js` the yard, `actors.js` movement and hit
  tests, `fx.js` meshes and effects, `audio.js` synthesized sound,
  `hud.js` and `input.js` the interface, `main.js` the wiring.
- `screenshots/` — real renders of the running game (menu over the live demo,
  mid-round combat, the buy menu, the match-end screen).
- `shots.json` — the deterministic `?shot=` poses used to capture them.

MIT licensed — see `LICENSE`.
