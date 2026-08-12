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

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { EMPTY_MAP, type MellosMap, type Result } from '../domain/types.js';
import { renderMap } from '../render/render.js';
import { STATE_FILE_RELATIVE_PATH, describeStoreError, loadMapFile, saveMapFile } from '../store/store.js';
import { applyDeclare, applyRemove, applyUpdate, summarize } from './apply.js';

export const SERVER_NAME = 'mellos-mapping';
export const SERVER_VERSION = '0.4.0';

const ID = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'lowercase letters, digits and dashes, 1-64 chars')
  .describe('stable kebab-case identifier');

const STATUS = z
  .enum(['planned', 'in-progress', 'done', 'regressed'])
  .describe('planned = ghost on the map; in-progress = spinner; done = verified; regressed = was done, now broken');

const EDGE = z.object({
  from: ID.describe('the node that USES the other (must live on a higher layer)'),
  to: ID.describe('the node being used (must live on a strictly lower layer)'),
});

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

/** Build the MCP server bound to one state file. Exported for tests. */
export function buildServer(stateFile: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const mutate = (apply: (map: MellosMap) => Result<MellosMap, string>): ToolText => {
    const current = loadOrEmpty(stateFile);
    if (!current.ok) return text(current.error, true);
    const applied = apply(current.value);
    if (!applied.ok) return text(`refused (nothing changed): ${applied.error}`, true);
    saveMapFile(stateFile, applied.value);
    return text(summarize(applied.value));
  };

  server.registerTool(
    'mmap_declare',
    {
      title: 'Declare map structure',
      description:
        'Grow the Mellos map: set the title, add layer bands, add nodes, add dependency edges. ' +
        'Declare the whole ghost design up front, then grow it as understanding deepens. ' +
        'Edges must point strictly downward (a node may only use nodes on lower layers); ' +
        'the batch is all-or-nothing.',
      inputSchema: {
        title: z.string().max(120).optional().describe('map title, e.g. the feature being built'),
        layers: z
          .array(
            z.object({
              id: ID,
              name: z.string().min(1).max(60).describe('display name of the band'),
              rank: z.number().int().min(0).max(99).describe('0 = bottom / most primitive; must be unique'),
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
            }),
          )
          .optional(),
        edges: z.array(EDGE).optional(),
      },
    },
    (input) => mutate((map) => applyDeclare(map, input)),
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
            }),
          )
          .min(1),
      },
    },
    (input) => mutate((map) => applyUpdate(map, input)),
  );

  server.registerTool(
    'mmap_remove',
    {
      title: 'Revise the map',
      description:
        'Remove edges, nodes and empty layer bands (in that order, all-or-nothing). ' +
        'Removing a node also removes every edge touching it. Use when the ghost design ' +
        'turns out wrong — the map is a hypothesis, revising it is honest work.',
      inputSchema: {
        edges: z.array(EDGE).optional(),
        nodes: z.array(ID).optional(),
        layers: z.array(ID).optional().describe('bands to remove; must be empty of nodes'),
      },
    },
    (input) => mutate((map) => applyRemove(map, input)),
  );

  server.registerTool(
    'mmap_view',
    {
      title: 'View the current map',
      description:
        'Render the current Mellos map as monochrome text — the same picture the split-pane ' +
        'watcher shows live. Use it to check the map state or to show it inline in conversation.',
      inputSchema: {},
    },
    () => {
      const current = loadOrEmpty(stateFile);
      if (!current.ok) return text(current.error, true);
      return text(renderMap(current.value, { color: false, unicode: true, spinnerFrame: 0 }).join('\n'));
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

// Run only as an entry point; importing this module (tests) must be inert.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A rejected connect leaves nothing to recover — surface it and exit non-zero.
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
