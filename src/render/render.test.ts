/**
 * Spec for Layer 4 rendering.
 *
 * Structural assertions pin the visual contract (alignment, junctions,
 * animation, ASCII fallback); one snapshot pins the whole picture of a
 * representative map as the living example of the visual language.
 */

import { describe, expect, it } from 'vitest';

import { declareLayer, declareNode, linkNodes, setTitle, updateNode } from '../domain/ops.js';
import { EMPTY_MAP, type LayerId, type MellosMap, type NodeId, type Result } from '../domain/types.js';
import { displayWidth, renderMap } from './render.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}
const lid = (s: string): LayerId => s as LayerId;
const nid = (s: string): NodeId => s as NodeId;

const MONO = { color: false, unicode: true, spinnerFrame: 0 } as const;

/** The map of this very plugin, mid-development — the canonical sample. */
function sampleMap(): MellosMap {
  let map = setTitle(EMPTY_MAP, '梅勒斯地图 · mellos-mapping 插件');
  map = must(declareLayer(map, { id: lid('primitives'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('contracts'), name: '契约层', rank: 1 }));
  map = must(declareLayer(map, { id: lid('orchestration'), name: '编排层', rank: 2 }));
  map = must(declareNode(map, { id: nid('domain'), label: '图领域模型', layer: lid('primitives'), status: 'done' }));
  map = must(declareNode(map, { id: nid('render'), label: 'ASCII渲染', layer: lid('primitives'), status: 'in-progress' }));
  map = must(declareNode(map, { id: nid('store'), label: '状态存储', layer: lid('contracts'), status: 'done' }));
  map = must(declareNode(map, { id: nid('watch'), label: 'Watcher', layer: lid('contracts'), status: 'planned' }));
  map = must(declareNode(map, { id: nid('server'), label: 'MCP Server', layer: lid('orchestration'), status: 'planned' }));
  map = must(updateNode(map, { id: nid('domain'), evidence: 'vitest 23 passed' }));
  map = must(linkNodes(map, nid('store'), nid('domain')));
  map = must(linkNodes(map, nid('watch'), nid('render')));
  map = must(linkNodes(map, nid('server'), nid('store')));
  map = must(linkNodes(map, nid('server'), nid('watch')));
  map = must(linkNodes(map, nid('server'), nid('domain'))); // skip-level edge
  return map;
}

describe('displayWidth', () => {
  it('counts CJK characters as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('地图')).toBe(4);
    expect(displayWidth('图a图')).toBe(5);
    expect(displayWidth('⠋')).toBe(1); // braille spinner is narrow
  });
});

describe('renderMap', () => {
  it('renders the canonical sample (visual spec)', () => {
    expect(renderMap(sampleMap(), MONO).join('\n')).toMatchSnapshot();
  });

  it('keeps CJK-labelled boxes rectangular', () => {
    const lines = renderMap(sampleMap(), MONO);
    const top = lines.find((l) => l.includes('┏'))!;
    const body = lines.find((l) => l.includes('状态存储'))!;
    const boxStart = top.indexOf('┏');
    const boxEnd = top.indexOf('┓');
    expect(displayWidth(body.slice(body.indexOf('┃'), body.lastIndexOf('┃') + 1))).toBe(
      displayWidth(top.slice(boxStart, boxEnd + 1)),
    );
  });

  it('puts rank 0 at the bottom and higher ranks above', () => {
    const text = renderMap(sampleMap(), MONO).join('\n');
    expect(text.indexOf('编排层')).toBeLessThan(text.indexOf('契约层'));
    expect(text.indexOf('契约层')).toBeLessThan(text.indexOf('原语层'));
  });

  it('draws junctions where edges leave and enter boxes', () => {
    const text = renderMap(sampleMap(), MONO).join('\n');
    expect(text).toContain('┬'); // edge leaving a light bottom border
    expect(text).toContain('┷'); // edge entering a heavy (done) top border
    expect(text).toContain('┿'); // edge crossing a band bar
  });

  it('animates the spinner with the frame index and only there', () => {
    const f0 = renderMap(sampleMap(), MONO).join('\n');
    const f1 = renderMap(sampleMap(), { ...MONO, spinnerFrame: 1 }).join('\n');
    expect(f0).toContain('⠋');
    expect(f1).toContain('⠙');
    expect(f0.replace('⠋', '')).toBe(f1.replace('⠙', ''));
  });

  it('falls back to pure ASCII structure when unicode is off', () => {
    const text = renderMap(sampleMap(), { ...MONO, unicode: false }).join('\n');
    // Data (title, labels) may contain any characters; the STRUCTURE must not:
    // no box-drawing, block, geometric, dingbat or braille glyphs remain.
    const structural = [...text].filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0x2500 && cp <= 0x28ff;
    });
    expect(structural).toEqual([]);
    expect(text).toContain('# 状态存储'); // done glyph in ASCII
  });

  it('emits ANSI codes only when color is on', () => {
    expect(renderMap(sampleMap(), MONO).join('\n')).not.toContain('\x1b[');
    const colored = renderMap(sampleMap(), { ...MONO, color: true }).join('\n');
    expect(colored).toContain('\x1b[32m'); // green for done
    expect(colored).toContain('\x1b[0m');
  });

  it('explains itself when the map is empty', () => {
    const text = renderMap(EMPTY_MAP, MONO).join('\n');
    expect(text).toContain('declare layers and nodes');
  });

  it('routes skip-level edges outside the content, never through a box', () => {
    const lines = renderMap(sampleMap(), MONO);
    const content = Math.max(
      ...lines.filter((l) => l.includes('┃') || l.includes('╎')).map((l) => displayWidth(l.trimEnd())),
    );
    const barWidth = Math.max(...lines.filter((l) => l.includes('━')).map((l) => displayWidth(l.trimEnd())));
    expect(barWidth).toBeGreaterThan(content); // the margin corridor exists right of all boxes
  });
});
