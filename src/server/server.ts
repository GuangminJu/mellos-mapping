/**
 * Layer 3 — the MCP server: six tools over one state file.
 *
 *   mmap_declare  grow the map (title, bands, lanes, groups, nodes, edges)
 *   mmap_update   record progress AND revise (status, evidence, moves, renames)
 *   mmap_remove   take things off the map (edges, nodes, groups, lanes, bands)
 *                 — and whole PAGES, file and all
 *   mmap_view     render the map as text, and name the project's pages
 *   mmap_setup    get/set the mapping policy (when maps open), user-wide by
 *                 default and per-project where a project must differ
 *   mmap_open     put the map on the user's screen — the one tool that reaches
 *                 outside the store, by running the same launcher a human runs
 *
 * Every write and every view also reports WHO IS SEEING IT (paneLine, from
 * the viewers channel in Layer 1). Without that line an assistant could fill
 * a ledger nobody had on screen and never learn it — the single most common
 * way this plugin used to fail its user.
 *
 * Every mutating call is load -> apply (all-or-nothing, Layer 2) -> save
 * (atomic, Layer 1). The server holds no map state between calls: the file
 * is the single source of truth, so several sessions against one project
 * stay consistent per call. A save that does not land changes nothing and is
 * reported as such — see saveFailed — so a refused write never leaves the
 * caller believing the ledger recorded something it did not.
 *
 * Deleting a PAGE is the one operation outside that transaction, and it lives
 * here rather than in Layer 2 for exactly that reason: apply.ts revises ONE
 * map as a value, and a page file is not in any map. So `mmap_remove {pages}`
 * is orchestration — validate every slug, apply the call's map edits, then
 * delete the files — and apply.ts stays pure of I/O.
 *
 * The state file lives in the project the CLIENT is working in, resolved in
 * this order: MELLOS_MAPPING_CWD (explicit override for manual runs),
 * CLAUDE_PROJECT_DIR (set by Claude Code for plugin MCP servers — the
 * documented contract), then this process's cwd as the last resort.
 *
 * The mapping policy is the one piece of state that also lives OUTSIDE the
 * project, in the user's own configuration. Both paths are resolved at the
 * entry point and handed to buildServer; nothing below reads an environment
 * variable or a home directory for itself.
 */

import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  EMPTY_MAP,
  ID_RULE,
  ID_RULE_TEXT,
  MAP_KINDS,
  type MellosMap,
  NODE_STATUSES,
  RANK_MAX,
  RANK_MIN,
  RANK_RULE_TEXT,
  type Result,
} from '../domain/types.js';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, renderMap } from '../render/render.js';
import {
  MAPPING_POLICIES,
  type MappingPolicy,
  POLICY_SCOPES,
  type LiveViewer,
  type PageId,
  type PolicyScope,
  STATE_FILE_RELATIVE_PATH,
  type StoreError,
  configFilePath,
  deletePageFile,
  describeMappingPolicy,
  describeStoreError,
  effectiveMappingPolicy,
  listPageFiles,
  migrateLegacyStore,
  loadMapFile,
  pageFilePath,
  pageIdOfFile,
  readLiveViewers,
  saveMapFile,
  saveMappingPolicy,
  userConfigFilePath,
} from '../store/store.js';
import { applyDeclare, applyRemove, applyUpdate, summarize } from './apply.js';
import { createPreviewPublisher, previewFile } from '../preview/publisher.js';
import { openWebPreview, webRuntimeFile } from '../web/launcher.js';
import { terminalHandoff } from './terminal-handoff.js';

export const SERVER_NAME = 'mellos-mapping';
export const SERVER_VERSION = '0.22.0';

// ---------------------------------------------------------------------------
// the advertised schema — what a model reads BEFORE it calls
// ---------------------------------------------------------------------------
//
// Every rule stated here is the domain's rule, imported rather than retyped:
// a schema that accepts what the domain refuses (or refuses what it accepts)
// teaches the caller a grammar the ledger does not have.
//
// Every field builds its OWN schema instance, which is not a style choice.
// The SDK converts these shapes with zod-to-json-schema, which dedupes
// identical instances into `$ref` pointers back to the first occurrence. One
// shared id instance therefore advertised sixteen id fields as pointers to
// `page` — a node id documented to the model as "the page this call targets".
// Factories cost one object per field and keep every description on the field
// it describes.

/** Length budgets of the free-text fields, in one place so no two surfaces drift. */
const TITLE_MAX = 120;
const LABEL_MAX = 60;
const DETAIL_MAX = 600;
const EVIDENCE_MAX = 200;
const EDGE_LABEL_MAX = 80;

/** A slug field — the shared id grammar of the whole system, with this field's own words. */
function id(description: string): z.ZodString {
  return z.string().regex(ID_RULE, ID_RULE_TEXT).describe(description);
}

const PAGE_DESCRIPTION =
  'page (parallel map) this call targets; omit for the default page. ' +
  'One effort = one page: start a NEW effort on its own page named after the effort, ' +
  'so concurrent sessions never write over each other and the pane can switch between pages.';

function page(): z.ZodOptional<z.ZodString> {
  return id(PAGE_DESCRIPTION).optional();
}

const STATUS_VOCABULARY =
  'planned = ghost on the map; in-progress = spinner; done = verified; regressed = was done, now broken';

/** @param note - what this particular field does with the shared vocabulary. */
function status(note: string) {
  return z.enum(NODE_STATUSES).describe(`${note}. ${STATUS_VOCABULARY}`);
}

function nodeKind(): z.ZodString {
  return id(
    'node kind rendered as a glyph prefix. Known: selector | sequence | parallel | decorator | ' +
      'condition | action (behavior trees); source | transform | sink (dataflow); ' +
      'service | db | queue | ui (architecture). Unknown kinds are kept and shown in the detail panel.',
  );
}

function mapKind() {
  return z
    .enum(MAP_KINDS)
    .describe(
      'diagram kind. dev (default) = the live progress ledger with status skins. ' +
        'The rest are documentation diagrams rendered neutrally: architecture (layered components; ' +
        'also fits call graphs and module dependencies), dataflow (source→transform→sink, stages as layers), ' +
        'behavior-tree (root on top, leaves at the bottom; also fits mind maps and WBS), ' +
        'sequence (classic call/return: rank = time step with rank 0 = EARLIEST, drawn top-down; ' +
        'declare lanes as participants and make every call AND every return its own event node in ' +
        "the acting participant's lane, edges labeled with the message). " +
        'State machines are unsupported: cycles cannot enter a Mellos map.',
    );
}

