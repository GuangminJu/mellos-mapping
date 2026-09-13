/** tmux adapter: discover an attached session and address it without shell eval. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { watcherArgs } from './watcher-command.mjs';

const SESSION_FORMAT = '#{session_id}\t#{session_attached}';
const TARGET_FORMAT = '#{socket_path}\t#{session_id}\t#{session_created}\t#{session_attached}\t#{pane_id}';

export function createTmuxAdapter({ env = process.env, spawn = spawnSync, nodePath = process.execPath } = {}) {
  // Socket paths may contain commas. Only the final two fields are numeric.
  const inherited = /^(.*),\d+,(\d+)$/.exec(env.TMUX ?? '');
  const socket = env.MELLOS_MAPPING_TMUX_SOCKET || inherited?.[1];

  function run(args, socketPath = socket) {
    const result = spawn('tmux', [...(socketPath ? ['-S', socketPath] : []), ...args], {
      env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000, windowsHide: true,
    });
    return result.status === 0
      ? { ok: true, value: result.stdout.trim() }
      : { ok: false, error: `tmux ${args[0]} failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}` };
  }

  function inspectSession(cfg) {
    // An explicitly selected socket must not inherit a pane id from another server.
    const sameServer = !env.MELLOS_MAPPING_TMUX_SOCKET || socket === inherited?.[1];
    let selected = env.MELLOS_MAPPING_TMUX_TARGET || (sameServer && inherited
      ? (/^%\d+$/.test(env.TMUX_PANE ?? '') ? env.TMUX_PANE : `$${inherited[2]}:`)
      : undefined);
    if (!selected) {
      const listed = run(['list-sessions', '-F', SESSION_FORMAT]);
      if (!listed.ok) return listed;
      const attached = listed.value.split('\n').map(line => line.split('\t'))
        .filter(([id, count]) => /^\$\d+$/.test(id) && Number(count) > 0).map(([id]) => id);
      if (attached.length !== 1) return { ok: false, error: attached.length === 0
        ? 'No attached tmux session was found. Attach a session before retrying.'
        : `Multiple attached tmux sessions (${attached.join(', ')}). Set MELLOS_MAPPING_TMUX_TARGET to the intended session or pane in the MCP server environment before retrying.` };
      selected = `${attached[0]}:`;
    }
    const inspected = run(['display-message', '-p', '-t', selected, TARGET_FORMAT]);
    if (!inspected.ok) return inspected;
    const [socketPath, session, created, attached, pane] = inspected.value.split('\t');
    if (!socketPath || !/^\$\d+$/.test(session) || !/^\d+$/.test(created) || !/^%\d+$/.test(pane)) {
      return { ok: false, error: 'tmux returned an invalid session target; no pane was opened.' };
    }
    if (!(Number(attached) > 0)) return { ok: false, error: `tmux session ${session} has no attached client. Attach it before retrying.` };
    // Window ownership survives selecting the newly created window; splits
    // belong to the source pane, so conversations in one session stay separate.
    const identity = [socketPath, session, created, cfg.mode, cfg.mode === 'window' ? '' : pane];
    const owner = `tmux-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)}`;
    return { ok: true, value: { backend: 'tmux', socket: socketPath, session, pane, owner, owners: [owner] } };
  }

  function openPane(cfg, watchPath, mapFile, target) {
    const placement = target.mode === 'window'
      ? ['new-window', '-n', 'mellos-mapping', '-t', `${target.session}:`]
      : ['split-window', '-h', '-d', '-l', '42%', '-t', target.pane];
    const result = run([...placement, '-c', cfg.projectDir,
      nodePath, ...watcherArgs(cfg, watchPath, mapFile), '--owner', target.owner], target.socket);
    return result.ok ? { ok: true, value: { ...target, reason: 'requested' } } : result;
  }

  return { kind: 'tmux', inspectSession, openPane };
}
