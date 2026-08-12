/**
 * Spec for the watcher's pure helpers: the resident detail rows.
 * (The interactive shell itself is I/O and stays untested by design.)
 */

import { describe, expect, it } from 'vitest';

import { declareLayer, declareNode, linkNodes, updateNode } from '../domain/ops.js';
import { EMPTY_MAP, type LayerId, type MellosMap, type NodeId, type Result } from '../domain/types.js';
import { nodeDetails } from './watch.js';

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}
const lid = (s: string): LayerId => s as LayerId;
const nid = (s: string): NodeId => s as NodeId;

function sample(): MellosMap {
  let map = EMPTY_MAP;
  map = must(declareLayer(map, { id: lid('base'), name: '原语层', rank: 0 }));
  map = must(declareLayer(map, { id: lid('top'), name: '编排层', rank: 1 }));
  map = must(declareNode(map, { id: nid('core'), label: '核心', layer: lid('base'), status: 'done' }));
  map = must(updateNode(map, { id: nid('core'), evidence: 'vitest: 9 passed' }));
  map = must(declareNode(map, { id: nid('shell'), label: '外壳', layer: lid('top') }));
  map = must(declareNode(map, { id: nid('cli'), label: 'CLI', layer: lid('top') }));
  map = must(linkNodes(map, nid('shell'), nid('core')));
  map = must(linkNodes(map, nid('cli'), nid('core')));
  return map;
}

describe('nodeDetails', () => {
  it('shows status, layer, evidence and both wire directions by label', () => {
    const [line1, line2] = nodeDetails(sample(), 'core', true)!;
    expect(line1).toBe('■ 核心 [core] · 原语层 · done — vitest: 9 passed');
    expect(line2).toBe('uses → —   used by ← 外壳, CLI');
  });

  it('shows uses for an upper node and an em-dash for empty directions', () => {
    const [line1, line2] = nodeDetails(sample(), 'shell', true)!;
    expect(line1).toBe('· 外壳 [shell] · 编排层 · planned');
    expect(line2).toBe('uses → 核心   used by ← —');
  });

  it('falls back to ASCII arrows and glyphs', () => {
    const [line1, line2] = nodeDetails(sample(), 'core', false)!;
    expect(line1.startsWith('# 核心')).toBe(true);
    expect(line2).toContain('uses -> —');
  });

  it('returns undefined for an unknown node', () => {
    expect(nodeDetails(sample(), 'ghost', true)).toBeUndefined();
  });
});