/**
 * A band's position. Range and integrality come from the domain (makeRank),
 * which refuses anything this schema lets through anyway; the schema only
 * lets the caller see the rule before it calls.
 */
function rank(): z.ZodNumber {
  return z
    .number()
    .int()
    .min(RANK_MIN)
    .max(RANK_MAX)
    .describe(`${RANK_RULE_TEXT}; must be unique among the map's bands`);
}

function edgeEnds(): { from: z.ZodString; to: z.ZodString } {
  return {
    from: id('the node that USES the other (must live on a higher layer)'),
    to: id('the node being used (must live on a strictly lower layer)'),
  };
}

/**
 * Control characters are refused where free text ENTERS the map, because
 * every reader of a map draws its text into something: a character grid, a
 * detail panel, a log line. An ESC sequence stored in a label would let a
 * map repaint — or clear — the terminal of everyone who ever opens it, and a
 * bare newline breaks the box its value sits in. Refusing them at the one
 * boundary they can come through is cheaper and far more honest than asking
 * every renderer to sanitize what it was handed.
 *
 * The refused set is C0, DEL and C1 — the characters that drive a terminal,
 * and nothing else. Format characters (U+200D and friends) stay legal on
 * purpose: real labels contain them and they steer no cursor. The ranges are
 * spelled out rather than written `\p{Cc}` because this pattern is ALSO
 * published in the tool's JSON Schema, where a Unicode property escape means
 * something else entirely to a validator that compiles it without the `u`
 * flag (there, `\p{Cc}` bans the letter c).
 */
const NO_CONTROLS = /^[^\u0000-\u001f\u007f-\u009f]*$/;
const NO_CONTROLS_TEXT = 'one line of text; control characters (ESC, newline, tab) are not allowed';

/**
 * Newlines and tabs are how a note is written, so those two are carved out
 * of the same set; everything else — ESC, BEL, and a lone CR that would
 * overwrite the line just drawn — is still refused. Line breaks are \n.
 */
const NO_CONTROLS_BUT_BREAKS = /^[^\u0000-\u0008\u000b-\u001f\u007f-\u009f]*$/;
const NO_CONTROLS_BUT_BREAKS_TEXT =
  'text with optional newlines (\\n) and tabs; other control characters (ESC, BEL, CR) are not allowed';

/**
 * One line of free text — a title, a label, a band name, an evidence note.
 * An empty string is refused: an optional field is cleared with null (the
 * domain's rule for every clearable field), never with a blank that renders
 * as an anonymous box nobody can tell from a real one.
 */
function line(max: number, description: string): z.ZodString {
  return z.string().min(1).max(max).regex(NO_CONTROLS, NO_CONTROLS_TEXT).describe(description);
}

/** A multi-line note, wrapped and re-indented by whatever panel shows it. */
function note(max: number, description: string): z.ZodString {
  return z.string().min(1).max(max).regex(NO_CONTROLS_BUT_BREAKS, NO_CONTROLS_BUT_BREAKS_TEXT).describe(description);
}

/**
 * An object that REFUSES unknown keys instead of silently dropping them.
 *
 * The advertised JSON Schema prints `additionalProperties: false` for every
 * object in this surface, but a raw shape is wrapped by the SDK in a
 * STRIPPING z.object — so a misspelled `evidance` used to vanish without a
 * word, and the ledger recorded a `done` with no evidence on it. Strict
 * objects make the runtime keep the promise the schema prints, and the
 * refusal names the offending key.
 */
function closed<T extends z.ZodRawShape>(shape: T): z.ZodObject<T, 'strict'> {
  return z.object(shape).strict();
}

/**
 * How the default page is named in the page-set line. Parenthesized on
 * purpose: a NAMED page may legitimately be called "default", and the two
 * must never read alike.
 */
const DEFAULT_PAGE_NAME = '(default)';
/** The same name when the default page has no file yet — a project whose work lives on named pages. */
const DEFAULT_PAGE_ABSENT = '(default: absent)';

/**
 * The page-set line every view carries: which pages this project HAS, and
 * which one the response is showing.
 *
 * Page discovery had no tool at all — a caller that did not already know a
 * slug could only guess, and the empty-map hint looked identical whether the
 * project had no map or five pages of one. One line answers both, cheaply
 * enough to append to every view.
 * @param stateFile - the default page's file path (the store's base).
 * @param shown - the page this response rendered; undefined = the default page.
 */
function pagesLine(stateFile: string, shown: string | undefined): string {
  const files = listPageFiles(stateFile);
  const named = files.map((f) => pageIdOfFile(stateFile, f)).filter((p): p is PageId => p !== undefined);
  const hasDefault = files.length > named.length;
  const known = [hasDefault ? DEFAULT_PAGE_NAME : DEFAULT_PAGE_ABSENT, ...named];
  return `pages: ${known.join(', ')} — this view: ${shown ?? DEFAULT_PAGE_NAME}`;
}

// ---------------------------------------------------------------------------
// the pane line — who, if anyone, is SEEING what this call just did
// ---------------------------------------------------------------------------
//
// The ledger's oldest blind spot. An assistant declared a design, lit nodes
// up as it built them, and had no way to know whether any of it was on a
// screen: opening the pane took a human typing `mmap`, and a map written into
// a store nobody had open looks exactly like a map somebody is watching.
// Users watched nothing happen and concluded the tool did nothing.
//
// So every write and every view now carries what the panes themselves report
// (readLiveViewers). It is a STATE line first — this is the fact — and an
// instruction second, because the assistant is the only party in a position
// to act on it: it knows which page it just wrote, and mmap_open takes one.

/** How a page reads in the pane line; the default page has no slug to print. */
function pageName(page: string | undefined): string {
  return page ?? DEFAULT_PAGE_NAME;
}

