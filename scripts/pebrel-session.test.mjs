import { describe, expect, it } from 'vitest';
import { createPebrelAdapter, hostedByPebrel, shellCommandLine } from './pebrel-session.mjs';
import { preparePane, placePane } from './pane-core.mjs';

const cfg = { mode: 'split', projectDir: 'C:\\项目 folder', pageSlug: 'design', watcherFlags: ['--no-follow'] };
const env = { PEBREL_CLI: 'C:\\Pebrel\\pebrel.exe', PEBREL_PANE_ID: '9' };
const pane = (id, extra = {}) => ({ id, ssh_destination: null, ...extra });
// Pebrel 2.2 leaves zoomed_pane_id out of a tab nobody zoomed.
const tab = (panes, extra = {}) => ({ kind: 'shell', active: true, panes, ...extra });
const snapshot = (windows) => ({ process_id: 4000, windows });
const twoWindows = snapshot([
  { id: 1, tabs: [tab([pane(9)])] },
  { id: 2, tabs: [tab([pane(9), pane(12)])] },
]);
const trees = { '2:9': [{ pid: 300, executable: 'pwsh.exe', depth: 0 }, { pid: 77, depth: 3 }], '2:12': [{ pid: 500, depth: 1 }], '2:13': [{ pid: 610, executable: 'pwsh.exe', depth: 0 }] };

function harness({ state = twoWindows, procs = trees, failing = {} } = {}) {
  const calls = [];
  const adapter = createPebrelAdapter({ env, pid: 77, nodePath: 'C:\\node\\node.exe', spawn: (command, args, options) => {
    expect(command).toBe(env.PEBREL_CLI);
    expect(options.shell).toBeUndefined();
    calls.push(args.slice(1));
    const [, operation] = args;
    const flag = (name) => args[args.indexOf(name) + 1];
    if (failing[operation]) return { status: 1, stdout: JSON.stringify({ ok: false, error: { message: failing[operation] } }) };
    const result = operation === 'snapshot' ? state
      : operation === 'procs' ? { processes: procs[`${flag('--window')}:${flag('--pane')}`] ?? [] }
      : operation === 'split' ? { action: { window_id: 2, pane_id: 13 } }
      : operation === 'new-window' ? { action: { window_id: 3, pane_id: 4294967297 } }
      : { action: {} };
    return { status: 0, stdout: JSON.stringify({ ok: true, result }) };
  } });
  return { calls, adapter };
}

describe('Pebrel hosting', () => {
  it('is recognised from the pane identity Pebrel exports, unless tmux owns the conversation', () => {
    expect(hostedByPebrel(env)).toBe(true);
    expect(hostedByPebrel({ ...env, TMUX: '/tmp/tmux,1,0' })).toBe(false);
    expect(hostedByPebrel({ PEBREL_CLI: env.PEBREL_CLI })).toBe(false);
  });
});

describe('the watcher line typed into the new pane', () => {
  const argv = ['C:\\node\\node.exe', "C:\\it's ‘quoted’\\watch.mjs", '--page', 'design'];

  it('runs PowerShell argv literally and exits with the watcher', () => {
    expect(shellCommandLine('pwsh.exe', argv).value)
      .toBe("& 'C:\\node\\node.exe' 'C:\\it''s ‘‘quoted’’\\watch.mjs' '--page' 'design'; exit");
    expect(shellCommandLine('powershell.exe', ['a']).value).toBe("& 'a'; exit");
  });

  it('quotes cmd arguments and refuses what cmd would expand', () => {
    expect(shellCommandLine('cmd.exe', ['C:\\a b\\node.exe', 'x']).value).toBe('"C:\\a b\\node.exe" "x" & exit');
    expect(shellCommandLine('cmd.exe', ['C:\\100%\\node.exe']).ok).toBe(false);
  });

  it('replaces a POSIX shell with the watcher', () => {
    expect(shellCommandLine('bash', ['/node path/node', "it's"]).value).toBe("exec '/node path/node' 'it'\"'\"'s'");
  });

  it('refuses a shell whose syntax it does not know', () => {
    expect(shellCommandLine('wsl.exe', argv).error).toContain('wsl.exe');
  });
});

