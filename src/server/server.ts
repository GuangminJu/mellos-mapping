/**
 * Layer 3 — the MCP server: four tools over one state file.
 *
 *   mmap_declare  grow the map (title, bands, nodes, edges)
 *   mmap_update   record progress (status / label / evidence)
 *   mmap_remove   revise the map (edges, nodes, empty bands)
 *   mmap_view     render the current map as text
 *
 * Every mutating call is load -> apply (all-or-nothing, Layer 2) -> save
 * (atomic, Layer 1). The server holds no map state between calls: the file
 * is the single source of truth, so several sessions against one project
 * stay consistent per call.
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

import { EMPTY_MAP, type MellosMap, type Result } from '../domain/types.js';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, renderMap } from '../render/render.js';
import {
  type PageId,
  STATE_FILE_RELATIVE_PATH,
  describeStoreError,
  loadMapFile,
  pageFilePath,
  saveMapFile,
} from '../store/store.js';
import { applyDeclare, applyRemove, applyUpdate, summarize } from './apply.js';

export const SERVER_NAME = 'mellos-mapping';
export const SERVER_VERSION = '0.12.1';

const ID = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'lowercase letters, digits and dashes, 1-64 chars')
  .describe('stable kebab-case identifier');

const PAGE = ID.optional().describe(
  'page (parallel map) this call targets; omit for the default page. ' +
    'One effort = one page: start a NEW effort on its own page named after the effort, ' +
    'so concurrent sessions never write over each other and the pane can switch between pages.',
);

const STATUS = z
  .enum(['planned', 'in-progress', 'done', 'regressed'])
  .describe('planned = ghost on the map; in-progress = spinner; done = verified; regressed = was done, now broken');

const EDGE = z.object({
  from: ID.describe('the node that USES the other (must live on a higher layer)'),
  to: ID.describe('the node being used (must live on a strictly lower layer)'),
});

const KIND = z
  .enum(['dev', 'architecture', 'dataflow', 'behavior-tree', 'sequence'])
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

const NODE_KIND = ID.describe(
  'node kind rendered as a glyph prefix. Known: selector | sequence | parallel | decorator | ' +
    'condition | action (behavior trees); source | transform | sink (dataflow); ' +
    'service | db | queue | ui (architecture). Unknown kinds are kept and shown in the detail panel.',
);

interface ToolText {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function text(s: string, isError = false): ToolText {
  return { content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) };
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
    saveMapFile(file, applied.value);
    return text(summarize(applied.value) + (page !== undefined ? ` [page: ${page}]` : ''));
  };

  server.registerTool(
    'mmap_declare',
    {
      title: 'Declare map structure',
      description:
        'Grow the Mellos map: set the title and diagram kind, add layer bands, lanes and groups ' +
        '(labeled subsystems within a band — the zoomed-out view renders groups, so declare them ' +
        'for any map beyond a handful of nodes), add nodes, add dependency edges. Declare the ' +
        'whole ghost design up front, then grow it as understanding deepens. Edges must point ' +
        'strictly downward (a node may only use nodes on lower layers); the batch is all-or-nothing.',
      inputSchema: {
        page: PAGE,
        title: z.string().max(120).optional().describe('map title, e.g. the feature being built'),
        kind: KIND.optional(),
        lanes: z
          .array(
            z.object({
              id: ID,
              label: z.string().min(1).max(60).describe('column name, e.g. a sequence participant'),
            }),
          )
          .optional()
          .describe('vertical columns crossing all bands; declaration order = left-to-right'),
        layers: z
          .array(
            z.object({
              id: ID,
              name: z.string().min(1).max(60).describe('display name of the band'),
              rank: z.number().int().min(0).max(99).describe('0 = bottom / most primitive; must be unique'),
            }),
          )
          .optional(),
        groups: z
          .array(
            z.object({
              id: ID,
              label: z.string().min(1).max(60).describe('subsystem name shown at the far zoom'),
              layer: ID.describe('band this group clusters; members must live on the same band'),
            }),
          )
          .optional(),
        nodes: z
          .array(
            z.object({
              id: ID,
              label: z.string().min(1).max(60).describe('display label inside the box'),
              layer: ID.describe('id of the band this node lives in'),
              status: STATUS.optional().describe('defaults to planned'),
              detail: z
                .string()
                .max(600)
                .optional()
                .describe('design notes shown in the pane detail panel: responsibility, contract, key decisions'),
              group: ID.optional().describe('same-band group this node belongs to'),
              kind: NODE_KIND.optional(),
              lane: ID.optional().describe('lane (column) this node belongs to'),
              submap: ID.optional().describe(
                'page slug of this node\'s child map — the pane badges the node ⊞ and double-click ' +
                  'dives in. Declare the child page separately. Create a sub-map only when the ' +
                  "node's internals genuinely deserve their own picture; most nodes need none.",
              ),
            }),
          )
          .optional(),
        edges: z
          .array(EDGE.extend({ label: z.string().max(80).optional().describe('what flows along the edge') }))
          .optional(),
      },
    },
    (input) => mutate(input.page, (map) => applyDeclare(map, input, Date.now())),
  );

  server.registerTool(
    'mmap_update',
    {
      title: 'Record progress on nodes',
      description:
        'Update node status/label/evidence. Set in-progress when starting a node (the pane spins), ' +
        'done with evidence when its verification passes, regressed with evidence when a done ' +
        'node breaks. The map is a ledger: report honestly, it never blocks you.',
      inputSchema: {
        page: PAGE,
        updates: z
          .array(
            z.object({
              id: ID,
              status: STATUS.optional(),
              label: z.string().min(1).max(60).optional(),
              evidence: z
                .string()
                .max(200)
                .optional()
                .describe('for done: how it was verified; for regressed: what broke'),
              detail: z
                .string()
                .max(600)
                .optional()
                .describe('design notes shown in the pane detail panel: responsibility, contract, key decisions'),
              group: ID.nullable()
                .optional()
                .describe('join this same-band group; null leaves the current group'),
              kind: NODE_KIND.nullable().optional().describe('set the node kind; null clears it'),
              lane: ID.nullable().optional().describe('join this lane; null leaves the current lane'),
              submap: ID.nullable().optional().describe('link a child map page; null unlinks it'),
            }),
          )
          .min(1),
      },
    },
    (input) => mutate(input.page, (map) => applyUpdate(map, input, Date.now())),
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
      inputSchema: {
        page: PAGE,
        edges: z.array(EDGE).optional(),
        nodes: z.array(ID).optional(),
        groups: z.array(ID).optional().describe('groups to remove; members stay, merely ungrouped'),
        lanes: z.array(ID).optional().describe('lanes to remove; members stay, merely off-lane'),
        layers: z.array(ID).optional().describe('bands to remove; must be empty of nodes and groups'),
      },
    },
    (input) => mutate(input.page, (map) => applyRemove(map, input)),
  );

  server.registerTool(
    'mmap_view',
    {
      title: 'View the current map',
      description:
        'Render the current Mellos map as monochrome text — the same picture the split-pane ' +
        'watcher shows live. Use it to check the map state or to show it inline in conversation.',
      inputSchema: {
        page: PAGE,
        zoom: z
          .number()
          .int()
          .min(ZOOM_MIN)
          .max(ZOOM_MAX)
          .optional()
          .describe('zoom ladder: 1 = detail (notes unfold), 0 = standard (default), -1..-3 = scaled down, -4 = overview glyphs'),
      },
    },
    (input) => {
      const current = loadOrEmpty(fileOf(input.page));
      if (!current.ok) return text(current.error, true);
      const zoom = clampZoom(input.zoom ?? 0);
      return text(
        renderMap(current.value, { color: false, unicode: true, spinnerFrame: 0, zoom, now: Date.now() }).join('\n'),
      );
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
  const server = buildServer(resolveStateFile(process.env, process.cwd()));
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