/**
 * One line on whether the user can SEE the page this call touched.
 *
 * @param stateFile - the default page's file path (the store's base).
 * @param touched - the page this call wrote or rendered; undefined = default.
 *
 * Four facts, and only one of them is good news:
 *   - no pane at all: the work is invisible, and opening one is the fix.
 *   - a pane on this very page: the user is watching this land.
 *   - a pane elsewhere with auto-follow on: it comes here by itself, because
 *     follow tracks the page last WRITTEN — which this call just was.
 *   - a pane elsewhere with follow off: the user pinned that page by hand.
 *     The change is real and unseen, and the honest move is to say so, not to
 *     yank their view around behind them (SKILL.md: don't fight it).
 */
function paneLine(stateFile: string, touched: string | undefined, openFailure?: string): string {
  const viewers = readLiveViewers(stateFile, Date.now());
  if (viewers.length === 0) {
    if (openFailure !== undefined) return 'pane: CLOSED — automatic opening previously failed. ' +
      'Do not retry mmap_open until the terminal environment changes or the user asks to retry. ' +
      `The map is saved; mmap_view remains available inline. Last failure: ${openFailure}`;
    return (
      'pane: CLOSED — nobody is seeing this map. Open it with mmap_open ' +
      `{page: ${touched === undefined ? '(omit for the default page)' : `"${touched}"`}} ` +
      'and do not ask first: a user with a mapping policy has already said they want the picture.'
    );
  }
  if (viewers.some((v) => v.page === touched)) return 'pane: open on this page — the user is seeing this.';
  const elsewhere = [...new Set(viewers.map((v) => pageName(v.page)))].join(', ');
  if (viewers.some((v) => v.follow)) {
    return `pane: open on ${elsewhere}, auto-follow on — it lands on this page within a second.`;
  }
  return (
    `pane: open on ${elsewhere}, auto-follow OFF — the user pinned that page, so this change is ` +
    'NOT on their screen. Tell them rather than switching it behind them; mmap_open {page} ' +
    'retargets the pane if they want it moved.'
  );
}

// ---------------------------------------------------------------------------
// mmap_open — the assistant's own way to put the map on a screen
// ---------------------------------------------------------------------------
//
// Opening the pane used to be a human's job: `/mmap`, or the `mmap` command,
// or a node command line the assistant had to be told to run through a shell
// it may not be allowed to use. So the map went un-opened, the ledger filled
// up unseen, and the plugin looked broken to the one person it is for.
//
// This is the only tool that touches anything outside the store, and it does
// as little of that as it can: it runs the SAME launcher a human runs
// (scripts/open-pane.mjs) and reports what came of it. Two consequences are
// deliberate. It cannot close a pane — the launcher has no such power, so
// neither has any assistant driving it; taking the map off a user's screen
// stays theirs (the `q` key, or `mmap` in a terminal). And it cannot place a
// pane differently from the way the human command does, because there is one
// placement policy and it lives in the launcher.

/**
 * How long the launcher may run before it is abandoned. It is the sum of what
 * the launcher itself allows — 30s probe, 5s focus, 15s wt and 8s handshake — so
 * this timeout can only fire when the launcher has stopped answering, never
 * on a slow-but-working machine.
 */
const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * How long to wait for the NEW pane to report itself in (the viewers channel)
 * before answering without it. Generous next to a pane's first heartbeat: a
 * cold `wt` window, node's startup and the first paint all happen in here.
 */
const PANE_REPORT_TIMEOUT_MS = 8_000;

/** How often the wait above looks. */
const PANE_REPORT_POLL_MS = 250;

/**
 * Where the agent's launcher lives, given this module's URL.
 *
 * One rule serves both shapes this module runs in, because both sit exactly
 * one directory below the root: `dist/server.mjs` in an installed plugin,
 * `src/server/server.ts` in a checkout under test.
 */
export function launcherPath(moduleUrl: string): string {
  return join(dirname(dirname(fileURLToPath(moduleUrl))), 'scripts', 'open-pane.mjs');
}

/** The project a store belongs to: `<project>/.mellos/map.json` -> `<project>`. */
export function projectDirOf(stateFile: string): string {
  return dirname(dirname(stateFile));
}

/**
 * The launcher's command line for one open request — the whole translation
 * from tool arguments to the flags scripts/open-pane.mjs understands.
 */
export function launcherArgs(projectDir: string, page: string | undefined, window: boolean): string[] {
  const args = [projectDir];
  if (page !== undefined) args.push('--page', page);
  if (window) args.push('--window');
  return args;
}

/** What running the launcher came to. */
export interface LauncherRun {
  /** It exited 0: the pane was placed, or an already-open one was retargeted. */
  readonly ok: boolean;
  /** Everything it said, both streams, trimmed — including its `MMAP_PANE …` line. */
  readonly output: string;
}

/**
 * Run the launcher and collect what it said.
 *
 * stdio is PIPED, never inherited: this process's stdout is the JSON-RPC
 * channel, and one line of a child's chatter on it would end the session.
 * Asynchronous for the same reason the server is — a spawnSync here would
 * hold the whole server still for as long as a window probe takes.
 */