describe('Pebrel session discovery', () => {
  it('binds to the window whose pane process tree contains this process', () => {
    const { adapter } = harness();
    const session = adapter.inspectSession(cfg).value;
    expect(session).toMatchObject({ backend: 'pebrel', window: 2, pane: 9 });
    expect(session.owners).toEqual([session.owner]);
  });

  it('owns a split per conversation pane and one separate window per Pebrel process', () => {
    const elsewhere = harness({ procs: { ...trees, '1:9': trees['2:9'], '2:9': [] } }).adapter;
    expect(elsewhere.inspectSession(cfg).value.owner).not.toBe(harness().adapter.inspectSession(cfg).value.owner);
    const windowCfg = { ...cfg, mode: 'window' };
    expect(elsewhere.inspectSession(windowCfg).value.owner).toBe(harness().adapter.inspectSession(windowCfg).value.owner);
  });

  it('refuses to guess when this process is in none of the panes', () => {
    const { adapter } = harness({ procs: {} });
    expect(adapter.inspectSession(cfg).error).toContain('not running inside Pebrel pane 9');
  });

  it('reports a runtime failure instead of choosing a window', () => {
    const { adapter } = harness({ failing: { snapshot: 'runtime unavailable' } });
    expect(adapter.inspectSession(cfg).error).toContain('runtime unavailable');
  });
});

describe('Pebrel placement and reveal', () => {
  it('splits beside the conversation, hands focus back, sizes the map and types the watcher', () => {
    const { calls, adapter } = harness();
    const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    const placed = placePane(cfg, 'C:\\插件\\watch.mjs', 'C:\\项目 folder\\map', context.target, adapter);
    expect(placed.value.opened).toEqual({ window: 2, pane: 13 });
    expect(calls.slice(-5)).toEqual([
      ['split', '--window', '2', '--pane', '9', '--direction', 'right'],
      ['focus', '--window', '2', '--pane', '9'],
      ['resize-pane', '--window', '2', '--pane', '13', '--ratio', '0.42'],
      ['procs', '--window', '2', '--pane', '13'],
      ['prompt', '--window', '2', '--pane', '13', '--text',
        "& 'C:\\node\\node.exe' 'C:\\插件\\watch.mjs' '--file' 'C:\\项目 folder\\map' '--no-follow' '--page' 'design'" +
        ` '--owner' '${context.target.owner}'; exit`],
    ]);
  });

  it('opens its own Pebrel window only when requested', () => {
    const windowCfg = { ...cfg, mode: 'window' };
    const { calls, adapter } = harness({ procs: { ...trees, '3:4294967297': trees['2:13'] } });
    const context = preparePane(windowCfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    expect(placePane(windowCfg, 'watch', 'map', context.target, adapter).value.opened).toEqual({ window: 3, pane: 4294967297 });
    expect(calls.map(([operation]) => operation)).not.toContain('split');
    expect(calls.at(-1).slice(0, 5)).toEqual(['prompt', '--window', '3', '--pane', '4294967297']);
  });

  it('closes the pane it created when the watcher cannot be started there', () => {
    const { calls, adapter } = harness({ procs: { ...trees, '2:13': [{ pid: 610, executable: 'nu.exe', depth: 0 }] } });
    const context = preparePane(cfg, { readLiveViewers: () => [] }, 'map', adapter).value;
    expect(placePane(cfg, 'watch', 'map', context.target, adapter).error).toContain('nu.exe');
    expect(calls.at(-1)).toEqual(['close-pane', '--window', '2', '--pane', '13']);
  });

  it('brings a background split forward through the conversation and lifts another pane’s zoom', () => {
    const hidden = snapshot([{ id: 2, tabs: [tab([pane(9), pane(12)], { active: false, zoomed_pane_id: 9 })] }]);
    const { calls, adapter } = harness({ state: hidden });
    adapter.revealPane({ mode: 'split', window: 2, pane: 9 }, { pid: 500 });
    expect(calls).toContainEqual(['zoom-pane', '--window', '2', '--pane', '9', '--zoomed', 'false']);
    expect(calls).toContainEqual(['focus', '--window', '2', '--pane', '9']);
  });

  it('claims visibility only for an active, unhidden pane hosting the watcher', () => {
    const { adapter } = harness({ state: snapshot([{ id: 2, tabs: [tab([pane(9), pane(12)])] }]) });
    expect(adapter.revealPane({ mode: 'split', window: 2, pane: 9 }, { pid: 500 })).toEqual({ ok: true, value: 'visible' });
    expect(adapter.revealPane({ mode: 'split', window: 2, pane: 9 }, { pid: 999 }).ok).toBe(false);
    const stillHidden = harness({ state: snapshot([{ id: 2, tabs: [tab([pane(9), pane(12)], { active: false })] }]) }).adapter;
    expect(stillHidden.revealPane({ mode: 'split', window: 2, pane: 9 }, { pid: 500 }).ok).toBe(false);
  });
});
