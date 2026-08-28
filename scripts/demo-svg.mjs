#!/usr/bin/env node
/**
 * Generate the README demo animation (docs/demo.svg + docs/demo-light.svg)
 * by rendering a scripted build story through the REAL renderer — no screen
 * recording, fully reproducible: `node scripts/demo-svg.mjs`.
 *
 * One fixed shot of one map, and the story is what happens inside it: ONE
 * declare puts the whole ghost design up, the nodes light from the bottom, a
 * foundation cracks, the damage spreads upward, and green is earned back.
 *
 * The design arriving all at once is not an animator's shortcut: it is what
 * the skill prescribes and what the tool does — one `mmap_declare` carrying
 * the whole intended structure, so the user can veto a bad design while it is
 * still only a picture. An opening that grew the design node by node would be
 * the prettier lie.
 *
 * Every line of the map is renderMap() output with color on, frame by frame,
 * converted from ANSI into positioned SVG text runs and cycled by CSS. The one
 * line this script writes itself is the caption underneath, and even its
 * glyphs come from the renderer's status alphabet — as do the spinner frames
 * and the width accounting — so the picture cannot drift from what a terminal
 * shows.
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------- renderer
const bundle = join(tmpdir(), `mellos-demo-render-${process.pid}.mjs`);
await build({
  entryPoints: [join(root, 'src', 'render', 'render.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'silent',
});
const { displayWidth, renderMap, spinnerGlyph, statusGlyph } = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });

// ---------------------------------------------------------------- the story
const LAYERS = [
  { id: 'orchestration', name: 'orchestration', rank: 2 },
  { id: 'contracts', name: 'contracts', rank: 1 },
  { id: 'primitives', name: 'primitives', rank: 0 },
];
const EDGES = [
  { from: 'mcp', to: 'store' },
  { from: 'mcp', to: 'watcher' },
  { from: 'mcp', to: 'domain' },
  { from: 'store', to: 'domain' },
  { from: 'watcher', to: 'render' },
];

// Each node carries the run that verifies it — the real counts from this
// repo's own suite. Without it the renderer would be right to draw every
// finished box as □ (done, nothing recorded behind it), and an animation
// selling "done means verified" would be demonstrating the rule being broken.
// Evidence rides along only where the status is done: on a planned node it
// would be a claim about work nobody has started.
const NODE = {
  mcp: { id: 'mcp', label: 'MCP Server', layer: 'orchestration', evidence: 'server.test.ts: 70 passed' },
  store: { id: 'store', label: 'State Store', layer: 'contracts', evidence: 'store.test.ts: 72 passed' },
  watcher: { id: 'watcher', label: 'Watcher', layer: 'contracts', evidence: 'watch.test.ts: 64 passed' },
  domain: { id: 'domain', label: 'Map Domain', layer: 'primitives', evidence: 'ops.test.ts: 51 passed' },
  render: { id: 'render', label: 'ASCII Renderer', layer: 'primitives', evidence: 'render.test.ts: 37 passed' },
};

function mapWith(statuses) {
  return {
    title: 'Mellos Mapping · a build, watched live',
    layers: LAYERS,
    groups: [],
    lanes: [],
    nodes: ['mcp', 'store', 'watcher', 'domain', 'render'].map((id) => {
      const { evidence, ...node } = NODE[id];
      const status = statuses[id];
      return status === 'done' ? { ...node, status, evidence } : { ...node, status };
    }),
    edges: EDGES,
  };
}

const GHOST = { mcp: 'planned', store: 'planned', watcher: 'planned', domain: 'planned', render: 'planned' };
const GREEN = { mcp: 'done', store: 'done', watcher: 'done', domain: 'done', render: 'done' };

// The caption under the map: [glyph, color, text]. A null glyph is the spinner
// at the current frame, so the line breathes with the boxes; the settled
// glyphs come from the renderer's status alphabet rather than being retyped.
const DECLARED = [statusGlyph('planned', true), 'f', 'whole design declared — nothing built yet'];
const BUILDING = [null, 'a', 'building bottom-up — done means verified'];
const VERIFIED = [statusGlyph('done', true), 'g', 'five nodes, every one with evidence'];
const CRACKED = [statusGlyph('regressed', true), 'r', 'a foundation cracked — it spreads upward'];
const REPAIRING = [null, 'a', 're-verifying everything above the fix'];

/** [statuses, caption, frames to hold]. The spinner turns across every frame. */
const STAGES = [
  [GHOST, DECLARED, 6],

  [{ ...GHOST, domain: 'in-progress' }, BUILDING, 4],
  [{ ...GHOST, domain: 'done', render: 'in-progress' }, BUILDING, 4],
  [{ ...GHOST, domain: 'done', render: 'done', store: 'in-progress' }, BUILDING, 4],
  [{ ...GHOST, domain: 'done', render: 'done', store: 'done', watcher: 'in-progress' }, BUILDING, 4],
  [{ ...GREEN, mcp: 'in-progress' }, BUILDING, 4],
  [GREEN, VERIFIED, 6],

  // a foundation cracks — and the crack spreads up the dependency edges
  [{ ...GREEN, render: 'regressed', watcher: 'regressed', mcp: 'regressed' }, CRACKED, 6],
  [{ ...GREEN, render: 'in-progress', watcher: 'regressed', mcp: 'regressed' }, REPAIRING, 4],
  [{ ...GREEN, watcher: 'in-progress', mcp: 'regressed' }, REPAIRING, 4],
  [{ ...GREEN, mcp: 'in-progress' }, REPAIRING, 4],
  [GREEN, VERIFIED, 7],
];