function runLauncher(script: string, args: readonly string[]): Promise<LauncherRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const abandon = setTimeout(() => child.kill(), LAUNCH_TIMEOUT_MS);
    child.on('error', (e: Error) => {
      clearTimeout(abandon);
      resolve({ ok: false, output: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(abandon);
      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}

/** Resolve the installed launcher at the process boundary, independently of map operations. */
function launchPane(args: readonly string[]): Promise<LauncherRun> {
  const script = launcherPath(import.meta.url);
  if (!existsSync(script)) return Promise.resolve({ ok: false,
    output: `the launcher is missing at ${script}. This install is incomplete — reinstall the plugin (a source checkout needs "npm run build").`,
  });
  return runLauncher(script, args);
}

/**
 * Is what was asked for on a screen?
 *
 * A call that named a page is answered by THAT page being shown. A call
 * that named none asked for the map, not for a particular page of it, so
 * any live pane answers it — including the one that was already open, which
 * would otherwise be waited on for a page it was never asked to switch to.
 */
function paneShows(viewers: readonly LiveViewer[], page: string | undefined): boolean {
  return page === undefined ? viewers.length > 0 : viewers.some((v) => v.page === page);
}

/** Wait until a pane shows what was asked for, or until the deadline passes. */
async function awaitPane(stateFile: string, page: string | undefined, deadlineMs: number, pid?: number): Promise<readonly LiveViewer[]> {
  for (;;) {
    const viewers = readLiveViewers(stateFile, Date.now()).filter((viewer) => pid === undefined || viewer.pid === pid);
    if (paneShows(viewers, page)) return viewers;
    if (Date.now() >= deadlineMs) return viewers;
    await new Promise((r) => setTimeout(r, PANE_REPORT_POLL_MS));
  }
}

/**
 * What to tell the caller, given how the launcher went and what the panes
 * report afterwards. Pure, so the wording is a thing the spec can hold.
 *
 * The distinction that matters is between "a pane exists" and "the page you
 * are working on is on it" — the first was always guessable from the exit
 * code, and it is the second that the user actually experiences.
 */
export function openOutcome(run: LauncherRun, viewers: readonly LiveViewer[], page: string | undefined): string {
  const pid = launcherViewerPid(run);
  viewers = viewers.filter((viewer) => pid === undefined || viewer.pid === pid);
  if (!run.ok) {
    return (
      `could not open the pane: ${run.output === '' ? 'the launcher failed without saying why' : run.output}\n` +
      'Relay the launcher reason and any copyable fallback command. Do not retry mmap_open until the terminal environment changes or the user asks to retry. A failed default split is not permission to open a separate window.'
    );
  }
  if (paneShows(viewers, page)) {
    return `pane: open and showing ${pageName(page)} — the user can see the map now.\n${run.output}`;
  }
  if (viewers.length > 0) {
    const elsewhere = [...new Set(viewers.map((v) => pageName(v.page)))].join(', ');
    return (
      `pane: open, but it reports ${elsewhere} rather than ${pageName(page)}. With auto-follow on it ` +
      'lands there on your next write; with follow off the user is holding that page on purpose.\n' +
      run.output
    );
  }
  return (
    `the launcher succeeded but no pane has reported in within ${PANE_REPORT_TIMEOUT_MS / 1000}s. It may still be ` +
    'starting; the `pane:` line on your next write says whether it made it.\n' +
    run.output
  );
}

/** A placement receipt binds verification to that exact watcher. */
function launcherViewerPid(run: LauncherRun): number | undefined {
  const raw = /^MMAP_PANE [^\r\n]*\bpid=([1-9]\d*)(?:\s|$)/m.exec(run.output)?.[1];
  return raw === undefined ? undefined : Number(raw);
}

interface ToolText {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function text(s: string, isError = false): ToolText {
  return { content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) };
}

/**
 * The one answer to a write that did not land, so both save sites say the
 * same thing: the previous file is intact, this call changed nothing, and
 * calling again is the whole recovery.
 */
function saveFailed(error: StoreError): ToolText {
  return text(`save failed, nothing changed (retry): ${describeStoreError(error)}`, true);
}

/** Load the map, treating a missing file as an empty map (first declare creates it). */
function loadOrEmpty(stateFile: string): Result<MellosMap, string> {
  const loaded = loadMapFile(stateFile);
  if (loaded.ok) return { ok: true, value: loaded.value };
  if (loaded.error.kind === 'not-found') return { ok: true, value: EMPTY_MAP };
  return { ok: false, error: describeStoreError(loaded.error) };
}

/**
 * Build the MCP server bound to one project's store.
 *
 * @param stateFile - the project's DEFAULT page file; every page and the
 *   project-scope configuration are derived from it.
 * @param userConfigFile - the USER-scope configuration file
 *   ({@link userConfigFilePath}). Passed in rather than resolved here, so a
 *   spec's server can never read — or write — the developer's real one.
 * Exported for tests.
 */
export function buildServer(stateFile: string, userConfigFile: string, launch: (args: readonly string[]) => Promise<LauncherRun> = launchPane): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  // Session-local failure feedback prevents each map write from re-requesting
  // the same unavailable terminal. An explicit successful retry clears it.
  let paneOpenFailure: string | undefined;
  const currentPaneLine = (page: string | undefined): string => paneLine(stateFile, page, paneOpenFailure);
  const projectConfigFile = configFilePath(stateFile);
  const previews = createPreviewPublisher(stateFile);
  const refreshPreview = (page: string | undefined): string => {
    if (!previews.enabled()) return '';
    const published = previews.refresh(page as PageId | undefined);
    return published.ok
      ? `\npreview: updated\nmarkdown: ${published.value.path}\nFile generated; desktop visibility is not tracked.`
      : `\npreview: STALE — map changes were saved, but preview generation failed: ${published.error}. Retry mmap_open {surface: "markdown"}; do not repeat the map mutation.`;
  };

  // The zod PAGE schema enforces the exact PageId grammar, so the cast at
  // this boundary cannot smuggle in an invalid slug.
  const fileOf = (page: string | undefined): string => pageFilePath(stateFile, page as PageId | undefined);

  const mutate = (page: string | undefined, apply: (map: MellosMap) => Result<MellosMap, string>): ToolText => {
    const file = fileOf(page);
    const current = loadOrEmpty(file);
    if (!current.ok) return text(current.error, true);
    const applied = apply(current.value);
    if (!applied.ok) return text(`refused (nothing changed): ${applied.error}`, true);
    const saved = saveMapFile(file, applied.value);
    if (!saved.ok) return saveFailed(saved.error);
    return text(summarize(applied.value) + (page !== undefined ? ` [page: ${page}]` : '') + refreshPreview(page));
  };


  /**
   * Append the pane line to a result that actually happened.
   *
   * Refusals and failed saves are left alone: they are about the CALL, and
   * telling a caller who was watching a write that did not occur would only
   * bury the reason it did not.
   */
  const withPane = (result: ToolText, page: string | undefined): ToolText =>
    result.isError === true || previews.enabled() ? result : text(`${result.content[0]?.text ?? ''}\n${existsSync(webRuntimeFile(stateFile)) ? 'web: configured — the browser reads project map updates. Use mmap_open {surface: "web", page} to open or reconnect; desktop visibility is not tracked.' : currentPaneLine(page)}`);
  /** The named pages this project has right now, read from the store. */
  const knownPages = (): PageId[] =>
    listPageFiles(stateFile)
      .map((f) => pageIdOfFile(stateFile, f))
      .filter((p): p is PageId => p !== undefined);

  /**
   * The VALIDATE half of `mmap_remove {pages}` — everything that can be
   * refused while the store is still untouched.
   * @returns the refusal, or undefined when every slug may be deleted.
   *
   * Two rules, both stricter than the store primitive underneath (which
   * happily deletes a page that is already gone):
   *
   *   - A call may not delete the page it is itself editing. `page` chooses
   *     the map this call loads, applies to and saves; deleting that same
   *     page in the same call is a request with two answers, and the save
   *     would simply recreate what the deletion removed.
   *   - An unknown slug is a REFUSAL, not a no-op. deletePageFile treats an
   *     absent file as the goal state already reached, which is right for a
   *     primitive; at the tool surface the caller is a model that just typed
   *     a name, and a name that matches no page is far more likely a typo
   *     than a page someone else deleted a moment ago. The refusal names the
   *     project's real pages, so the next call can be right.
   */
  const refusePageDeletion = (pages: readonly string[], target: string | undefined): ToolText | undefined => {
    if (target !== undefined && pages.includes(target)) {
      return text(
        `refused (nothing changed): pages includes "${target}", the page this call targets — ` +
          'one call must not edit a map it is deleting. Delete it from a call that does not target it.',
        true,
      );
    }
    const known = knownPages() as readonly string[];
    const unknown = pages.filter((p) => !known.includes(p));
    if (unknown.length > 0) {
      return text(
        `refused (nothing changed): no page named ${unknown.map((p) => `"${p}"`).join(', ')}. ` +
          `This project's named pages: ${known.length > 0 ? known.join(', ') : '(none)'}.`,
        true,
      );
    }
    return undefined;
  };

  /**
   * The COMMIT half of `mmap_remove {pages}`: every slug is known to exist
   * and none is this call's own page. Deletions are not a transaction — a
   * file that is gone cannot come back if the next one fails — so a partial
   * batch reports exactly which pages went and which did not, rather than
   * pretending it rolled anything back.
   * @param summary - the map-edit summary to carry, already newline-ended.
   */
  const deletePages = (pages: readonly string[], summary: string): ToolText => {
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const p of pages) {
      const removed = deletePageFile(pageFilePath(stateFile, p as PageId));
      if (removed.ok) deleted.push(p);
      else failed.push(`${p} (${describeStoreError(removed.error)})`);
    }
    const gone = `deleted page(s): ${deleted.length > 0 ? deleted.join(', ') : '(none)'}` + (deleted.length ? refreshPreview(undefined) : '');
    if (failed.length === 0) return text(`${summary}${gone}`);
    return text(
      `${summary}${gone}; could NOT delete: ${failed.join('; ')}. ` +
        'Deleting files is not a transaction: what is named deleted above is gone for good, ' +
        'and only the failures are worth retrying.',
      true,
    );
  };

  /**
   * The last-resort acquisition path for the setup question.
   *
   * A declare carries this note only while NEITHER scope has a policy — so it
   * fires at most until the user's one-time, user-level answer, and after that
   * it is silent forever, in every project they ever open.
   *
   * Why it survives at all now that Claude Code asks the question from a
   * SessionStart hook (src/hook/session-start.ts): other hosts have no hooks.
   * Under Codex CLI, or any bare MCP client, this note is the ONLY thing that
   * ever tells the assistant to ask. It never blocks (the ledger is not a
   * judge); a broken config file is surfaced here the same way instead of
   * being silently treated as unset.
   */
  const setupNudge = (): string => {
    const scopes = effectiveMappingPolicy(projectConfigFile, userConfigFile);
    if (!scopes.ok) return `\nnote: ${describeStoreError(scopes.error)} — fix it or rerun setup (mmap_setup).`;
    if (scopes.value.effective !== undefined) return '';
    return (
      '\nnote: no mapping policy has been chosen yet. Ask the user when maps should open — ' +
      MAPPING_POLICIES.map((p) => `${p} (${describeMappingPolicy(p)})`).join('; ') +
      ' — then record the answer with mmap_setup. It is asked once ever, not once per project.'
    );
  };

  server.registerTool(
    'mmap_declare',
    {
      title: 'Declare map structure',
      description:
        'Grow the Mellos map: set the title and diagram kind, add layer bands, lanes and groups ' +
        '(labeled subsystems within ONE band — declare them when a single band grows crowded, ' +
        'roughly five or more nodes in that band; a group must be a strict subset of its band, ' +
        'and a map spread thin across many bands needs none), add nodes, add dependency edges. Declare the ' +
        'whole ghost design up front, then grow it as understanding deepens. Edges must point ' +
        'strictly downward (a node may only use nodes on lower layers); the batch is all-or-nothing. ' +
        'The title lives here and only here: pass it again to replace it, or null to remove it. ' +
        'Revising what already exists (moving, renaming, relabeling, clearing) is mmap_update.',
      inputSchema: closed({
        page: page(),
        title: line(TITLE_MAX, 'map title, e.g. the feature being built; null removes it')
          .nullable()
          .optional(),
        kind: mapKind().optional(),
        lanes: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the lane'),
              label: line(LABEL_MAX, 'column name, e.g. a sequence participant'),
            }),
          )
          .optional()
          .describe('vertical columns crossing all bands; declaration order = left-to-right'),
        layers: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the band'),
              name: line(LABEL_MAX, 'display name of the band'),
              rank: rank(),
            }),
          )
          .optional(),
        groups: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the group'),
              label: line(LABEL_MAX, 'subsystem name shown at the far zoom'),
              layer: id('band this group clusters; members must live on the same band'),
            }),
          )
          .optional(),
        nodes: z
          .array(
            closed({
              id: id('stable kebab-case identifier of the node'),
              label: line(LABEL_MAX, 'display label inside the box'),
              layer: id('id of the band this node lives in'),
              status: status('defaults to planned').optional(),
              evidence: line(
                EVIDENCE_MAX,
                'how an already-verified node was verified; for regressed: what broke. ' +
                  'Declaring a node straight to done needs it as much as updating one does.',
              ).optional(),
              detail: note(
                DETAIL_MAX,
                'design notes shown in the pane detail panel: responsibility, contract, key decisions',
              ).optional(),
              group: id('same-band group this node belongs to').optional(),
              kind: nodeKind().optional(),
              lane: id('lane (column) this node belongs to').optional(),
              submap: id(
                'page slug of this node\'s child map — the pane badges the node ⊞ and double-click ' +
                  'dives in. Declare the child page separately. Create a sub-map only when the ' +
                  "node's internals genuinely deserve their own picture; most nodes need none.",
              ).optional(),
            }),
          )
          .optional(),
        edges: z
          .array(
            closed({
              ...edgeEnds(),
              label: line(EDGE_LABEL_MAX, 'what flows along the edge').optional(),
            }),
          )
          .optional(),
      }),
    },
    (input) => {
      const result = withPane(mutate(input.page, (map) => applyDeclare(map, input)), input.page);
      if (result.isError === true) return result;
      const nudge = setupNudge();
      return nudge === '' ? result : text((result.content[0]?.text ?? '') + nudge);
    },
  );

  server.registerTool(
    'mmap_update',
    {
      title: 'Record progress and revise the map',
      description:
        'The revision tool, all-or-nothing. Record progress on nodes: in-progress when starting a ' +
        'node (the pane spins), done with evidence when its verification passes, regressed with ' +
        'evidence when a done node breaks. Revise what the ghost design got wrong: move a node to ' +
        'another band, join or leave a group or lane, rename a band (or re-rank it, which reorders ' +
        'the whole map), relabel a group or a lane. Every clearable field takes null to empty it — ' +
        'that is how a field is cleared, never an empty string. Bands, groups and lanes are applied ' +
        'before the node updates, and within one node update `layer` moves the node before its ' +
        'other fields. The map is a ledger: report honestly, it never blocks you.',
      inputSchema: closed({
        page: page(),
        updates: z
          .array(
            closed({
              id: id('id of the node to update'),
              status: status('the status to record').optional(),
              label: line(LABEL_MAX, 'new display label inside the box').optional(),
              evidence: line(EVIDENCE_MAX, 'for done: how it was verified; for regressed: what broke; null clears it')
                .nullable()
                .optional(),
              detail: note(
                DETAIL_MAX,
                'design notes shown in the pane detail panel: responsibility, contract, key decisions; ' +
                  'null clears them',
              )
                .nullable()
                .optional(),
              layer: id(
                "move the node to this band; applied before this item's other fields, so a node can " +
                  'move and join a group on the new band in one item. Every edge touching it must still ' +
                  "point strictly downward, and a grouped node may only move to its group's band.",
              ).optional(),
              group: id('join this same-band group; null leaves the current group').nullable().optional(),
              kind: nodeKind().nullable().optional(),
              lane: id('join this lane; null leaves the current lane').nullable().optional(),
              submap: id('link a child map page by slug; null unlinks it').nullable().optional(),
            }),
          )
          .min(1)
          .optional(),
        layers: z
          .array(
            closed({
              id: id('id of the band to revise'),
              name: line(LABEL_MAX, 'new display name of the band').optional(),
              rank: rank().optional(),
            }),
          )
          .min(1)
          .optional()
          .describe('rename and/or re-rank existing bands; an item must carry a name, a rank, or both'),
        groups: z
          .array(closed({ id: id('id of the group to relabel'), label: line(LABEL_MAX, 'new subsystem name') }))
          .min(1)
          .optional()
          .describe('relabel existing groups; membership and band are untouched'),
        lanes: z
          .array(closed({ id: id('id of the lane to relabel'), label: line(LABEL_MAX, 'new column name') }))
          .min(1)
          .optional()
          .describe('relabel existing lanes; order and membership are untouched'),
      }),
    },
    (input) => withPane(mutate(input.page, (map) => applyUpdate(map, input)), input.page),
  );

  server.registerTool(
    'mmap_remove',
    {
      title: 'Revise the map',
      description:
        'Remove edges, nodes, groups and empty layer bands (in that order, all-or-nothing). ' +
        'Removing a node also removes every edge touching it; removing a group merely ungroups ' +
        'its members. Use when the ghost design turns out wrong — the map is a hypothesis, ' +
        'revising it is honest work. ' +
        '`pages` is the other scale: it DELETES whole page files, so a finished effort can be ' +
        'cleaned up instead of accumulating tabs forever. A bare `{pages: ["slug"]}` with no ' +
        'other field is the normal form; combined with map edits, the edits are applied first ' +
        'and the pages are deleted after. The deletion is permanent and cannot be undone, so ' +
        'delete only pages whose effort is over — and only ever with the user behind it. ' +
        'An unknown slug is refused with the project\'s real page list (naming a page that does ' +
        'not exist is a typo, not a request). The default page has no slug and is not deletable ' +
        'here. A node elsewhere still pointing at a deleted page with `submap` stays legal — a ' +
        'submap reference has no existence invariant — but it has nowhere to dive until the ' +
        'page comes back.',
      inputSchema: closed({
        page: page(),
        edges: z.array(closed(edgeEnds())).optional(),
        nodes: z.array(id('id of the node to remove, with every edge touching it')).optional(),
        groups: z.array(id('id of the group to remove; members stay, merely ungrouped')).optional(),
        lanes: z.array(id('id of the lane to remove; members stay, merely off-lane')).optional(),
        layers: z.array(id('id of the band to remove; it must hold no nodes and no groups')).optional(),
        pages: z
          .array(
            id(
              'slug of a page whose WHOLE map file is deleted — the page and everything drawn on ' +
                'it. Not the page this same call targets with `page`.',
            ),
          )
          .optional()
          .describe('pages to delete entirely, after this call\'s map edits; permanent'),
      }),
    },
    (input) => {
      if (input.pages === undefined) return withPane(mutate(input.page, (map) => applyRemove(map, input)), input.page);
      // validate → prepare → commit: everything refusable is refused before
      // the first file is touched, because a deletion has no rollback.
      const refusal = refusePageDeletion(input.pages, input.page);
      if (refusal !== undefined) return refusal;
      const editsAnything =
        (input.edges?.length ?? 0) +
          (input.nodes?.length ?? 0) +
          (input.groups?.length ?? 0) +
          (input.lanes?.length ?? 0) +
          (input.layers?.length ?? 0) >
        0;
      let summary = '';
      if (editsAnything) {
        // A call that only deletes pages must touch no map at all: mutate
        // would load a missing default page as EMPTY_MAP and save it, so a
        // bare `{pages: [...]}` would create the very file it never named.
        const edited = mutate(input.page, (map) => applyRemove(map, input));
        if (edited.isError === true) return edited; // edits refused: nothing deleted either
        summary = `${edited.content[0]?.text ?? ''}\n`;
      }
      return withPane(deletePages(input.pages, summary), input.page);
    },
  );

  server.registerTool(
    'mmap_setup',
    {
      title: 'Configure when maps open',
      description:
        'Get or set the mapping policy — WHEN the assistant opens a Mellos map. ' +
        'Call with no arguments to read it: the reply names the policy chosen for the USER ' +
        '(every project), the one this PROJECT overrides it with if any, and which of them is ' +
        'in effect. If it reports "not set", ask the USER to choose (never pick for them): ' +
        'always = ' +
        describeMappingPolicy('always') +
        '; complex = ' +
        describeMappingPolicy('complex') +
        '; on-request = ' +
        describeMappingPolicy('on-request') +
        '. Then call again with their choice to persist it. It defaults to user scope, which ' +
        'is the normal one — the question is about how someone works, so it is asked once ever, ' +
        'not once per repository. Pass scope: "project" only when the user wants THIS project ' +
        'to differ from that habit. The policy guides you; it never blocks the tools, and an ' +
        'explicit user request for a map always wins.',
      inputSchema: closed({
        policy: z
          .enum(MAPPING_POLICIES)
          .optional()
          .describe("the user's choice to persist; omit to read the current policy"),
        scope: z
          .enum(POLICY_SCOPES)
          .optional()
          .describe(
            'where to record the choice: "user" (default) applies to every project this user ' +
              'opens; "project" overrides that for this project alone. Ignored when reading.',
          ),
      }),
    },
    (input) => {
      // zod enforced both enums; the casts at this boundary cannot widen them
      const scope = (input.scope ?? 'user') as PolicyScope;
      const configFile = scope === 'project' ? projectConfigFile : userConfigFile;
      if (input.policy !== undefined) {
        const policy = input.policy as MappingPolicy;
        const saved = saveMappingPolicy(configFile, policy);
        if (!saved.ok) return saveFailed(saved.error);
        const reach =
          scope === 'user'
            ? 'applies to EVERY project this user opens; a single project can still override it with ' +
              'mmap_setup {policy, scope: "project"}'
            : 'applies to THIS project only, overriding the user-level choice';
        return text(
          `mapping policy set (${scope} scope): ${policy} — ${describeMappingPolicy(policy)}. ` +
            `${reach}. [${configFile}]`,
        );
      }
      const scopes = effectiveMappingPolicy(projectConfigFile, userConfigFile);
      if (!scopes.ok) return text(describeStoreError(scopes.error), true);
      const { user, project, effective, source } = scopes.value;
      const said = (p: MappingPolicy | undefined): string => (p === undefined ? 'not set' : p);
      const heading = `mapping policy — user: ${said(user)}; project: ${said(project)}`;
      if (effective === undefined) {
        return text(
          `${heading}. Nobody has chosen yet. Ask the user to choose one of: ` +
            MAPPING_POLICIES.map((p) => `${p} (${describeMappingPolicy(p)})`).join('; ') +
            ' — then call mmap_setup with their choice (scope defaults to user, which is what you want: ' +
            'the question is asked once ever). Until then act as complex.',
        );
      }
      return text(`${heading}. In effect: ${effective} (${source} scope) — ${describeMappingPolicy(effective)}`);
    },
  );

  server.registerTool(
    'mmap_view',
    {
      title: 'View the current map',
      description:
        'Render the current Mellos map as monochrome text — the same picture the split-pane ' +
        'watcher shows live. Use it to check the map state or to show it inline in conversation. ' +
        'Every response ends with a `pages:` line naming the pages this project actually has and ' +
        'which one you are looking at, so this is also how you discover whether a map exists at ' +
        'all and under which slugs — never probe the files.',
      inputSchema: closed({
        page: page(),
        zoom: z
          .number()
          .int()
          .min(ZOOM_MIN)
          .max(ZOOM_MAX)
          .optional()
          .describe('zoom ladder: 1 = detail (notes unfold), 0 = standard (default), -1..-3 = scaled down, -4 = overview glyphs'),
      }),
    },
    (input) => {
      const current = loadOrEmpty(fileOf(input.page));
      if (!current.ok) return text(current.error, true);
      const zoom = clampZoom(input.zoom ?? 0);
      const picture = renderMap(current.value, { color: false, unicode: true, spinnerFrame: 0, zoom }).join('\n');
      const surface = previews.enabled()
        ? `markdown: ${previewFile(stateFile, input.page as PageId | undefined)}\nUse mmap_open {surface: "markdown", page} to regenerate. Desktop visibility is not tracked.`
        : existsSync(webRuntimeFile(stateFile)) ? 'web: configured — use mmap_open {surface: "web", page} to open or reconnect. Desktop visibility is not tracked.' : currentPaneLine(input.page);
      return text(`${picture}\n${pagesLine(stateFile, input.page)}\n${surface}`);
    },
  );

  server.registerTool(
    'mmap_open',
    {
      title: 'Open the map pane',
      description:
        'For automatic display beside the current ChatGPT desktop conversation in Codex mode, use surface: "web-terminal", then call open_in_codex with the returned browser hostOpen object. No paste or Computer Use is needed. For the native host terminal, use surface: "codex-terminal": prepare absolute watcher commands for the current project, then ask the host to open its right terminal. This does not launch the watcher or type into that terminal. Agent exec PTYs cannot be attached using their numeric session ids. ' +
        'For a document panel, use surface: "markdown": generate MD + SVG files, ' +
        'enable automatic preview updates after successful map writes, then use the HOST file-opening ' +
        'tool to display the returned absolute Markdown path on the right of the current conversation. ' +
        'Generated does not mean visible: this server cannot open or observe the desktop side panel. ' +
        'For interactive maps, choose surface: "web": start or reuse a project-local web viewer and pass the returned URL to the host browser-opening tool. Markdown and terminal remain available. ' +
        'The default surface is "terminal", preserving the terminal workflow. ' +
        'Put the live map on the user\'s screen: a terminal pane beside this conversation that ' +
        'redraws on every write. Call it whenever a result says `pane: CLOSED` — and do NOT ask ' +
        'permission first, because a user who has set a mapping policy has already said they ' +
        'want to see the map. With a pane already open this RETARGETS it to `page` instead of ' +
        'opening a second one, so it is also how you show the user a particular page when they ' +
        'ask for one. It never closes a pane: taking the map off the screen belongs to the user ' +
        '(the `q` key in the pane, or typing `mmap` in a terminal). The reply says whether a ' +
        'pane actually reported itself in afterwards, not merely that a command was run. ' +
        'Automatic terminal opening supports Windows Terminal and tmux on Linux/macOS. ' +
        'If opening fails, relay the reason and copyable command; retry only after the environment changes or the user asks.',
      inputSchema: closed({
        surface: z.enum(['terminal', 'codex-terminal', 'markdown', 'web', 'web-terminal']).optional().describe('web-terminal = automatically started mmap terminal in a local browser page; codex-terminal = prepare a command for the desktop host terminal; web = local browser viewer; markdown = MD/SVG; terminal = Windows Terminal or tmux launcher (default)'),
        page: id(
          'page to show first — the page THIS effort lives on, the same slug you pass to the ' +
            'other tools. Omit only for the default page: without it a fresh pane opens on ' +
            'whichever page was written last, which after a gap is rarely the one under discussion.',
        ).optional(),
        window: z
          .boolean()
          .optional()
          .describe(
            'open the map in its own "mellos-mapping" window (a new tmux window on Linux/macOS) instead of splitting this ' +
              'conversation\'s window. Pass it only when the user asked for the map separate ' +
              '(a second monitor, a small screen); the split is the default because the map is ' +
              'meant to sit beside what it describes.',
          ),
      }),
    },
    async (input) => {
      if (input.surface === 'codex-terminal') {
        if (input.window === true) return text('codex-terminal uses the current conversation panel; window: true is not supported.', true);
        if (input.page && !listPageFiles(stateFile).some(file => pageIdOfFile(stateFile, file) === input.page)) {
          return text(`Unknown page: ${input.page}. ${pagesLine(stateFile, input.page)}`, true);
        }
        const handoff = terminalHandoff(process.execPath, fileURLToPath(new URL('./watch.mjs', import.meta.url)), stateFile, input.page);
        return text('terminal: ready-to-start\n' + JSON.stringify(handoff, null, 2) + '\n' +
          'Use open_in_codex with hostOpen in the CURRENT conversation, without a threadId. ' +
          'If a supported host tool can run commands in that user terminal, use it. Otherwise give the user the command for their shell to paste once. ' +
          'An exec_command session_id belongs to the agent PTY, not this terminal. queued is not visible, and opened is not running. ' +
          'Use read_thread_terminal to confirm the map title and controls after startup. Preserve a page the user pinned.');
      }
      if (input.surface === 'web' || input.surface === 'web-terminal') {
        if (input.window === true) return text('surface: "web" cannot be combined with window: true. Open the returned URL using the desktop host.', true);
        try {
          const url = await openWebPreview(stateFile, fileURLToPath(new URL('./web.mjs', import.meta.url)), input.page, input.surface === 'web-terminal');
          return text(`surface: ${input.surface}\nhostOpen: ${JSON.stringify({ placement: 'right', target: { type: 'browser', url } })}\npreview: ready\nweb: ${url}\nOpen this URL in the current conversation's right browser panel using the host tool. The viewer refreshes from project maps while open. Existing Markdown previews remain enabled. Desktop visibility is not confirmed by this tool.`);
        } catch (error) { return text(`Could not open web preview: ${String(error)}`, true); }
      }
      if (input.surface === 'markdown') {
        if (input.window === true) return text('surface: "markdown" cannot be combined with window: true. Open the returned file using the desktop host.', true);
        const published = previews.activate(input.page as PageId | undefined);
        if (!published.ok) return text(`Could not generate Markdown preview: ${published.error}`, true);
        return text(`preview: ready\nmarkdown: ${published.value.path}\nindex: ${published.value.index}\n` +
          'Automatic preview updates are enabled for this project. Open the Markdown file in the current conversation\'s right file panel using the host tool. ' +
          'No terminal was launched. Visibility and automatic file-viewer refresh are not confirmed by this tool.');
      }
      const run = await launch(launcherArgs(projectDirOf(stateFile), input.page, input.window === true));
      const viewers = run.ok ? await awaitPane(stateFile, input.page, Date.now() + PANE_REPORT_TIMEOUT_MS, launcherViewerPid(run)) : [];
      const outcome = openOutcome(run, viewers, input.page);
      const failed = !run.ok || !paneShows(viewers, input.page);
      paneOpenFailure = failed ? outcome : undefined;
      return text(outcome, failed);
    },
  );

  return server;
}

