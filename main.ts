// HARBOURLIGHT — hand-in program for the make.fun threejs-fps bounty (Node 22,
// standard library only). The game itself is the static site in game/ (ES modules,
// no build step); this program copies game/ and screenshots/ into the output
// directory and writes dossier.json with the kit's own library, byte for byte the
// way the scorer rebuilds it. Outside the grader, MAKEFUN_OUTPUT_DIR stands in
// for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps are the gate's own (reference/gate.json): dossier text at most
// 163,840 bytes, at most 4 screenshots of at most 256 KiB, game/ at most 993
// entries and 48 MiB — passing them here means the dossier written is the one
// the scorer accepts.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
