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
 * One more duty lives here because it can live nowhere else: Claude Code has
 * no install-time hook, so this — the only code of ours a session runs
 * without anyone typing anything — is where the `mmap` terminal command gets
 * installed. On Windows the hook checks that the PATH shim points at THIS
 * install (one small file read); when it is missing or stale it runs
 * scripts/install-mmap-command.mjs with `--json` and relays what changed
 * through the context, so the user hears about their PATH from the
 * assistant, not from silence. The outcome object is the contract between
 * the two files.
 *
 * Two promises this file keeps because a hook runs before the user has typed
 * anything:
 *   FAST — one config read, one existsSync, one shim read; no map is parsed.
 *   The installer child process runs only when the shim is missing or stale —
 *   in the steady state it never spawns.
 *   SILENT ON FAILURE — see main(). A hook that throws must not be the reason
 *   someone's session starts badly.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  MAPPING_POLICIES,
  type MappingPolicy,
  PAGES_DIR_NAME,
  STATE_FILE_RELATIVE_PATH,
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
  const { policy, hasStore } = input;

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
    '       mmap_open {page: "<the page this effort lives on>"}',
    '     It opens the pane beside this conversation, or retargets one that is already open.',
    '  4. Watch the `pane:` line every write answers with: it says whether anybody is actually',
    '     looking. `pane: CLOSED` means the user cannot see this map — call mmap_open then too.',
    '  5. Keep the map current as the work proceeds: in-progress when a node is started,',
    '     done WITH EVIDENCE when its verification passes, regressed when something breaks.',
    'An explicit request from the user always outranks this.',
  ].join('\n');
}

/**
 * Does this project have a Mellos MAP — not merely a `.mellos/` directory?
 *
 * The two stopped being the same question when panes began publishing a
 * report while they run: opening the pane on a virgin project creates the
 * store directory before any map exists in it, and a hook that mistook that
 * for a map would tell an `on-request` session about a picture nobody ever
 * drew. A map is a page file: the default one, or the pages directory.
 *
 * Two existsSync calls, both on paths already in hand — the FAST promise in
 * the module header still holds.
 * @param stateFile - the project's default page path.
 */
export function hasMap(stateFile: string): boolean {
  return existsSync(stateFile) || existsSync(join(dirname(stateFile), PAGES_DIR_NAME));
}

/**
 * Where the `mmap` PATH shim lives, given a `%LOCALAPPDATA%`. The same
 * directory scripts/install-mmap-command.mjs owns — each side's spec pins the
 * identical literal, so the two cannot drift apart without a test failing.
 */
export function mmapShimFilePath(localAppData: string): string {
  return join(localAppData, 'mellos-mapping', 'bin', 'mmap.cmd');
}

/**
 * Does this shim already launch THIS install's `mmap`? The shim quotes the
 * bundle's absolute path, so containing it is the whole test: a missing shim,
 * another version's cache path, or a hand-edited file all read as stale — and
 * a stale shim is re-installed, never trusted.
 */
export function mmapShimCurrent(shimContent: string | undefined, mmapPath: string): boolean {
  return shimContent !== undefined && shimContent.includes(`"${mmapPath}"`);
}

/**
 * What the session is told about an installer outcome (the `--json` object of
 * scripts/install-mmap-command.mjs) — or undefined when there is nothing the
 * user needs to hear. Silence is deliberate for 'unchanged' (a refreshed shim
 * with the PATH already right is maintenance, not news) and for 'not-built'
 * (a source clone without dist is the developer's own situation).
 */
export function installContextLine(outcome: unknown): string | undefined {
  if (typeof outcome !== 'object' || outcome === null) return undefined;
  const o = outcome as { readonly kind?: unknown; readonly binDir?: unknown; readonly path?: unknown; readonly reason?: unknown };
  if (o.kind !== 'installed' || typeof o.binDir !== 'string') return undefined;
  if (o.path === 'updated') {
    return [
      'mellos-mapping: the `mmap` terminal command was just installed for the user',
      `(${o.binDir} was added to their user PATH). Typed in any project terminal, \`mmap\``,
      'toggles the map pane. The PATH change reaches only NEW processes — and a new tab of',
      'a running Windows Terminal inherits the old environment, so if the user says `mmap`',
      'is not recognized, tell them to close Windows Terminal entirely and reopen it.',
    ].join('\n');
  }
  if (o.path === 'refused' || o.path === 'error') {
    const reason = typeof o.reason === 'string' ? o.reason : 'the PATH edit failed';
    return [
      `mellos-mapping: the \`mmap\` command's launcher was written to ${o.binDir},`,
      `but the user PATH was NOT changed: ${reason}.`,
      'If the user wants the `mmap` pane-toggle command, tell them to add that directory to',
      'their user PATH (Settings > "Edit environment variables for your account").',
    ].join('\n');
  }
  return undefined;
}

/**
 * Make sure the user's `mmap` command exists and points at this install; say
 * what a session should hear about it, or undefined when there is nothing to
 * do or to say. The fast path — the usual one — is a single small file read.
 */
function ensureMmapCommand(pluginRoot: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData === undefined || localAppData === '') return undefined;
  const mmapPath = join(pluginRoot, 'dist', 'mmap.mjs');
  let shim: string | undefined;
  try {
    shim = readFileSync(mmapShimFilePath(localAppData), 'utf8');
  } catch {
    shim = undefined; // no shim yet — exactly what the install below fixes
  }
  if (mmapShimCurrent(shim, mmapPath)) return undefined;
  const run = spawnSync(
    process.execPath,
    [join(pluginRoot, 'scripts', 'install-mmap-command.mjs'), '--json'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
  );
  if (run.status !== 0 || typeof run.stdout !== 'string') return undefined;
  let outcome: unknown;
  try {
    outcome = JSON.parse(run.stdout);
  } catch {
    return undefined;
  }
  return installContextLine(outcome);
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
  // The bundle lives at <plugin root>/dist/, so the root is two up. Derived
  // rather than read from CLAUDE_PLUGIN_ROOT: the hook always knows where it
  // was installed, and an env var is one host contract more than it needs.
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const context = sessionStartContext({
    policy: scopes.value.effective,
    hasStore: hasMap(stateFile),
  });
  let installNote: string | undefined;
  try {
    installNote = ensureMmapCommand(pluginRoot);
  } catch {
    // A failed shim install must not cost the session its policy paragraph;
    // the standalone installer script exists for exactly this user to run.
    installNote = undefined;
  }
  const parts = [context, installNote].filter((p): p is string => p !== undefined);
  if (parts.length > 0) process.stdout.write(hookOutput(parts.join('\n\n')));
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
