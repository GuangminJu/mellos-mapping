/**
 * Layer 4c — the SessionStart hook: the plugin's one sentence into a session.
 *
 * The mapping policy used to be something the assistant had to go and ASK the
 * store about, per project, through a tool call it might never make. It is a
 * standing instruction, so it belongs in the session's context from the first
 * token: Claude Code runs this on every SessionStart (startup, resume, clear,
 * compact, fork) and puts what it prints in front of the model.
 *
 * The contract, verified against the docs (code.claude.com/docs/en/hooks,
 * /docs/en/plugins):
 *   - stdin carries the event as JSON: `session_id`, `transcript_path`, `cwd`
 *     (the session's working directory — the project), `hook_event_name`,
 *     `permission_mode`, and for this event a `source` of startup | resume |
 *     clear | compact | fork.
 *   - stdout, exit 0, is either JSON —
 *       {"hookSpecificOutput":{"hookEventName":"SessionStart",
 *         "additionalContext":"…"}}
 *     — or nothing at all. SessionStart cannot block a session; a non-zero
 *     exit only prints stderr to the user.
 *   - the plugin registers it in `hooks/hooks.json` at the plugin root, which
 *     Claude Code discovers without any manifest field, and the command uses
 *     `${CLAUDE_PLUGIN_ROOT}` to find this bundle.
 *
 * Every `source` gets the SAME context, deliberately: a resumed or compacted
 * session is a session that has to know the policy just as much as a fresh
 * one, and compaction is exactly where a standing instruction gets lost.
 *
 * Two promises this file keeps because a hook runs before the user has typed
 * anything:
 *   FAST — one config read and one existsSync, no map is parsed.
 *   SILENT ON FAILURE — see main(). A hook that throws must not be the reason
 *   someone's session starts badly.
 */

import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  MAPPING_POLICIES,
  type MappingPolicy,
  STATE_FILE_RELATIVE_PATH,
  STORE_DIR_NAME,
  configFilePath,
  describeMappingPolicy,
  effectiveMappingPolicy,
  userConfigFilePath,
} from '../store/store.js';

/** Everything the context depends on — all of it decided by the caller. */
export interface SessionContextInput {
  /** The policy in effect, from either scope; undefined = nobody has chosen. */
  readonly policy: MappingPolicy | undefined;
  /** This project already has a Mellos store on disk. */
  readonly hasStore: boolean;
  /** The project the session is working in (the hook's `cwd`). */
  readonly projectDir: string;
  /** Where the plugin is installed, for the commands the context names. */
  readonly pluginRoot: string;
}

/** The launcher line the context hands the assistant, with real paths in it. */
function openPaneCommand(pluginRoot: string, projectDir: string): string {
  return `node "${join(pluginRoot, 'scripts', 'open-pane.mjs')}" "${projectDir}" --page <slug>`;
}

/**
 * What the assistant is told about mapping in this session — or undefined when
 * it is told nothing at all.
 *
 * Nothing is the answer for a policy of `on-request` in a project with no map:
 * that user said "only when I ask", in a project that has never had one, and
 * spending their context window to say so every session would be the plugin
 * talking about itself. Zero noise is a feature.
 *
 * Pure: the caller reads the store, the filesystem and its own location, and
 * this decides what to say about them.
 */
