#!/usr/bin/env node
/* ============================================================================
   build.mjs — assemble one client's invitation into dist/
   ----------------------------------------------------------------------------
     node tools/build.mjs tayal
     CLIENT=tayal node tools/build.mjs          (how Vercel calls it)

   Three inputs, one output:

     engine/    the parts that are the same for everybody — renderer, base CSS,
                the page shell, and the copy blocks
     themes/    a film: frame sequences, a palette, and where things sit on the
                painted artwork. Reusable across any number of clients.
     clients/   who, what, when, where — plus a logo, a photo and a song.

   Everything a client can change is data. Nothing here should ever need editing
   to onboard one; if it does, that is the bug.
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = process.argv[2] || process.env.CLIENT;

if (!CLIENT) {
  const known = existsSync(join(ROOT, 'clients')) ? readdirSync(join(ROOT, 'clients')) : [];
  console.error('Usage: node tools/build.mjs <client>\nKnown clients: ' + (known.join(', ') || '(none)'));
  process.exit(1);
}

const die = (msg) => { console.error('✗ ' + msg); process.exit(1); };
const readJSON = (p) => {
  if (!existsSync(p)) die('missing ' + p.replace(ROOT + '/', ''));
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { die('bad JSON in ' + p.replace(ROOT + '/', '') + ' — ' + e.message); }
};

const clientDir = join(ROOT, 'clients', CLIENT);
const client = readJSON(join(clientDir, 'client.json'));
const themeDir = join(ROOT, 'themes', client.theme || '');
if (!existsSync(themeDir)) die(`client "${CLIENT}" asks for theme "${client.theme}", which does not exist`);
const theme = readJSON(join(themeDir, 'theme.json'));

/* -- templating ------------------------------------------------------------ */
/* Deliberately tiny: {{a.b.c}} looked up in one merged object. No loops, no
   conditionals — anything that needs those is a block template of its own, or
   belongs in the runtime. A build language is a thing to maintain. */
const ctx = {
  ...client,
  palette: theme.palette,
  fonts: theme.fonts,
  build: Date.now().toString(36),
};

// a couple of values are derived rather than authored, so a client never
// repeats itself in client.json
ctx.couple = {
  ...client.couple,
  groomShortFull: client.couple.shortPair ? client.couple.shortPair.split('&')[0].trim() : client.couple.groom,
  brideShortFull: client.couple.shortPair ? client.couple.shortPair.split('&')[1].trim() : client.couple.bride,
};
ctx.hosts = {
  ...client.hosts,
  phoneLinks: (client.hosts?.phones || [])
    .map((p) => `<a href="tel:${p.tel}">${p.display}</a>`).join('\n            '),
};

const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
const missing = new Set();
function fill(str, where) {
  return str.replace(/\{\{([\w.\-]+)\}\}/g, (m, path) => {
    const v = get(path);
    if (v == null) { missing.add(`${path}  (in ${where})`); return ''; }
    return String(v);
  });
}

/* -- sections -------------------------------------------------------------- */
const sections = theme.scenes.map((sc) => {
  const file = join(ROOT, 'engine', 'blocks', sc.block + '.html');
  if (!existsSync(file)) die(`scene "${sc.id}" wants block "${sc.block}", which has no template in engine/blocks`);
  const inner = fill(readFileSync(file, 'utf8').trimEnd(), sc.block + '.html');
  const attrs = [
    'class="copy"',
    `data-place="${sc.place || 'center'}"`,
    sc.scrim ? `data-scrim="${sc.scrim}"` : '',
    `aria-label="${sc.label}"`,
  ].filter(Boolean).join(' ');
  return `      <!-- ${sc.id} -->\n      <section ${attrs}>\n` +
         inner.split('\n').map((l) => (l ? '        ' + l : l)).join('\n') +
         `\n      </section>`;
}).join('\n\n');

