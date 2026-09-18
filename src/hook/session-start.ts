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
 *   FAST — a config read, an existsSync and shim reads; no map is parsed. On
 *   Windows the fallback probe runs only when the canonical directory is off
 *   the PATH. The installer child process runs only when the shim is missing
 *   or stale, or when the command would not actually resolve — in the steady
 *   state it never spawns.
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
    '  2. Read existing pages and context with mmap_read; a new conversation is not a new effort.',
    '     Reuse the matching page and verified nodes. Use mmap_declare only for missing structure.',
    '  3. Open the map pane WITHOUT asking — the recorded policy is the user\'s standing consent:',
    '       mmap_open {page: "<the page this effort lives on>"}',
    '     It opens the pane beside this conversation, or retargets one that is already open.',
    '  4. Watch the `pane:` line every write answers with: it says whether anybody is actually',
    '     looking. `pane: CLOSED` means the user cannot see this map — call mmap_open then too.',
    '  5. Keep the map current as the work proceeds: in-progress when a node is started,',
    '     done WITH EVIDENCE when its verification passes, regressed when something breaks.',
    '     Save a concise context.next checkpoint and use expectedRevision for incremental writes.',
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
export function mmapBinDir(localAppData: string): string {
  return join(localAppData, 'mellos-mapping', 'bin');
}

/** The one shim file the fast path reads — the cmd shape of the canonical pair. */
export function mmapShimFilePath(localAppData: string): string {
  return join(mmapBinDir(localAppData), 'mmap.cmd');
}

/**
 * Per-user directories the PATH already names, in probe order — where a shim
 * goes when the PATH cannot carry the canonical directory. The twin of
 * `linkDirCandidates` in scripts/install-mmap-command.mjs; that side's spec
 * pins the same literals, so the pair cannot drift apart silently.
 */
export function mmapFallbackDirs(localAppData: string, home: string): [string, string] {
  return [join(localAppData, 'Microsoft', 'WindowsApps'), join(home, '.local', 'bin')];
}

/** Is `dir` one of `rawPath`'s entries? Case and a trailing slash do not count. */
export function pathNames(rawPath: string, dir: string): boolean {
  const norm = (s: string): string => s.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '').toLowerCase();
  return rawPath.split(';').some((entry) => entry.trim() !== '' && norm(entry) === norm(dir));
}

/** Read a file's text, or undefined when it is absent or unreadable. */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Does this shim launch THIS install's `mmap`? The shim quotes the bundle's
 * absolute path — the cmd shape with backslashes, the git-bash shape with
 * forward slashes — so BOTH forms count: a comparison that knew one form would
 * read its own sibling as a stranger. A missing shim, another install's cache
 * path, or a hand-edited file all read as stale — and a stale shim is
 * re-installed, never trusted.
 */
export function mmapShimCurrent(shimContent: string | undefined, mmapPath: string): boolean {
  if (shimContent === undefined) return false;
  return shimContent.includes(`"${mmapPath}"`) || shimContent.includes(`"${mmapPath.replaceAll('\\', '/')}"`);
}

/**
 * Whether a shim file is one of this plugin family's — the marker says so, or
 * (for shims written before the marker) the target path named the plugin. The
 * twin of `shimIsOurs` in scripts/install-mmap-command.mjs; both specs pin the
 * marker literal, so the pair cannot drift apart silently.
 */
export function shimIsOurs(content: string): boolean {
  if (content.includes('mellos-mapping mmap shim')) return true;
  const quoted = /"([^"]*mmap\.mjs)"/.exec(content)?.[1];
  return quoted !== undefined && /mellos-mapping/i.test(quoted);
}

/**
 * Whether `mmap` genuinely resolves for a new terminal: the canonical
 * directory while the PATH names it, or a fallback copy — the route a PATH
 * that refused the edit leaves — in a directory the PATH names NOW. Pure so
 * the spec can hold it; the caller passes the real environment and fs.
 *
 * The first fallback directory that holds any file is the one that decides:
 * PATH order means the earliest name wins, and copies later in the order never
 * resolve. A stranger's command there is not ours to argue with — the session
 * settles. Our own copy, stale in EITHER shape, is not a resolution: "the file
 * was written" and "the command runs the bundle it should" are different
 * claims, and only the second one short-circuits the installer.
 */