export function sessionStartContext(input: SessionContextInput): string | undefined {
  const { policy, hasStore, projectDir, pluginRoot } = input;

  if (policy === undefined) {
    return [
      'mellos-mapping — first-run setup. This question is asked ONCE EVER, not once per project.',
      'Before starting structured work here, ask the user how eager mapping should be:',
      ...MAPPING_POLICIES.map((p) => `  ${p} — ${describeMappingPolicy(p)}`),
      'Record their answer with mmap_setup {policy: "<their choice>", scope: "user"} — it then applies',
      'to every project they open, and a single project can still override it with scope: "project".',
      'Do not choose for them, and do not ask again once it is recorded.',
    ].join('\n');
  }

  if (policy === 'on-request') {
    return hasStore
      ? 'mellos-mapping: this project has a Mellos map. The user\'s policy is on-request — use the mmap tools only when they ask.'
      : undefined;
  }

  const scope =
    policy === 'always'
      ? 'For ANY structured task in this project — workflows, designs, architecture, technical dependencies:'
      : 'For any MEDIUM OR COMPLEX task in this project — several modules, a new subsystem, roughly an hour of work or more (skip trivial edits):';
  return [
    `mellos-mapping policy: ${policy} — ${describeMappingPolicy(policy)}.`,
    scope,
    '  1. Load the mellos-mapping skill and follow it.',
    '  2. Declare the whole ghost design with mmap_declare BEFORE writing code.',
    '  3. Open the map pane WITHOUT asking — the recorded policy is the user\'s standing consent:',
    `       ${openPaneCommand(pluginRoot, projectDir)}`,
    '     (the slug is the page this effort lives on; the launcher retargets an already-open pane)',
    '  4. Keep the map current as the work proceeds: in-progress when a node is started,',
    '     done WITH EVIDENCE when its verification passes, regressed when something breaks.',
    'An explicit request from the user always outranks this.',
  ].join('\n');
}

/** The one field of the hook payload this hook uses. */
export interface HookInput {
  /** The session's working directory, or undefined when the payload had none. */
  readonly cwd: string | undefined;
}

/**
 * Read the hook payload. Anything unexpected — empty stdin, junk, a payload
 * without a cwd — is "no cwd", not a failure: the caller falls back to its own
 * working directory, which is what the host launched it in anyway.
 */
export function parseHookInput(raw: string): HookInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { cwd: undefined };
  }
  if (typeof parsed !== 'object' || parsed === null) return { cwd: undefined };
  const cwd = (parsed as { readonly cwd?: unknown }).cwd;
  return { cwd: typeof cwd === 'string' && cwd !== '' ? cwd : undefined };
}

/** The exact stdout a host reads, given something to say. */
export function hookOutput(additionalContext: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } });
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = process.stdin.isTTY === true ? '' : await readAll(process.stdin);
  const projectDir = parseHookInput(raw).cwd ?? process.cwd();
  const stateFile = join(projectDir, STATE_FILE_RELATIVE_PATH);
  const scopes = effectiveMappingPolicy(configFilePath(stateFile), userConfigFilePath(homedir()));
  // A configuration nobody can read is the user's problem to fix through
  // mmap_setup, where the error is explained. Shouting it into every session
  // start would be a broken file taking the whole session hostage.
  if (!scopes.ok) return;
  const context = sessionStartContext({
    policy: scopes.value.effective,
    hasStore: existsSync(join(projectDir, STORE_DIR_NAME)),
    projectDir,
    // The bundle lives at <plugin root>/dist/, so the root is two up. Derived
    // rather than read from CLAUDE_PLUGIN_ROOT: the hook always knows where it
    // was installed, and an env var is one host contract more than it needs.
    pluginRoot: dirname(dirname(fileURLToPath(import.meta.url))),
  });
  if (context !== undefined) process.stdout.write(hookOutput(context));
}

/**
 * Run only as an entry point; importing this module (the spec) must be inert —
 * not least because main() reads stdin.
 */
export function launchedAsEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return pathToFileURL(argv1).href === moduleUrl;
  }
}

if (launchedAsEntry(process.argv[1], import.meta.url)) {
  /**
   * VIOLATION: meaningful-error-handling - every fault is swallowed, and the
   * process exits 0 saying nothing.
   *
   * Why: this runs inside somebody's session start. There is no recovery worth
   * attempting here (the plugin's whole contribution is one paragraph of
   * context) and no audience for a report — stderr from a hook is printed to
   * the user as an error about a tool they did not invoke. A session that
   * begins with a stack trace because a config file had a stray brace is
   * strictly worse than one that begins without the paragraph.
   *
   * The faults this covers are already narrow: the store's own expected
   * failures are Results and handled above, so what is left is an unreadable
   * directory, an EACCES home, or a bug. Each of them means exactly one thing
   * to the user — mapping is not being suggested this session — and mmap_setup
   * says why the moment they ask.
   */
  main().catch(() => process.exit(0));
}
