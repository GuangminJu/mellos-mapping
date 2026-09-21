/**
 * Layer 4d — the omp host adapter: the SessionStart that omp does not have.
 *
 * omp (Oh My Pi) discovers this plugin the way Claude Code does — the same
 * `.claude-plugin/marketplace.json`, the same `.mcp.json` (with
 * `${CLAUDE_PLUGIN_ROOT}` and its own `${OMP_PLUGIN_ROOT}` expanded inside
 * `command`, `args`, `env` and `cwd`), the same `skills/` and `commands/`. One
 * discovery is missing: omp never reads `hooks/hooks.json`. Its hook capability
 * reads `<plugin root>/hooks/pre|post/` as TOOL hooks (`pre:<tool>` /
 * `post:<tool>`), and a session lifecycle event belongs to an EXTENSION module,
 * which a plugin declares in `package.json#omp.extensions`. So the standing
 * paragraph — the mapping policy, in front of the model from the first token —
 * is delivered from here, built by `../session-context.ts`: the SAME
 * `sessionStartContext()` the Claude hook prints, read from the same store. One
 * source, three hosts, no second dialect of the policy.
 *
 * Two promises, carried over from the hook because they are about the same
 * moment: FAST — one config read, one existsSync, one shim read, no map parsed;
 * SILENT ON FAILURE — a host adapter that throws must not be the reason a
 * session starts badly, and every fault here means exactly one thing (this
 * session is not told about mapping), so the fault is swallowed, not reported.
 *
 * An omp extension module is not a script: it default-exports a factory that
 * only REGISTERS handlers (runtime actions throw during load), and the
 * injection happens on the first `before_agent_start` after the paragraph is
 * armed — once per session, and once more whenever the session becomes a
 * different one. Arming therefore follows the host's real events, not the
 * Claude Code vocabulary: `session_start` fires only when the PROCESS creates
 * a session (omp emits it from its four setup paths and never again), while
 * starting, resuming or forking one inside a live omp goes through
 * `session_switch` (`reason: "new" | "fork" | "resume"`) and branching through
 * `session_branch`, on the same runner, with the extension modules left
 * loaded. Arming on those too is what keeps the promise the Claude hook keeps
 * with its `startup|resume|clear|compact|fork` sources; `session_compact`
 * covers the rest, because compaction is exactly where a standing instruction
 * gets lost.
 *
 * The host API is declared structurally instead of imported: this repository
 * ships no omp dependency, so the adapter keeps building — and keeps working —
 * against whatever host version a user happens to run.
 *
 * The factory body is registration and nothing else. omp states it (`runtime
 * actions throw during load`) and pi enforces it with a hard failure — every
 * action method, `setLabel` included, throws until the runtime is bound — so the
 * label is asked for from `session_start`, which is the same moment for both
 * hosts: the first one at which the host can be told something.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureMmapCommand } from '../../hook/session-start.js';
import { SESSION_CONTEXT_TYPE, sessionParagraph, storeIsReadable } from '../session-context.js';

/**
 * The sliver of omp's `ExtensionAPI` this adapter uses. Deliberately structural
 * and minimal: handlers and one label, nothing a newer host could not satisfy.
 *
 * `before_agent_start` returns a SINGLE `message`; the host collects one per
 * handler and wraps them into the run's message batch itself. Returning the
 * batch shape (`{ messages: [...] }`) is accepted without complaint and
 * silently dropped, which is why the shape is pinned here rather than guessed.
 */
export interface OmpExtensionApi {
  /** Register a handler. Registration only — omp forbids runtime actions here. */
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  /** Optional label for the host's extension listing. An ACTION: not at load. */
  setLabel?(label: string): void;
}

/** The message omp injects as a `custom` turn in front of the prompt. */
interface CustomMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
  readonly attribution: 'agent';
}

/**
 * The omp extension factory.
 *
 * State is one boolean and one memo: `armed` says whether this session still
 * owes the model the paragraph — a session start arms it, a compaction re-arms
 * it, because compaction is exactly where a standing instruction gets lost —
 * and the `mmap` install note is computed once, at session start, which is off
 * the first prompt's critical path (the same moment the Claude hook computes it
 * in).
 */
export default function mellosMappingOmp(pi: OmpExtensionApi): void {
  // The bundle lives at <plugin root>/dist/, so the root is two up — derived
  // rather than read from an env var, the same way the hook derives it: each
  // host adapter always knows where it was installed.
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  let armed = true;
  let installNote: string | undefined;
  /**
   * The paragraph the model was last told, so a CHANGE can be told again
   * without repeating an unchanged one every turn: the policy can move under a
   * long session (mmap_setup in another session, an edit to the config file),
   * and a paragraph that only ever appears once would keep describing the old
   * answer. Compaction and session boundaries re-arm regardless, because there
   * the problem is the message having been dropped, not changed.
   */
  let told: string | undefined;

  /** The paragraph is owed to whichever session comes next. */
  const rearm = async (): Promise<void> => {
    armed = true;
  };

  pi.on('session_start', async () => {
    armed = true;
    // The label is an ACTION, so it is asked for here rather than while the
    // module loads: pi fails the entire extension if a factory calls one, and
    // omp documents the same prohibition. This is the first bound moment.
    pi.setLabel?.('Mellos Mapping');
    try {
      installNote = ensureMmapCommand(pluginRoot);
    } catch {
      // A failed shim install must not cost the session its policy paragraph;
      // scripts/install-mmap-command.mjs exists for this user to run by hand.
      installNote = undefined;
    }
  });

  // omp reuses one runner for later sessions: `/new`, resume, fork and branch
  // emit `session_switch` / `session_branch` and never `session_start` again,
  // so without these arms the first session would consume the paragraph for
  // every session that follows in the same process.
  pi.on('session_switch', rearm);
  pi.on('session_branch', rearm);
  pi.on('session_compact', rearm);

  pi.on('before_agent_start', async (_event, ctx) => {
    const cwd = ctx !== null && typeof ctx === 'object' && 'cwd' in ctx ? ctx.cwd : undefined;
    const projectDir = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
    let paragraph: string | undefined;
    let broken = false;
    try {
      paragraph = sessionParagraph(projectDir);
    } catch {
      paragraph = undefined;
    }
    if (paragraph === undefined) {
      // Two different nothings. A policy that says "stay silent" is an answer
      // and consumes the arming; a store we could not READ is not — the next
      // turn gets another chance instead of the session quietly losing its
      // policy for good.
      broken = !storeIsReadable(projectDir);
    }
    const content = [paragraph, installNote].filter((part): part is string => part !== undefined).join('\n\n');
    const owed = armed || (paragraph !== undefined && paragraph !== told);
    if (!owed || broken || content === '') {
      if (!broken) armed = false;
      return undefined;
    }
    // Consumed: this session now has the current paragraph in front of it.
    armed = false;
    told = paragraph;
    const message: CustomMessage = {
      customType: SESSION_CONTEXT_TYPE,
      content,
      // Standing instruction, not conversation: the model reads it, and the
      // transcript does not grow a message the user never sent.
      display: false,
      attribution: 'agent',
    };
    return { message };
  });
}
