#!/usr/bin/env node
/**
 * Generate the README demo animation (docs/demo.svg + docs/demo-light.svg)
 * by rendering a scripted build story through the REAL renderer — no screen
 * recording, fully reproducible: `node scripts/demo-svg.mjs`.
 *
 * Each animation frame is one renderMap() call with color on; the ANSI
 * output is converted to positioned SVG text runs and the frames cycle via
 * CSS. The story shows the core loop: ghost design → spinner climbing the
 * layers → all green → a foundation cracks and the damage spreads upward →
 * honest re-verification back to green.
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
const { renderMap } = await import(pathToFileURL(bundle).href);
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
const NODE = {
  mcp: { id: 'mcp', label: 'MCP Server', layer: 'orchestration' },
  store: { id: 'store', label: 'State Store', layer: 'contracts' },
  watcher: { id: 'watcher', label: 'Watcher', layer: 'contracts' },
  domain: { id: 'domain', label: 'Map Domain', layer: 'primitives' },
  render: { id: 'render', label: 'ASCII Renderer', layer: 'primitives' },
};

function mapWith(statuses) {
  return {
    title: 'Mellos Mapping · a build, watched live',
    layers: LAYERS,
    groups: [],
    lanes: [],
    nodes: ['mcp', 'store', 'watcher', 'domain', 'render'].map((id) => ({
      ...NODE[id],
      status: statuses[id],
    })),
    edges: EDGES,
  };
}

// [statuses, holdFrames] — the spinner keeps rotating across every frame.
const STAGES = [
  [{ mcp: 'planned', store: 'planned', watcher: 'planned', domain: 'planned', render: 'planned' }, 4],
  [{ mcp: 'planned', store: 'planned', watcher: 'planned', domain: 'in-progress', render: 'planned' }, 5],
  [{ mcp: 'planned', store: 'planned', watcher: 'planned', domain: 'done', render: 'in-progress' }, 5],
  [{ mcp: 'planned', store: 'in-progress', watcher: 'planned', domain: 'done', render: 'done' }, 5],
  [{ mcp: 'planned', store: 'done', watcher: 'in-progress', domain: 'done', render: 'done' }, 5],
  [{ mcp: 'in-progress', store: 'done', watcher: 'done', domain: 'done', render: 'done' }, 5],
  [{ mcp: 'done', store: 'done', watcher: 'done', domain: 'done', render: 'done' }, 6],
  // a foundation cracks — and the crack spreads up the dependency edges
  [{ mcp: 'regressed', store: 'done', watcher: 'regressed', domain: 'done', render: 'regressed' }, 6],
  [{ mcp: 'regressed', store: 'done', watcher: 'regressed', domain: 'done', render: 'in-progress' }, 5],
  [{ mcp: 'regressed', store: 'done', watcher: 'in-progress', domain: 'done', render: 'done' }, 4],
  [{ mcp: 'in-progress', store: 'done', watcher: 'done', domain: 'done', render: 'done' }, 4],
  [{ mcp: 'done', store: 'done', watcher: 'done', domain: 'done', render: 'done' }, 8],
];

const frames = [];
let spin = 0;
for (const [statuses, hold] of STAGES) {
  for (let i = 0; i < hold; i += 1) {
    frames.push(
      renderMap(mapWith(statuses), { color: true, unicode: true, spinnerFrame: spin, zoom: 0 }),
    );
    spin += 1;
  }
}

// ------------------------------------------------------- ANSI → styled runs
/** CJK-aware terminal column width (mirrors the renderer's own accounting). */
function charWidth(cp) {
  return (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
    ? 2
    : 1;
}

const COLOR_OF = { 31: 'r', 32: 'g', 33: 'a', 90: 'f' };

/** One rendered line → [{ col, text, color, bold }] runs. */
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
    const cp = line.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    if (current === null) {
      current = { col, text: '', color, bold };
      runs.push(current);
    }
    current.text += ch;
    col += charWidth(cp);
    i += ch.length;
  }
  return runs;
}

// ---------------------------------------------------------------- SVG emit
const PALETTES = {
  dark: { bg: '#0d1117', frame: '#30363d', d: '#c9d1d9', f: '#576070', g: '#3fb950', a: '#d29922', r: '#f85149' },
  light: { bg: '#ffffff', frame: '#d0d7de', d: '#24292f', f: '#a5adb6', g: '#1a7f37', a: '#9a6700', r: '#cf222e' },
};
const CHAR_W = 7.8;
const LINE_H = 17;
const FONT = 13;
const PAD = 18;
const DT = 0.26;

function escapeXml(s) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll(' ', ' ');
}

function toSvg(palette) {
  const parsed = frames.map((lines) => lines.map(lineToRuns));
  const rows = Math.max(...parsed.map((f) => f.length));
  const cols = Math.max(
    ...parsed.flatMap((f) =>
      f.map((runs) =>
        runs.reduce((w, r) => Math.max(w, r.col + [...r.text].reduce((n, c) => n + charWidth(c.codePointAt(0)), 0)), 0),
      ),
    ),
  );
  const width = Math.round(PAD * 2 + cols * CHAR_W);
  const height = Math.round(PAD * 2 + rows * LINE_H);
  const total = (frames.length * DT).toFixed(2);
  const slice = (100 / frames.length).toFixed(4);

  const groups = parsed
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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,'Cascadia Mono',Consolas,'JetBrains Mono',Menlo,monospace" font-size="${FONT}" aria-label="Animated Mellos map: ghost design, spinner climbing the layers, all green, a regression spreading upward, honest recovery">
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
