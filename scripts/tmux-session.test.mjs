import { describe, expect, it } from 'vitest';
import { createTmuxAdapter } from './tmux-session.mjs';
import { preparePane, placePane } from './pane-core.mjs';
import { manualWatcherCommand } from './watcher-command.mjs';

const cfg = { mode: 'split', projectDir: "/work/项目 ' $(literal)", pageSlug: 'design', watcherFlags: ['--no-follow', '--interval', '500'] };
const targetReport = '/tmp/tmux socket,1\t$3\t12345\t1\t%7\t123';
function harness(env = {}, replies = {}) {
  const calls = [];
  const adapter = createTmuxAdapter({ env, nodePath: '/node path/node', spawn: (command, args, options) => {
    expect(command).toBe('tmux');
    expect(options.shell).toBeUndefined();
    expect(options.timeout).toBe(5000);
    calls.push(args);
    const operation = args[0] === '-S' ? args[2] : args[0];
    if (typeof replies[operation] === 'function') return replies[operation](args);
    if (operation === 'display-message' && args.at(-1) === '#{pane_width}') return replies.width ?? { status: 0, stdout: '180' };
    return replies[operation] ?? { status: 0, stdout: operation === 'list-sessions' ? '$3\t1\n$9\t0' : operation === 'display-message' ? targetReport : operation === 'split-window' ? args[args.indexOf('-l') + 1] : '' };
  } });
  return { calls, adapter };
}

