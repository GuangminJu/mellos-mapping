import { describe, expect, it } from 'vitest';
import { EMPTY_MAP, type MellosMap } from '../domain/types.js';
import { applyDeclare } from '../server/apply.js';
import { displayWidth } from '../render/width.js';
import { readerBack, readerContent, readerInput, readerRows, openReader } from './reader.js';
import { initialViewState, reduceView, isPointerClick } from './view-state.js';
import { parseInput, type InputEvent } from './input.js';

function fixture(): MellosMap {
  const result = applyDeclare(EMPTY_MAP, {
    layers: [{ id: 'base', name: '基础层', rank: 0 }, { id: 'api', name: '服务层', rank: 1 }],
    groups: [{ id: 'data', label: '数据记录', layer: 'base' }],
    nodes: [
      { id: 'storage', label: '持久化数据存储与完整性检查 — Persistent storage integrity checks', layer: 'base', group: 'data' },
      { id: 'events', label: '事件日志与历史记录归档 — Event journal and history archive', layer: 'base', group: 'data' },
      { id: 'sync', label: '实时同步与断线恢复处理 — Live sync and connection recovery', layer: 'api',
        detail: 'Keep complete names and design notes.', evidence: 'QA fixture: simulated reconnection regression' },
    ],
    edges: [{ from: 'sync', to: 'storage' }, { from: 'sync', to: 'events' }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const map = fixture();
const input = (state: ReturnType<typeof openReader>, event: InputEvent, currentMap = map) =>
  readerInput(state, event, currentMap, true, 40, 12);

describe('readable map navigation', () => {
  it('opens complete group membership, structured details and each linked neighbor', () => {
    let state = openReader({ kind: 'group', id: 'data' });
    const members = readerContent(map, state.page, true, 38);
    expect(members.links).toEqual(['storage', 'events']);
    expect(members.lines.map(line => line.text).join(' ')).toContain('Persistent storage integrity checks');
    expect(members.lines.every(line => displayWidth(line.text) <= 38)).toBe(true);
    state = input(state, { kind: 'activate' }).state!;
    expect(state.page).toEqual({ kind: 'node', id: 'storage' });
    const detail = readerContent(map, state.page, true, 38);
    expect(detail.links).toEqual(['sync']);
    state = input(state, { kind: 'activate' }).state!;
    expect(state.page).toEqual({ kind: 'node', id: 'sync' });
    const sync = readerContent(map, state.page, true, 38);
    expect(sync.lines.map(line => line.text).join(' ')).toContain('simulated reconnection regression');
    expect(sync.links).toEqual(['storage', 'events']);
    expect(sync.lines.find(line => line.text.includes('simulated'))?.sgr).toBe('');
    expect(sync.lines.filter(line => line.targetId !== undefined).every(line => line.sgr.endsWith(';1'))).toBe(true);
  });

  it('restores list scroll and selected link when Back unwinds the reader', () => {
    let state = openReader({ kind: 'group', id: 'data' });
    state = input(state, { kind: 'next-page' }).state!;
    state = input(state, { kind: 'pan', dx: 0, dy: 2 }).state!;
    const previous = state;
    state = input(state, { kind: 'activate' }).state!;
    expect(state.page).toEqual({ kind: 'node', id: 'events' });
    expect(readerBack(state)).toMatchObject({ page: previous.page, selected: previous.selected, scroll: previous.scroll });
    expect(readerBack(readerBack(state)!)).toBeUndefined();
  });

  it('does not let graph shortcuts or a dragged mouse release escape the reader', () => {
    const initial = openReader({ kind: 'nodes' });
    for (const event of parseInput('x1f0+-').events) {
      const result = input(initial, event);
      expect(result.state).toMatchObject({ page: initial.page, scroll: 0 });
      expect(result.overview).toBeUndefined();
    }
    let state = input(initial, { kind: 'mouse-down', x: 3, y: 4 }).state!;
    state = input(state, { kind: 'mouse-drag', x: 3, y: 5 }).state!;
    state = input(state, { kind: 'mouse-up', x: 3, y: 4 }).state!;
    expect(state.page).toEqual({ kind: 'nodes' });
    expect(state.press).toBeUndefined();
  });

  it('keeps vanished nodes and groups recoverable and follows live names without stale link indexes', () => {
    let state = openReader({ kind: 'node', id: 'sync' });
    const removed = { ...map, nodes: map.nodes.filter(node => node.id !== 'sync'), edges: [] };
    expect(readerContent(removed, state.page, true, 38).lines.map(line => line.text).join(' ')).toContain('node was removed');
    expect(input(state, { kind: 'activate' }, removed).state?.page).toEqual(state.page);
    state = openReader({ kind: 'group', id: 'data' });
    const noGroups = { ...removed, groups: [], nodes: removed.nodes.map(({ group: _group, ...node }) => node) };
    expect(readerContent(noGroups, state.page, true, 38).lines.map(line => line.text).join(' ')).toContain('Group removed');
    expect(input(state, { kind: 'nodes' }, noGroups).state?.page).toEqual({ kind: 'nodes' });
  });

  it('returns with graph pan, zoom and pin intact, but no stale hover, drag or double click', () => {
    let view = reduceView(initialViewState(), { kind: 'position', x: 9, y: 7 });
    view = reduceView(view, { kind: 'zoom', value: -2 });
    view = reduceView(view, { kind: 'select', id: 'sync' });
    view = reduceView(view, { kind: 'hover', id: 'data' });
    view = reduceView(view, { kind: 'down', x: 8, y: 5, divider: false });
    view = reduceView(view, { kind: 'cancel-gesture' });
    expect(view).toMatchObject({ offsetX: 9, offsetY: 7, zoom: -2, selectedId: 'sync', hoverId: undefined });
    expect(isPointerClick(view)).toBe(false);
    expect(view.lastClick).toBeUndefined();
  });

  it('renders bounded rows with navigable toolbar and clamps after deletion or resize', () => {
    const state = { ...openReader({ kind: 'nodes' }), scroll: 1000 };
    const content = readerContent(map, state.page, true, 38);
    const rows = readerRows(state, content, 40, 10, false);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toContain('[Back] [Overview]');
    expect(rows.every(line => displayWidth(line) <= 40)).toBe(true);
    const back = input(input(state, { kind: 'mouse-down', x: 2, y: 1 }).state!, { kind: 'mouse-up', x: 2, y: 1 });
    expect(back.state).toBeUndefined();
  });

  it('restores the clicked row highlight so Enter reopens that exact member', () => {
    let state = openReader({ kind: 'group', id: 'data' });
    const content = readerContent(map, state.page, true, 38);
    const row = content.lines.findIndex(line => line.targetId === 'events') + 2;
    state = input(state, { kind: 'mouse-down', x: 5, y: row }).state!;
    state = input(state, { kind: 'mouse-up', x: 5, y: row }).state!;
    expect(state.page).toEqual({ kind: 'node', id: 'events' });
    state = readerBack(state)!;
    expect(state.selected).toBe('events');
    expect(input(state, { kind: 'activate' }).state?.page).toEqual({ kind: 'node', id: 'events' });
  });
});