/** Resolve where the map file lives; see module header for the precedence contract. */
export function resolveStateFile(env: NodeJS.ProcessEnv, cwd: string): string {
  const projectDir = env['MELLOS_MAPPING_CWD'] ?? env['CLAUDE_PROJECT_DIR'] ?? cwd;
  return join(projectDir, STATE_FILE_RELATIVE_PATH);
}

/**
 * Resolve where the USER-scope configuration lives. The home directory is
 * read HERE, at the entry point, and nowhere else: everything below takes the
 * resolved path, so no spec can be one refactor away from writing the
 * developer's own configuration.
 */
export function resolveUserConfigFile(home: string): string {
  return userConfigFilePath(home);
}

async function main(): Promise<void> {
  const stateFile = resolveStateFile(process.env, process.cwd());
  const userConfigFile = resolveUserConfigFile(homedir());
  // One-time move of a pre-0.20 `.claude` store into `.mellos` (store.ts).
  // Say so on stderr — stdout is the MCP protocol — or the move looks like the
  // server deleting a tracked directory behind the user's back.
  if (migrateLegacyStore(stateFile)) console.error('mellos-mapping: moved the legacy .claude map store to .mellos/ — commit the move.');
  const server = buildServer(stateFile, userConfigFile);
  await server.connect(new StdioServerTransport());
}

/**
 * Run only as an entry point; importing this module (tests) must be inert.
 * npm bin shims launch through a symlink and shells may pass relative paths,
 * so argv[1] is compared by real path, with URL equality as the fallback
 * when either path cannot be resolved.
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
  // A rejected connect leaves nothing to recover — surface it and exit non-zero.
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
