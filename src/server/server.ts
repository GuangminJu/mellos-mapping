/**
 * Layer 3 — the MCP server: five tools over one state file.
 *
 *   mmap_declare  grow the map (title, bands, lanes, groups, nodes, edges)
 *   mmap_update   record progress AND revise (status, evidence, moves, renames)
 *   mmap_remove   take things off the map (edges, nodes, groups, lanes, bands)
 *   mmap_view     render the map as text, and name the project's pages
 *   mmap_setup    get/set the project's mapping policy (when maps open)
 *
 * Every mutating call is load -> apply (all-or-nothing, Layer 2) -> save
 * (atomic, Layer 1). The server holds no map state between calls: the file
 * is the single source of truth, so several sessions against one project
 * stay consistent per call. A save that does not land changes nothing and is
 * reported as such — see saveFailed — so a refused write never leaves the
 * caller believing the ledger recorded something it did not.
 *
 * The state file lives in the project the CLIENT is working in, resolved in
 * this order: MELLOS_MAPPING_CWD (explicit override for manual runs),
 * CLAUDE_PROJECT_DIR (set by Claude Code for plugin MCP servers — the
 * documented contract), then this process's cwd as the last resort.
 */

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
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
  type PageId,
  STATE_FILE_RELATIVE_PATH,
  type StoreError,
  configFilePath,
  describeMappingPolicy,
  describeStoreError,
  listPageFiles,
  migrateLegacyStore,
  loadMapFile,
  loadMappingPolicy,
  pageFilePath,
  pageIdOfFile,
  saveMapFile,
  saveMappingPolicy,
} from '../store/store.js';
import { applyDeclare, applyRemove, applyUpdate, summarize } from './apply.js';

export const SERVER_NAME = 'mellos-mapping';
export const SERVER_VERSION = '0.20.1';

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

/** Build the MCP server bound to one default-page state file. Exported for tests. */
export function buildServer(stateFile: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

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
    return text(summarize(applied.value) + (page !== undefined ? ` [page: ${page}]` : ''));
  };

  /**
   * The setup flow enforces itself here: every declare on a project whose
   * policy was never chosen carries the nudge, so ANY client — skill loaded
   * or not — is told to run setup exactly until the user has answered. It
   * never blocks (the ledger is not a judge); a broken config file is
   * surfaced the same way instead of being silently treated as unset.
   */
  const setupNudge = (): string => {
    const policy = loadMappingPolicy(stateFile);
    if (!policy.ok) return `\nnote: ${describeStoreError(policy.error)} — fix it or rerun setup (mmap_setup).`;
    if (policy.value !== undefined) return '';
    return (
      '\nnote: mapping policy not set for this project. Ask the user when maps should open — ' +
      MAPPING_POLICIES.map((p) => `${p} (${describeMappingPolicy(p)})`).join('; ') +
      ' — then record the answer with mmap_setup.'
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
      const result = mutate(input.page, (map) => applyDeclare(map, input));
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
    (input) => mutate(input.page, (map) => applyUpdate(map, input)),
  );

  server.registerTool(
    'mmap_remove',
    {
      title: 'Revise the map',
      description:
        'Remove edges, nodes, groups and empty layer bands (in that order, all-or-nothing). ' +
        'Removing a node also removes every edge touching it; removing a group merely ungroups ' +
        'its members. Use when the ghost design turns out wrong — the map is a hypothesis, ' +
        'revising it is honest work.',
      inputSchema: closed({
        page: page(),
        edges: z.array(closed(edgeEnds())).optional(),
        nodes: z.array(id('id of the node to remove, with every edge touching it')).optional(),
        groups: z.array(id('id of the group to remove; members stay, merely ungrouped')).optional(),
        lanes: z.array(id('id of the lane to remove; members stay, merely off-lane')).optional(),
        layers: z.array(id('id of the band to remove; it must hold no nodes and no groups')).optional(),
      }),
    },
    (input) => mutate(input.page, (map) => applyRemove(map, input)),
  );

  server.registerTool(
    'mmap_setup',
    {
      title: 'Configure when maps open',
      description:
        "Get or set this project's mapping policy — WHEN the assistant opens a Mellos map. " +
        'Call with no arguments to read it. If it reports "not set", ask the USER to choose ' +
        '(never pick for them): always = ' +
        describeMappingPolicy('always') +
        '; complex = ' +
        describeMappingPolicy('complex') +
        '; on-request = ' +
        describeMappingPolicy('on-request') +
        '. Then call again with their choice to persist it. The policy guides you; it never ' +
        'blocks the tools, and an explicit user request for a map always wins.',
      inputSchema: closed({
        policy: z
          .enum(MAPPING_POLICIES)
          .optional()
          .describe("the user's choice to persist; omit to read the current policy"),
      }),
    },
    (input) => {
      if (input.policy !== undefined) {
        // zod enforced the enum; the cast at this boundary cannot widen it
        const policy = input.policy as MappingPolicy;
        const saved = saveMappingPolicy(stateFile, policy);
        if (!saved.ok) return saveFailed(saved.error);
        return text(`mapping policy set: ${policy} — ${describeMappingPolicy(policy)} [${configFilePath(stateFile)}]`);
      }
      const loaded = loadMappingPolicy(stateFile);
      if (!loaded.ok) return text(describeStoreError(loaded.error), true);
      if (loaded.value === undefined) {
        return text(
          'mapping policy not set. Ask the user to choose one of: ' +
            MAPPING_POLICIES.map((p) => `${p} (${describeMappingPolicy(p)})`).join('; ') +
            ' — then call mmap_setup with their choice. Until then act as complex.',
        );
      }
      return text(`mapping policy: ${loaded.value} — ${describeMappingPolicy(loaded.value)}`);
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
      return text(`${picture}\n${pagesLine(stateFile, input.page)}`);
    },
  );

  return server;
}

/** Resolve where the map file lives; see module header for the precedence contract. */
export function resolveStateFile(env: NodeJS.ProcessEnv, cwd: string): string {
  const projectDir = env['MELLOS_MAPPING_CWD'] ?? env['CLAUDE_PROJECT_DIR'] ?? cwd;
  return join(projectDir, STATE_FILE_RELATIVE_PATH);
}

async function main(): Promise<void> {
  const stateFile = resolveStateFile(process.env, process.cwd());
  // One-time move of a pre-0.19 `.claude` store into `.mellos` (store.ts).
  migrateLegacyStore(stateFile);
  const server = buildServer(stateFile);
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
