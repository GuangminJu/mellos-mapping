/** Drive the real watcher shell through its byte input and frame adapter. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_MAP, type MellosMap } from '../domain/types.js';
import { applyDeclare } from '../server/apply.js';
import { serializeMap } from '../store/format.js';
import { runWatcher, parseArgs } from './watch.js';

const captured = vi.hoisted(() => ({ frames: [] as string[][] }));
vi.mock('./frame-output.js', () => ({ createFrameOutput: () => ({
  present: ({ rows }: { rows: string[] }) => { captured.frames.push(rows); }, invalidate() {}, close() {},
}) }));
const temporary: string[] = [];
beforeEach(() => { vi.useFakeTimers(); captured.frames = []; vi.spyOn(process, 'on').mockReturnValue(process); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(): MellosMap {
  const result = applyDeclare(EMPTY_MAP, {
    title: 'Narrow navigation fixture',
    layers: [{ id: 'base', name: '基础', rank: 0 }, { id: 'top', name: '服务', rank: 1 }],
    groups: [{ id: 'storage', label: 'Data group', layer: 'base' }, { id: 'services', label: 'API group', layer: 'top' }],
    nodes: Array.from({ length: 10 }, (_, index) => ({ id: `node-${index}`, label: `Complete node ${index} label`,
      layer: index < 5 ? 'base' : 'top', group: index < 5 ? 'storage' : 'services',
      evidence: `Evidence ${index} stays readable`, detail: 'The full design notes stay accessible.' })),
    edges: [{ from: 'node-5', to: 'node-0' }, { from: 'node-5', to: 'node-1' }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function watcher(map?: MellosMap) {
  const directory = mkdtempSync(join(tmpdir(), 'mmap-navigation-')); temporary.push(directory);
  mkdirSync(join(directory, '.mellos'), { recursive: true });
  const file = join(directory, '.mellos', 'map.json');
  let stamp = Date.now() / 1000;
  const save = (value: MellosMap) => { writeFileSync(file, serializeMap(value)); stamp++; utimesSync(file, stamp, stamp); };
  if (map !== undefined) save(map);
  const parsed = parseArgs(['--file', file, '--no-color', '--interval', '50'], directory);
  if (!parsed.ok) throw new Error('Bad fixture arguments');
  let send: (data: string) => void = () => { throw new Error('input not ready'); };
  const output = { columns: 40, rows: 30, write: () => true, once() {}, off() {}, on() {} };
  runWatcher(parsed.value, { interactive: true, input: { setRawMode() {}, resume() {}, setEncoding() {},
    on(_event, listener) { send = listener; } }, output });
  return { send: (data: string) => send(data), save, file, output,
    text: () => captured.frames.at(-1)!.join('\n'), tick: () => vi.advanceTimersByTime(60) };
}

describe('watcher reading routes', () => {
  it('auto-opens a fitting named overview once, then restores the exact graph after keyboard reading', () => {
    const pane = watcher(fixture());
    expect(pane.text()).toContain('Data group');
    expect(pane.text()).not.toContain('Complete node 0');
    pane.send('+');
    const before = pane.text();
    pane.send('n'); expect(pane.text()).toContain('Nodes / 节点');
    pane.send('\r'); expect(pane.text()).toContain('Evidence / 证据');
    pane.send('\x7f\x7f'); expect(pane.text()).toBe(before);
    pane.send('n\ro'); expect(pane.text()).toBe(before);
    // Resize and later updates may clamp the viewport, but must not auto-zoom again.
    pane.output.columns = 80; pane.tick();
    pane.output.columns = 40; pane.save({ ...fixture(), title: 'Updated fixture' }); pane.tick();
    expect(pane.text()).not.toContain('Data group');
  });

  it('contains reader keys, tracks live evidence and safely renders a removed node', () => {
    const map = fixture(), pane = watcher(map);
    pane.send('n\r');
    const bytes = readFileSync(pane.file, 'utf8');
    pane.send('xx1f0+-');
    expect(readFileSync(pane.file, 'utf8')).toBe(bytes);
    expect(pane.text()).toContain('Evidence / 证据');
    const updated = { ...map, nodes: map.nodes.map(node => node.id === 'node-0' ? { ...node, evidence: 'New evidence from live update' } : node) };
    pane.save(updated); pane.tick();
    expect(pane.text()).toContain('New evidence from live update');
    pane.save({ ...updated, nodes: updated.nodes.filter(node => node.id !== 'node-0'), edges: updated.edges.filter(edge => edge.to !== 'node-0') });
    pane.tick(); expect(pane.text()).toContain('node was removed');
    pane.send('\x7f'); expect(pane.text()).toContain('Nodes / 节点');
    pane.send('\x7f'); expect(pane.text()).not.toContain('[Back]');
  });

  it('cancels the pending auto-view on manual input before the first valid map', () => {
    const pane = watcher();
    pane.send('0'); pane.save(fixture()); pane.tick();
    expect(pane.text()).not.toContain('Data group');
    expect(pane.text()).toContain('Complete node');
  });

  it('keeps names when groups disappear from an auto-selected overview', () => {
    const map = fixture(), pane = watcher(map);
    pane.save({ ...map, groups: [], nodes: map.nodes.map(({ group: _group, ...node }) => node) }); pane.tick();
    expect(pane.text()).toContain('Complete node');
    pane.send('n'); expect(pane.text()).toContain('Nodes / 节点');
  });
});
