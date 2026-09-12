#!/usr/bin/env node
/** Reproducible comparison: prepared pane frames vs full rendering. Build first. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { declareLayer, declareNode, linkNodes, setTitle } from '../lib/domain/ops.js';
import { EMPTY_MAP } from '../lib/domain/types.js';
import { createWindowRenderer, renderMapWindow } from '../lib/render/render.js';

const must = (result) => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};
let map = setTitle(EMPTY_MAP, 'Render benchmark: 72 modules, 132 dependencies');
for (let rank = 0; rank < 6; rank++) {
  const layer = `layer-${rank}`;
  map = must(declareLayer(map, { id: layer, name: `Layer ${rank}`, rank }));
  for (let index = 0; index < 12; index++) {
    const id = `node-${rank}-${index}`;
    map = must(declareNode(map, { id, label: `Module ${rank}.${index}`, layer, status: 'in-progress' }));
    if (rank > 0) {
      map = must(linkNodes(map, id, `node-${rank - 1}-${index}`));
      map = must(linkNodes(map, id, `node-${rank - 1}-${(index + 1) % 12}`));
    }
    if (rank === 5) map = must(linkNodes(map, id, `node-0-${index}`));
  }
}
const viewport = { x: 0, y: 0, width: 100, height: 35 };
const base = { color: true, unicode: true, spinnerFrame: 0 };
const frames = 120;
const median = (samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];

function elapsed(render, animated) {
  for (let frame = 0; frame < 15; frame++) render(map, { ...base, spinnerFrame: frame % 10 }, viewport);
  const start = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    render(map, { ...base, spinnerFrame: animated ? frame % 10 : 0 }, viewport);
  }
  return performance.now() - start;
}

const results = [];
for (const animated of [false, true]) {
  const cached = createWindowRenderer();
  assert.deepEqual(cached(map, base, viewport), renderMapWindow(map, base, viewport));
  const full = [];
  const reused = [];
  for (let run = 0; run < 5; run++) {
    // Alternate order to reduce warmup and scheduling bias.
    if (run % 2 === 0) {
      full.push(elapsed(renderMapWindow, animated));
      reused.push(elapsed(cached, animated));
    } else {
      reused.push(elapsed(cached, animated));
      full.push(elapsed(renderMapWindow, animated));
    }
  }
  const fullMs = median(full);
  const reusedMs = median(reused);
  results.push({ mode: animated ? 'animated' : 'unchanged', frames,
    fullMs: +fullMs.toFixed(1), reusedMs: +reusedMs.toFixed(1), speedup: +(fullMs / reusedMs).toFixed(2) });
}
console.log(JSON.stringify({ nodes: map.nodes.length, edges: map.edges.length, results }, null, 2));