/* -- runtime config -------------------------------------------------------- */
/* Only what the engine actually reads. The copy is already baked into the HTML,
   so none of it ships twice. */
const runtime = {
  frameCount: theme.frameCount,
  crossfade: theme.crossfade,
  music: client.music
    ? { src: `assets/${client.music.file}.m4a`, srcFallback: `assets/${client.music.file}.mp3`,
        title: client.music.title, volume: client.music.volume }
    : null,
  event: {
    name: client.event.name, dateISO: client.event.dateISO,
    startUTC: client.event.startUTC, endUTC: client.event.endUTC,
  },
  couple: { shortGroom: client.couple.groomShort, shortBride: client.couple.brideShort },
  venue: { name: client.venue.name, lines: [], mapQuery: client.venue.mapQuery },
  hashtag: '#' + client.hashtag,
  rsvp: { endpoint: client.rsvp.endpoint ?? null, whatsapp: client.rsvp.whatsapp ?? null },
  sections: theme.scenes.map((sc) => ({
    id: sc.id, label: sc.label,
    frames: `assets/frames/${sc.clip}`,
    scroll: sc.scroll, settle: sc.settle ?? 1, linger: sc.linger ?? 0,
    ...(sc.from != null ? { from: sc.from } : {}),
    ...(sc.to != null ? { to: sc.to } : {}),
    copy: sc.copy,
    ...(sc.stops ? { stops: sc.stops } : {}),
    ...(sc.anchored ? { anchored: true } : {}),
  })),
};

/* -- theme variables ------------------------------------------------------- */
const vars = { ...theme.palette, ...Object.fromEntries(Object.entries(theme.fonts).filter(([k]) => k.startsWith('--'))) };
const anchorVars = Object.entries(theme.anchors || {}).map(([k, v]) => `  ${k}: ${v};`).join('\n');
const themeVars = ':root{\n' +
  Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n') +
  (anchorVars ? '\n' + anchorVars : '') + '\n}';

/* -- emit ------------------------------------------------------------------ */
const out = join(ROOT, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

let html = readFileSync(join(ROOT, 'engine', 'index.html'), 'utf8');
html = html.replace('{{sections}}', sections)
           .replace('{{themeVars}}', themeVars)
           .replace('{{config}}', JSON.stringify(runtime));
html = fill(html, 'index.html');
writeFileSync(join(out, 'index.html'), html);

cpSync(join(ROOT, 'engine', 'css'), join(out, 'css'), { recursive: true });
cpSync(join(ROOT, 'engine', 'js'), join(out, 'js'), { recursive: true });

// Only the tiers that exist — a theme may ship one while the other is rendering
for (const tier of ['frames', 'frames-720']) {
  const src = join(themeDir, tier);
  if (existsSync(src)) cpSync(src, join(out, 'assets', tier), { recursive: true });
  else if (tier === 'frames') die(`theme "${client.theme}" has no frames/ — run tools/frames.sh`);
  else console.warn(`  ! no ${tier}/ in this theme — every device will take the full-size film`);
}
cpSync(join(clientDir, 'assets'), join(out, 'assets'), { recursive: true });
cpSync(join(ROOT, 'vercel.json'), join(out, 'vercel.json'));

if (missing.size) {
  console.warn('  ! unresolved placeholders (rendered empty):');
  for (const m of missing) console.warn('      {{' + m + '}}');
}

const du = (p) => { let n = 0; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const f = join(d, e.name); e.isDirectory() ? walk(f) : (n += statSize(f)); } }; walk(p); return n; };
import { statSync } from 'node:fs';
const statSize = (f) => statSync(f).size;

console.log(`✓ ${CLIENT} → dist/`);
console.log(`  theme    ${client.theme} — ${theme.name}`);
console.log(`  scenes   ${theme.scenes.length}, ${theme.frameCount} frames each`);
console.log(`  size     ${(du(out) / 1048576).toFixed(1)} MB`);