// ------------------------------------------------------------- styled runs
const COLOR_OF = { 31: 'r', 32: 'g', 33: 'a', 90: 'f' };

/** Segments [text, color, bold] → positioned runs on one line. */
function runsOf(segments) {
  const runs = [];
  let col = 0;
  for (const [text, color, bold] of segments) {
    if (text !== '') runs.push({ col, text, color, bold: bold === true });
    col += displayWidth(text);
  }
  return runs;
}

/** One ANSI-colored rendered line → [{ col, text, color, bold }] runs. */
function lineToRuns(line) {
  const runs = [];
  let col = 0;
  let color = 'd';
  let bold = false;
  let current = null;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\x1b') {
      const end = line.indexOf('m', i);
      for (const token of line.slice(i + 2, end).split(';')) {
        if (token === '0' || token === '') {
          color = 'd';
          bold = false;
        } else if (token === '1') bold = true;
        else color = COLOR_OF[token] ?? color;
      }
      current = null;
      i = end + 1;
      continue;
    }
    const ch = String.fromCodePoint(line.codePointAt(i));
    if (current === null) {
      current = { col, text: '', color, bold };
      runs.push(current);
    }
    current.text += ch;
    col += displayWidth(ch);
    i += ch.length;
  }
  return runs;
}

// ------------------------------------------------------------------ frames
function captionLine([glyph, color, text], spin) {
  return runsOf([
    [glyph ?? spinnerGlyph(spin, true), color, false],
    [` ${text}`, 'f', false],
  ]);
}

const frames = [];
let spin = 0;
for (const [statuses, caption, hold] of STAGES) {
  for (let i = 0; i < hold; i += 1) {
    const opts = { color: true, unicode: true, spinnerFrame: spin, zoom: 0 };
    const lines = renderMap(mapWith(statuses), opts).map(lineToRuns);
    lines.push([], captionLine(caption, spin));
    frames.push(lines);
    spin += 1;
  }
}

/**
 * Which stage is on screen the moment the picture loads — index into STAGES.
 *
 * It needs saying explicitly, because the default is wrong and not obviously
 * so: the frames are stacked groups whose negative animation-delays put the
 * LAST one at t=0, so an untouched sequence opens on the end of the story — a
 * flash of the finished green map before it resets to ghosts. Rotating the
 * sequence puts the chosen stage in that slot instead. The loop is circular,
 * so nothing about the story changes except where it is entered, and the same
 * frame is the still that `prefers-reduced-motion` viewers get.
 */