export function mmapCommandResolves(
  localAppData: string,
  mmapPath: string,
  environment: { readonly path: string; readonly home: string | undefined },
  read: (path: string) => string | undefined,
  exists: (path: string) => boolean,
): boolean {
  if (pathNames(environment.path, mmapBinDir(localAppData))) return true;
  if (environment.home === undefined || environment.home === '') return false;
  for (const dir of mmapFallbackDirs(localAppData, environment.home)) {
    if (!exists(dir) || !pathNames(environment.path, dir)) continue;
    const files = ['mmap.cmd', 'mmap']
      .map((name) => read(join(dir, name)))
      .filter((content) => content !== undefined);
    if (files.length === 0) continue;
    const ours = files.filter((content) => shimIsOurs(content));
    if (ours.length === 0) return true; // a stranger owns the name here; PATH order means they win
    return ours.every((content) => mmapShimCurrent(content, mmapPath));
  }
  return false;
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
  const o = outcome as {
    readonly kind?: unknown;
    readonly binDir?: unknown;
    readonly path?: unknown;
    readonly reason?: unknown;
    readonly alias?: unknown;
  };
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
    const aliasDir =
      typeof o.alias === 'object' && o.alias !== null && 'dir' in o.alias && typeof o.alias.dir === 'string'
        ? o.alias.dir
        : undefined;
    if (aliasDir !== undefined) {
      return [
        `mellos-mapping: the \`mmap\` terminal command should work: its shims live in`,
        `${o.binDir}, and — because the user PATH could not be changed (${reason}) — a second copy`,
        `was written to ${aliasDir}, a directory PATH already names (so \`mmap\` resolves there unless`,
        'something earlier in PATH claims the name first).',
        'The user can therefore type `mmap` in a new terminal right now; the command opens the map',
        'pane for the project it is typed in, or closes the open one.',
      ].join('\n');
    }
    return [
      `mellos-mapping: the \`mmap\` command's launcher was written to ${o.binDir},`,
      `but the user PATH was NOT changed: ${reason}.`,
      'If the user wants the `mmap` pane-toggle command, tell them to add that directory to',
      'their user PATH (Settings > "Edit environment variables for their account").',
    ].join('\n');
  }
  return undefined;
}

/**
 * Make sure the user's `mmap` command exists, points at THIS install, and
 * actually resolves for a new terminal; say what a session should hear about
 * it, or undefined when there is nothing to do or to say. The fast path — the
 * usual one — is a single small file read. When that shim IS current but the
 * command would not resolve (the canonical directory is off the PATH and the
 * fallback copy is missing, stale, or claimed by another install), the
 * installer still runs: which copy a terminal finds is not something a
 * session may assume from the canonical file alone.
 *
 * Exported for the omp host adapter (`src/host/omp/extension.ts`), which is the
 * only other code that runs at a session start: the shim is installed from
 * whichever of the two the host actually runs, never from both.
 */
export function ensureMmapCommand(pluginRoot: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData === undefined || localAppData === '') return undefined;
  const mmapPath = join(pluginRoot, 'dist', 'mmap.mjs');
  // A missing shim is exactly what the install below fixes; so is a current
  // one whose command a terminal would not resolve.
  const shim = readIfPresent(mmapShimFilePath(localAppData));
  const resolves =
    mmapShimCurrent(shim, mmapPath) &&
    mmapCommandResolves(
      localAppData,
      mmapPath,
      { path: process.env['PATH'] ?? '', home: process.env['USERPROFILE'] ?? process.env['HOME'] },
      readIfPresent,
      existsSync,
    );
  if (resolves) return undefined;
  // The installer is a plain-node script, and the host running this code is
  // not necessarily node: omp loads the plugin's adapter inside its own Bun
  // process, where `process.execPath` is the harness binary. There, node comes
  // from PATH — the same interpreter the shim being installed will call.
  const runtime = 'bun' in process.versions ? 'node' : process.execPath;
  const run = spawnSync(
    runtime,
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
