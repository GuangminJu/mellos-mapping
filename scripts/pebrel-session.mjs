/** Pebrel adapter: split the conversation's own pane through Pebrel's runtime CLI. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posixQuote, watcherArgs } from './watcher-command.mjs';

const CTL_TIMEOUT_MS = 10_000;
const SPLIT_RATIO = '0.42';
const TERMINAL_TAB_KINDS = ['shell', 'profile'];

/**
 * Pebrel exports PEBREL_CLI and PEBREL_PANE_ID to every local pane. A tmux
 * server inherits them but is not a descendant of that pane, so a conversation
 * inside tmux belongs to tmux.
 */
export function hostedByPebrel(env) {
  return Boolean(env.PEBREL_CLI && env.PEBREL_PANE_ID) && !env.TMUX;
}

/**
 * Pebrel splits always start the default shell, so the watcher is typed as one
 * line in that shell's own syntax. The line ends the shell with the watcher,
 * which closes the pane the way a wt or tmux pane closes with its command.
 */
export function shellCommandLine(executable, argv) {
  const shell = executable.toLowerCase().replace(/\.exe$/, '');
  switch (shell) {
    case 'pwsh':
    case 'powershell':
      return { ok: true, value: `& ${argv.map(powershellQuote).join(' ')}; exit` };
    case 'cmd':
      return argv.some((arg) => /["%]/.test(arg))
        ? { ok: false, error: 'cmd cannot quote a path containing " or %; no pane was kept.' }
        : { ok: true, value: `${argv.map((arg) => `"${arg}"`).join(' ')} & exit` };
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'dash':
    case 'ksh':
      return { ok: true, value: `exec ${argv.map(posixQuote).join(' ')}` };
    default:
      return { ok: false, error: `The new Pebrel pane runs ${executable}; the map starts only from PowerShell, cmd or a POSIX shell. No pane was kept.` };
  }
}

/** PowerShell ends a single-quoted string at any of the four single quotes. */
function powershellQuote(arg) {
  return `'${arg.replace(/['‘’‚‛]/g, '$&$&')}'`;
}

export function createPebrelAdapter({ env = process.env, spawn = spawnSync, nodePath = process.execPath, pid = process.pid } = {}) {
  function ctl(command, ...args) {
    const result = spawn(env.PEBREL_CLI, ['ctl', command, ...args.map(String)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CTL_TIMEOUT_MS, windowsHide: true,
    });
    const reply = parseReply(result.stdout);
    return reply?.ok === true
      ? { ok: true, value: reply.result }
      : { ok: false, error: `pebrel ctl ${command} failed: ${reply?.error?.message ?? result.error?.message ?? (result.stderr?.trim() || `exit ${result.status}`)}` };
  }

  function hosts(window, pane, processId) {
    const tree = ctl('procs', '--window', window, '--pane', pane);
    return tree.ok ? { ok: true, value: tree.value.processes.some((item) => item.pid === processId) } : tree;
  }

  function inspectSession(cfg) {
    const snapshot = ctl('snapshot');
    if (!snapshot.ok) return snapshot;
    const pane = Number(env.PEBREL_PANE_ID);
    // Pane ids are unique only within a window; the process tree says which window is ours.
    for (const window of snapshot.value.windows) {
      if (!window.tabs.some((tab) => tab.panes.some((item) => item.id === pane))) continue;
      const ours = hosts(window.id, pane, pid);
      if (!ours.ok) return ours;
      if (!ours.value) continue;
      const identity = [snapshot.value.process_id, cfg.mode, cfg.mode === 'window' ? '' : `${window.id}:${pane}`];
      const owner = `pebrel-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)}`;
      return { ok: true, value: { backend: 'pebrel', window: window.id, pane, owner, owners: [owner] } };
    }
    return { ok: false, error: `This process is not running inside Pebrel pane ${env.PEBREL_PANE_ID}; no pane was opened.` };
  }

  function createPane(target) {
    if (target.mode === 'window') return ctl('new-window');
    const split = ctl('split', '--window', target.window, '--pane', target.pane, '--direction', 'right');
    if (!split.ok) return split;
    const created = split.value.action;
    const focused = ctl('focus', '--window', target.window, '--pane', target.pane);
    const resized = focused.ok
      ? ctl('resize-pane', '--window', created.window_id, '--pane', created.pane_id, '--ratio', SPLIT_RATIO)
      : focused;
    if (resized.ok) return split;
    ctl('close-pane', '--window', created.window_id, '--pane', created.pane_id);
    return resized;
  }

  function startWatcher(cfg, watchPath, mapFile, target, created) {
    const tree = ctl('procs', '--window', created.window_id, '--pane', created.pane_id);
    if (!tree.ok) return tree;
    const shell = tree.value.processes.find((item) => item.depth === 0)?.executable ?? 'no shell';
    const line = shellCommandLine(shell, [nodePath, ...watcherArgs(cfg, watchPath, mapFile), '--owner', target.owner]);
    return line.ok ? ctl('prompt', '--window', created.window_id, '--pane', created.pane_id, '--text', line.value) : line;
  }

  function openPane(cfg, watchPath, mapFile, target) {
    const created = createPane(target);
    if (!created.ok) return created;
    const pane = created.value.action;
    const started = startWatcher(cfg, watchPath, mapFile, target, pane);
    if (started.ok) return { ok: true, value: { ...target, opened: { window: pane.window_id, pane: pane.pane_id } } };
    ctl('close-pane', '--window', pane.window_id, '--pane', pane.pane_id);
    return started;
  }

  function locate(processId) {
    const snapshot = ctl('snapshot');
    if (!snapshot.ok) return snapshot;
    for (const window of snapshot.value.windows) {
      for (const tab of window.tabs.filter((item) => TERMINAL_TAB_KINDS.includes(item.kind))) {
        for (const pane of tab.panes.filter((item) => item.ssh_destination === null)) {
          const found = hosts(window.id, pane.id, processId);
          if (!found.ok) return found;
          if (found.value) return { ok: true, value: { window, tab, pane } };
        }
      }
    }
    return { ok: false, error: 'The live watcher could not be located in any Pebrel pane; visibility is unverified.' };
  }

  function revealPane(target, viewer) {
    const located = locate(viewer.pid);
    if (!located.ok) return located;
    const { window, tab, pane } = located.value;
    if (zoomedOver(tab, pane.id)) {
      const unzoomed = ctl('zoom-pane', '--window', window.id, '--pane', tab.zoomed_pane_id, '--zoomed', 'false');
      if (!unzoomed.ok) return unzoomed;
    }
    if (!tab.active) {
      // A split shares the conversation's tab, so focusing the conversation reveals it without taking input.
      const focused = ctl('focus', '--window', window.id, '--pane', target.mode === 'window' ? pane.id : target.pane);
      if (!focused.ok) return focused;
    }
    const after = ctl('snapshot');
    if (!after.ok) return after;
    const shown = after.value.windows.find((item) => item.id === window.id)
      ?.tabs.find((item) => item.panes.some((member) => member.id === pane.id));
    return shown?.active && !zoomedOver(shown, pane.id)
      ? { ok: true, value: 'visible' }
      : { ok: false, error: 'The watcher is running, but its Pebrel pane is not visible in its window.' };
  }

  return { kind: 'pebrel', inspectSession, openPane, revealPane };
}

/** Pebrel 2.2 omits zoomed_pane_id from a tab that has no zoom. */
function zoomedOver(tab, paneId) {
  return tab.zoomed_pane_id !== undefined && tab.zoomed_pane_id !== null && tab.zoomed_pane_id !== paneId;
}

function parseReply(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}
