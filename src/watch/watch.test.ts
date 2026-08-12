/**
 * Spec for the watcher's pure helpers: width fitting/wrapping and the
 * fixed-height detail panel (node view and map dashboard).
 * (The interactive shell itself is I/O and stays untested by design.)
 */

import { describe, expect, it } from 'vitest';

import { declareGroup, declareLayer, declareNode, linkNodes, updateNode } from '../domain/ops.js';
import { EMPTY_MAP, type GroupId, type LayerId, type MellosMap, type NodeId, type Result } from '../domain/types.js';
import type { BoxHit } from '../render/render.js';
import {
  type PageTab,
  anchorOffsets,
  fitWidth,
  mapPanel,
  nearestHit,
  nodePanel,
  pageTabRow,
  wrapWidth,
} from './watch.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}
const lid = (s: string): LayerId => s as LayerId;
const nid = (s: string): NodeId => s as NodeId;
const gid = (s: string): GroupId => s as GroupId;

function sample(): MellosMap {
  let map = EMPTY_MAP;
  map = must(declareLayer(map, { id: lid('base'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('top'), name: '编排层', rank: 1 }));
  map = must(
    declareNode(map, {
      id: nid('core'),
      label: '核心',
      layer: lid('base'),
      status: 'done',
      detail: '持有全部结构不变量：层全序、节点唯一归属、边严格向下。纯函数，零异常控制流。',
    }),
  );
  map = must(updateNode(map, { id: nid('core'), evidence: 'vitest: 9 passed' }));
  map = must(declareNode(map, { id: nid('shell'), label: '外壳', layer: lid('top') }));
  map = must(declareNode(map, { id: nid('cli'), label: 'CLI', layer: lid('top'), status: 'in-progress' }));
  map = must(linkNodes(map, nid('shell'), nid('core')));
  map = must(linkNodes(map, nid('cli'), nid('core')));
  return map;
}

describe('fitWidth / wrapWidth', () => {
  it('fits CJK text to a display width with an ellipsis', () => {
    expect(fitWidth('状态存储状态存储', 8)).toBe('状态存…');
    expect(fitWidth('short', 8)).toBe('short');
  });

  it('wraps by display width, honoring embedded newlines', () => {
    expect(wrapWidth('一二三四五', 4)).toEqual(['一二', '三四', '五']);
    expect(wrapWidth('ab\ncd', 10)).toEqual(['ab', 'cd']);
    expect(wrapWidth('', 10)).toEqual([]);
  });
});

describe('nodePanel', () => {
  it('is exactly six rows: header, evidence, wires with neighbour glyphs, design notes', () => {
    const panel = nodePanel(sample(), 'core', true, 80, false)!;
    expect(panel).toHaveLength(6);
    expect(panel[0]).toEqual({ text: '■ 核心 [core] · 原语层 · done', sgr: '32;1' });
    expect(panel[1]).toEqual({ text: 'evidence: vitest: 9 passed', sgr: '90' });
    expect(panel[2]!.text).toBe('uses →  —');
    // neighbours carry their own status glyphs: ghost shell, spinning cli
    expect(panel[3]!.text).toBe('used by ←  · 外壳  ⠿ CLI');
    expect(panel[4]!.text).toContain('持有全部结构不变量');
  });

  it('marks a pinned node and falls back for missing design notes', () => {
    const pinned = nodePanel(sample(), 'shell', true, 80, true)!;
    expect(pinned[0]!.text).toContain('⊙ pinned');
    expect(pinned[4]).toEqual({ text: '(no design notes yet)', sgr: '90' });
  });

  it('clips overlong design notes with an ellipsis on the last row', () => {
    const narrow = nodePanel(sample(), 'core', true, 20, false)!;
    expect(narrow).toHaveLength(6);
    expect(narrow[5]!.text.endsWith('…')).toBe(true);
  });

  it('returns undefined for an unknown node', () => {
    expect(nodePanel(sample(), 'ghost', true, 80, false)).toBeUndefined();
  });

  it('shows a group panel — members and aggregated wires — when a group box is focused', () => {
    let map = sample();
    map = must(declareGroup(map, { id: gid('surface'), label: '外表面', layer: lid('top') }));
    map = must(updateNode(map, { id: nid('shell'), group: gid('surface') }));
    map = must(updateNode(map, { id: nid('cli'), group: gid('surface') }));

    const panel = nodePanel(map, 'surface', true, 80, true)!;
    expect(panel).toHaveLength(6);
    expect(panel[0]!.text).toContain('⠿ 外表面 [surface] · 编排层 · in-progress · 2 member(s)  ⊙ pinned');
    expect(panel[0]!.sgr).toBe('33;1');
    expect(panel[1]!.text).toBe('members: · 外壳  ⠿ CLI');
    expect(panel[2]!.text).toBe('uses →  ■ 核心'); // two member edges, deduped to one neighbour
    expect(panel[3]!.text).toBe('used by ←  —');
  });
});

describe('mapPanel (dashboard)', () => {
  it('shows title, totals and per-status counts', () => {
    const panel = mapPanel(sample(), true, 80);
    expect(panel).toHaveLength(6);
    expect(panel[1]!.text).toBe('2 layers · 3 nodes · 2 edges');
    expect(panel[2]!.text).toBe('■ 1 done   ⠿ 1 in-progress   · 1 planned');
  });
});

describe('pageTabRow', () => {
  const tabs: PageTab[] = [
    { title: '开发回放', status: 'done', active: true, fresh: false },
    { title: '多页支持', status: 'in-progress', active: false, fresh: true },
    { title: 'idle', status: 'planned', active: false, fresh: false },
  ];

  it('renders active bold in status color, fresh in status color, idle faint', () => {
    const segments = pageTabRow(tabs, 200, true);
    expect(segments.map((s) => s.text)).toEqual([' ● ■ 开发回放 ', ' ○ ⠿ 多页支持 ', ' ○ · idle ']);
    expect(segments.map((s) => s.sgr)).toEqual(['32;1', '33', '90']);
  });

  it('spans are contiguous 1-based columns matching display width', () => {
    const segments = pageTabRow(tabs, 200, true);
    expect(segments[0]!.lo).toBe(1);
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.lo).toBe(segments[i - 1]!.hi + 1);
    expect(segments[0]!.hi - segments[0]!.lo + 1).toBe(14); // ' ● ■ 开发回放 ' = 6 narrow + 4 CJK
  });

  it('drops tabs that no longer fit, truncating the last partial one', () => {
    const segments = pageTabRow(tabs, 20, true);
    expect(segments.length).toBe(2);
    expect(segments[1]!.text.endsWith('…')).toBe(true);
    expect(segments[1]!.hi).toBeLessThanOrEqual(20);
  });
});