describe('tmux session discovery', () => {
  it('uses the inherited socket and exact source pane even when another session is attached', () => {
    const { calls, adapter } = harness({ TMUX: '/tmp/tmux socket,1,42,3', TMUX_PANE: '%7' });
    const result = adapter.inspectSession(cfg);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 6)).toEqual(['-S', '/tmp/tmux socket,1', 'display-message', '-p', '-t', '%7']);
  });

  it('discovers the only attached session when the tool shell lost TMUX', () => {
    const { calls, adapter } = harness();
    expect(adapter.inspectSession(cfg).value.session).toBe('$3');
    expect(calls[1].slice(0, 4)).toEqual(['display-message', '-p', '-t', '$3:']);
  });

  it('falls back to the inherited session when TMUX_PANE was stripped', () => {
    const { calls, adapter } = harness({ TMUX: '/tmp/tmux socket,1,42,3' });
    adapter.inspectSession(cfg);
    expect(calls[0][5]).toBe('$3:');
  });

  it('refuses ambiguous or detached sessions without opening a window elsewhere', () => {
    for (const stdout of ['$3\t1\n$4\t2', '$3\t0']) {
      const { calls, adapter } = harness({}, { 'list-sessions': { status: 0, stdout } });
      expect(adapter.inspectSession(cfg).ok).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it('supports an explicit target and socket without inheriting another server’s pane', () => {
    const { calls, adapter } = harness({ TMUX: '/old,42,3', TMUX_PANE: '%7', MELLOS_MAPPING_TMUX_SOCKET: '/chosen', MELLOS_MAPPING_TMUX_TARGET: 'work:2.1' });
    expect(adapter.inspectSession(cfg).ok).toBe(true);
    expect(calls[0].slice(0, 6)).toEqual(['-S', '/chosen', 'display-message', '-p', '-t', 'work:2.1']);
    const other = harness({ TMUX: '/old,42,3', TMUX_PANE: '%7', MELLOS_MAPPING_TMUX_SOCKET: '/chosen' });
    other.adapter.inspectSession(cfg);
    expect(other.calls[0][2]).toBe('list-sessions');
  });

  it('reports missing tmux, command errors, invalid targets and unattached explicit sessions', () => {
    const cases = [
      { status: null, error: new Error('spawn tmux ENOENT') },
      { status: 1, stderr: 'no such pane' },
      { status: 0, stdout: 'malformed' },
      { status: 0, stdout: targetReport.replace('\t1\t', '\t0\t') },
    ];
    for (const reply of cases) {
      const { adapter } = harness({ MELLOS_MAPPING_TMUX_TARGET: '%7' }, { 'display-message': reply });
      expect(adapter.inspectSession(cfg).ok).toBe(false);
    }
  });
});

describe('tmux placement and reuse', () => {
  it('splits the selected pane without taking input focus and passes literal argv', () => {
    const { calls, adapter } = harness();
    const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    const result = placePane(cfg, '/plugin path/watch.mjs', "/work/it's $map", context.target, adapter);
    expect(result.ok).toBe(true);
    expect(calls.at(-1)).toEqual(['-S', '/tmp/tmux socket,1', 'split-window', '-h', '-d', '-l', '75', '-t', '%7', '-P', '-F', '#{pane_width}',
      '-c', cfg.projectDir, '/node path/node', '/plugin path/watch.mjs', '--file', "/work/it's $map",
      '--no-follow', '--interval', '500', '--page', 'design', '--owner', context.target.owner]);
  });

  it('clamps the requested width to the selected source pane and receipts measured applied columns', () => {
    const { calls, adapter } = harness({}, { width: { status: 0, stdout: '120' } });
    const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    const result = placePane({ ...cfg, widthPercent: 60 }, 'watch', 'map', context.target, adapter);
    expect(calls.at(-2)).toEqual(['-S', '/tmp/tmux socket,1', 'display-message', '-p', '-t', '%7', '#{pane_width}']);
    expect(result.value).toMatchObject({ widthPercent: 60, sourceCols: 120, appliedCols: 59, clamped: true });
    expect(calls.at(-1)).toContain('59');
    const measured = harness({}, { 'split-window': { status: 0, stdout: '74' } });
    expect(placePane(cfg, 'watch', 'map', context.target, measured.adapter).value).toMatchObject({ appliedCols: 74, clamped: true });
  });

  it('refuses new narrow splits without launching, but still reuses manually resized panes', () => {
    const { calls, adapter } = harness({}, { width: { status: 0, stdout: '60' } });
    const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    expect(placePane(cfg, 'watch', 'map', context.target, adapter).error).toContain('at least 91');
    expect(calls.some(args => args.includes('split-window'))).toBe(false);
    calls.length = 0;
    const viewer = { pid: 456, owner: context.target.owner };
    const reused = preparePane({ ...cfg, widthPercent: 60 }, { readLiveViewers: () => [viewer] }, 'map', adapter);
    expect(reused.value.viewer).toEqual(viewer);
    expect(calls.some(args => args.includes('#{pane_width}') || args.includes('resize-pane'))).toBe(false);
  });

  it('reports source measurement failures and never invents applied geometry after an unverified split', () => {
    for (const width of [{ status: 1, stderr: 'no such pane' }, { status: 0, stdout: 'unknown' }]) {
      const { calls, adapter } = harness({}, { width });
      const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
      expect(placePane(cfg, 'watch', 'map', context.target, adapter).ok).toBe(false);
      expect(calls.some(args => args.includes('split-window'))).toBe(false);
    }
    const { adapter } = harness({}, { 'split-window': { status: 0, stdout: '' } });
    const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    expect(placePane(cfg, 'watch', 'map', context.target, adapter).error).toContain('opened the split but did not report');
  });

  it('opens a new window only when requested and keeps ownership stable after it becomes active', () => {
    const windowCfg = { ...cfg, mode: 'window' };
    const { calls, adapter } = harness();
    const context = preparePane(windowCfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    placePane(windowCfg, 'watch', 'map', context.target, adapter);
    expect(calls.at(-1).slice(2, 7)).toEqual(['new-window', '-n', 'mellos-mapping', '-t', '$3:']);
    const changed = harness({}, { 'display-message': { status: 0, stdout: targetReport.replace('%7', '%8') } });
    expect(changed.adapter.inspectSession(windowCfg).value.owner).toBe(context.target.owner);
    expect(changed.adapter.inspectSession(cfg).value.owner).not.toBe(adapter.inspectSession(cfg).value.owner);
  });

  it('reuses only a viewer owned by this tmux target and keeps force available', () => {
    const { adapter } = harness();
    const owner = adapter.inspectSession(cfg).value.owner;
    const viewer = { pid: 42, owner };
    const source = { readLiveViewers: () => [{ pid: 9, owner: 'other' }, viewer] };
    expect(preparePane(cfg, source, 'map', adapter).value.viewer).toEqual(viewer);
    expect(preparePane({ ...cfg, force: true }, source, 'map', adapter).ok).toBe(true);
  });

  it('retains the original owner when discovery lands on the watcher itself', () => {
    const { adapter } = harness();
    const owner = adapter.inspectSession(cfg).value.owner;
    const watcher = { pid: 456, owner };
    const focused = harness({}, { 'display-message': { status: 0, stdout: targetReport.replace('%7\t123', '%8\t456') } });
    const context = preparePane(cfg, { readLiveViewers: () => [watcher] }, 'map', focused.adapter).value;
    expect(context.target.owner).toBe(owner);
    expect(context.viewer).toEqual(watcher);
  });

  it('selects the watcher window and reveals a pane hidden by zoom', () => {
    const { adapter, calls } = harness({}, {
      'list-panes': { status: 0, stdout: '%8\t456\t@4\t0\t1\t0' },
      'display-message': { status: 0, stdout: '1\t1\t0\t0' },
    });
    const target = { session: '$3', socket: '/socket' };
    expect(adapter.revealPane(target, { pid: 456 })).toEqual({ ok: true, value: 'visible' });
    expect(calls).toContainEqual(['-S', '/socket', 'select-window', '-t', '$3:@4']);
    expect(calls).toContainEqual(['-S', '/socket', 'resize-pane', '-Z', '-t', '%8']);
  });

  it('refuses to claim visibility for an absent watcher, detached client or still-hidden pane', () => {
    for (const [listed, visible] of [['', '1\t1\t0\t0'], ['%8\t456\t@4\t1\t0\t0', '0\t1\t0\t0'], ['%8\t456\t@4\t1\t1\t0', '1\t1\t1\t0']]) {
      const { adapter } = harness({}, { 'list-panes': { status: 0, stdout: listed }, 'display-message': { status: 0, stdout: visible } });
      expect(adapter.revealPane({ session: '$3', socket: '/socket' }, { pid: 456 }).ok).toBe(false);
    }
  });

  it('propagates a split failure without opening a replacement window', () => {
    const { calls, adapter } = harness({}, { 'split-window': { status: 1, stderr: 'no space for new pane' } });
    const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    expect(placePane(cfg, 'watch', 'map', context.target, adapter).error).toContain('no space');
    expect(calls).toHaveLength(4);
  });

  it('prints a complete POSIX fallback with literal paths, page and watcher options', () => {
    expect(manualWatcherCommand(cfg, '/plugin/watch.mjs', "/work/it's $map", '/node path/node'))
      .toBe("'/node path/node' '/plugin/watch.mjs' '--file' '/work/it'\"'\"'s $map' '--no-follow' '--interval' '500' '--page' 'design'");
  });
});