const OPENS_ON_STAGE = 1;
const openAt = STAGES.slice(0, OPENS_ON_STAGE).reduce((n, [, , hold]) => n + hold, 0);
frames.push(...frames.splice(0, (openAt + 1) % frames.length));

// ---------------------------------------------------------------- SVG emit
const PALETTES = {
  dark: { bg: '#0d1117', frame: '#30363d', d: '#c9d1d9', f: '#576070', g: '#3fb950', a: '#d29922', r: '#f85149' },
  light: { bg: '#ffffff', frame: '#d0d7de', d: '#24292f', f: '#a5adb6', g: '#1a7f37', a: '#9a6700', r: '#cf222e' },
};
const CHAR_W = 7.8;
const LINE_H = 17;
const FONT = 13;
const PAD = 18;
// Two knobs, and they do different jobs: DT is the frame rate — how fast the
// spinner turns — while each stage's `hold` is how long that beat reads for.
// Speeding the animation up means lowering DT; keeping a beat legible while
// doing so means raising its hold.
const DT = 0.16;

const ARIA =
  'Animated Mellos map: one declare puts the whole ghost design on screen, the nodes light up from the ' +
  'bottom, a foundation cracks and the damage spreads upward, then green is earned back';

// Spaces become U+00A0 so a run of them survives as layout rather than being
// collapsed by an SVG renderer that ignores white-space:pre.
function escapeXml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(' ', '\u00a0');
}

function toSvg(palette) {
  const rows = Math.max(...frames.map((f) => f.length));
  const cols = Math.max(
    ...frames.flatMap((f) => f.map((runs) => runs.reduce((w, r) => Math.max(w, r.col + displayWidth(r.text)), 0))),
  );
  const width = Math.round(PAD * 2 + cols * CHAR_W);
  const height = Math.round(PAD * 2 + rows * LINE_H);
  const total = (frames.length * DT).toFixed(2);
  const slice = (100 / frames.length).toFixed(4);

  const groups = frames
    .map((frame, fi) => {
      const texts = frame
        .map((runs, li) => {
          if (runs.length === 0) return '';
          const spans = runs
            .map(
              (r) =>
                `<tspan x="${(PAD + r.col * CHAR_W).toFixed(1)}" class="${r.color}${r.bold ? ' b' : ''}">${escapeXml(r.text)}</tspan>`,
            )
            .join('');
          return `<text y="${PAD + (li + 1) * LINE_H}">${spans}</text>`;
        })
        .join('');
      return `<g class="fr" style="animation-delay:-${((frames.length - fi) * DT).toFixed(2)}s">${texts}</g>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,'Cascadia Mono',Consolas,'JetBrains Mono',Menlo,monospace" font-size="${FONT}" aria-label="${ARIA}">
<style>
text{white-space:pre;font-variant-ligatures:none}
.d{fill:${palette.d}}.f{fill:${palette.f}}.g{fill:${palette.g}}.a{fill:${palette.a}}.r{fill:${palette.r}}
.b{font-weight:600}
.fr{opacity:0;animation:fr ${total}s steps(1,end) infinite}
@keyframes fr{0%,${slice}%{opacity:1}${(Number(slice) + 0.001).toFixed(4)}%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.fr{animation:none}.fr:last-of-type{opacity:1}}
</style>
<rect width="100%" height="100%" rx="8" fill="${palette.bg}" stroke="${palette.frame}"/>
${groups}
</svg>
`;
}

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'demo.svg'), toSvg(PALETTES.dark));
writeFileSync(join(root, 'docs', 'demo-light.svg'), toSvg(PALETTES.light));
console.log(`docs/demo.svg + docs/demo-light.svg written: ${frames.length} frames, ${(frames.length * DT).toFixed(1)}s loop`);