describe('zoom anchoring', () => {
  const hit = (id: string, x: number, y: number, w = 10, h = 3): BoxHit => ({ id, x, y, w, h });

  it('keeps the anchor node at the same screen position across a zoom change', () => {
    // node center moves from x=15 to x=9 when the picture shrinks;
    // the offset must shift by the same -6 so the node does not jump.
    const moved = anchorOffsets(
      { before: hit('a', 10, 8), after: hit('a', 4, 6) },
      { x: 20, y: 5 },
      { w: 100, h: 40 },
      { w: 60, h: 30 },
    );
    expect(moved).toEqual({ x: 14, y: 3 });
  });

  it('scales the pan proportionally when there is no anchor node', () => {
    expect(anchorOffsets(undefined, { x: 50, y: 20 }, { w: 100, h: 40 }, { w: 50, h: 20 })).toEqual({ x: 25, y: 10 });
    expect(anchorOffsets(undefined, { x: 3, y: 7 }, { w: 0, h: 0 }, { w: 50, h: 20 })).toEqual({ x: 0, y: 0 });
  });

  it('finds the hit nearest to a point, and nothing in an empty picture', () => {
    const hits = [hit('far', 50, 20), hit('near', 10, 5)];
    expect(nearestHit(hits, 12, 6)?.id).toBe('near');
    expect(nearestHit([], 12, 6)).toBeUndefined();
  });
});
