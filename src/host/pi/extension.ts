/**
 * Layer 4d — the pi host adapter.
 *
 * pi is not a host that reads a plugin directory: it loads EXTENSIONS
 * (`package.json#pi.extensions`) and has no MCP of its own, on purpose. So this
 * adapter supplies both halves of what Claude Code gets from two files:
 *
 *   THE TOOLS — `./mcp-client.ts` starts the same `dist/server.mjs` Claude
 *   Code's `.mcp.json` launches, in the session's working directory. The eight
 *   `mmap_*` tools are not declared here; they are read from the server's
 *   `tools/list` and registered one by one, so the server stays the single
 *   registry and a tool added there needs no change here. Their parameter
 *   schema is the server's JSON Schema, handed to pi unchanged: pi compiles
 *   plain JSON Schema, so no second schema dialect is introduced.
 *
 *   THE STANDING PARAGRAPH — pi has no SessionStart hook. The mapping policy
 *   reaches the model from `before_agent_start` instead, built by
 *   `../session-context.ts`: the SAME `sessionStartContext()` the Claude hook
 *   prints, read from the same store. One source, three hosts, no second
 *   dialect of the policy.
 *
 * Two promises carried over from the hook because they are about the same
 * moment: FAST — one config read, one existsSync, one shim read, no map parsed
 * on the first prompt — and SILENT ON FAILURE — a host adapter that throws must
 * not be the reason a session starts badly. The one exception is the map server
 * failing to start: the paragraph would then tell the model to open a pane that
 * cannot open, so that single fault is reported in one line, to the model,
 * inside the same injection.
 *
 * Nothing is started at load time. pi runs extension factories in invocations
 * that never begin a session (`pi --list-models`), so the child process is
 * started from `session_start`, and stopped in `session_shutdown`, which pi
 * emits before it reloads extensions for the next session (`new`, `resume`,
 * `fork`) — one server per session, closed by whoever opened it.
 *
 * The host API is declared structurally instead of imported, exactly as
 * `../omp/extension.ts` does: this repository ships neither host as a
 * dependency, so the adapter keeps building — and keeps working — against
 * whatever host version a user happens to run.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureMmapCommand } from '../../hook/session-start.js';
import { SESSION_CONTEXT_TYPE, sessionParagraph, storeIsReadable } from '../session-context.js';
import { startMellosServer } from './mcp-client.js';
import type { MellosServer, ServerOptions } from './mcp-client.js';

/** One text block of a tool result, the only shape this adapter produces. */
export interface PiToolText {
  readonly type: 'text';
  readonly text: string;
}

/** What a pi tool returns: text for the model, `details` for the host. */
export interface PiToolResult {
  readonly content: readonly PiToolText[];
  readonly details?: unknown;
}

/**
 * The sliver of pi's `ExtensionAPI` this adapter uses — its tool definition and
 * its two registration points. Deliberately structural and minimal: nothing a
 * newer host could not satisfy.
 *
 * `parameters` is typed `unknown` on purpose: it is the MCP server's JSON
 * Schema object travelling to the host untouched, so the one thing this file
 * must not do is describe it again.
 */
export interface PiToolDefinition {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ): Promise<PiToolResult>;
}

/** The pi extension surface this adapter registers against. */
export interface PiExtensionApi {
  /**
   * Register a handler. Registration only — and one of exactly two calls this
   * factory may make while loading: pi replaces every action method with a stub
   * that throws until its runtime is bound (see the factory).
   */
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): unknown;
  /** Register a tool. Valid during load and later; new tools appear at once. */
  registerTool(definition: PiToolDefinition): unknown;
}

/** The message pi injects in front of the next turn. */
interface InjectMessage {
  readonly customType: string;
  readonly content: string;
  readonly display: boolean;
}

/**
 * The pi extension factory.
 *
 * State is one boolean, two memos and one process: `armed` says whether this
 * session still owes the model the paragraph — a session start arms it, a
 * compaction re-arms it, because compaction is exactly where a standing
 * instruction gets lost — `told` remembers what was said so a CHANGED policy is
 * told again without repeating an unchanged one every turn, and `server` is the
 * map server child, memoized through `starting` so the first turn's two callers
 * (the paragraph's and the tools') cannot start two of them.
 *
 * The factory body is REGISTRATION AND NOTHING ELSE, and that is a hard host
 * rule, not a style: pi loads an extension in invocations that never begin a
 * session, and while it does, `createExtensionRuntime()` has replaced every
 * action method with a stub that throws "Extension runtime not initialized.
 * Action methods cannot be called during extension loading." A factory that
 * calls one does not lose that call, it loses the WHOLE extension: `pi` reports
 * "Failed to load extension" and the session gets neither the tools nor the
 * paragraph. Only `on()` and `registerTool()` are legal here.
 *
 * Two findings from running a real pi session against this bundle, both worth
 * keeping: that load rule (the first bundle failed to load over exactly one such
 * call), and the fact that this adapter must not label itself at all — pi's
 * `setLabel(entryId, label)` names a TRANSCRIPT ENTRY for the session tree, so
 * `setLabel('Mellos Mapping')` was not merely illegal while loading, it answered
 * `Entry Mellos Mapping not found`. An extension is named by its package.
 */
export default function mellosMappingPi(
  pi: PiExtensionApi,
  /**
   * The client factory — a defaulted parameter, not a host-facing option: pi
   * calls this factory with the API alone. The seam exists so a spec can watch
   * what the adapter asks the server for (which project, one process per
   * session, which tool, which arguments) without spawning a real child.
   */
  start: (options: ServerOptions) => Promise<MellosServer> = startMellosServer,
): void {
  // The bundle lives at <plugin root>/dist/, so the root is two up — derived
  // rather than read from an env var, the same way the hook and the omp adapter
  // derive it: each host adapter always knows where it was installed.
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  let armed = true;
  let installNote: string | undefined;
  let told: string | undefined;
  let server: MellosServer | undefined;
  let starting: Promise<MellosServer | undefined> | undefined;
  let serverNote: string | undefined;
  const registered = new Set<string>();

  /** The one line the model is told when the map server could not start. */
  const serverFailure = (error: unknown): string =>
    `mellos-mapping: the map tools could not start (${firstLineOf(error)}) — ` +
    'tell the user; maps cannot be opened or read in this session.';

  /** Start (or join) the map server, register its tools, and memoize the try. */
  const ensureServer = (projectDir: string): Promise<MellosServer | undefined> => {
    starting ??= (async (): Promise<MellosServer | undefined> => {
      try {
        const started = await start({
          pluginRoot,
          projectDir,
          clientVersion: pluginVersion(pluginRoot),
        });
        server = started;
        for (const tool of started.tools) {
          // Registered by name once per extension instance. pi rebuilds the
          // instance for every session, so this set only guards the two
          // callers above racing on the same discovery.
          if (registered.has(tool.name)) continue;
          registered.add(tool.name);
          pi.registerTool(toolDefinition(tool, () => server ?? started));
        }
        return started;
      } catch (error) {
        serverNote = serverFailure(error);
        return undefined;
      }
    })();
    return starting;
  };

  pi.on('session_start', async (_event, ctx) => {
    armed = true;
    // A previous session's server was closed in `session_shutdown`; this one
    // gets its own, and with it a fresh chance to report a start failure.
    starting = undefined;
    serverNote = undefined;
    try {
      installNote = ensureMmapCommand(pluginRoot);
    } catch {
      // A failed shim install must not cost the session its policy paragraph;
      // scripts/install-mmap-command.mjs exists for this user to run by hand.
      installNote = undefined;
    }
    await ensureServer(projectDirOf(ctx));
  });

  pi.on('session_shutdown', async () => {
    const closing = server;
    server = undefined;
    starting = undefined;
    if (closing !== undefined) await closing.close().catch(() => undefined);
  });

  // Compaction is where a standing instruction gets lost, and pi reuses the
  // extension instance across it, so the paragraph has to be re-armed by hand.
  pi.on('session_compact', async () => {
    armed = true;
  });

  pi.on('before_agent_start', async (_event, ctx) => {
    const projectDir = projectDirOf(ctx);
    // Tools are discovered asynchronously, and this is the last moment before
    // the model's tool list is built, so the discovery is awaited here too.
    if (server === undefined) await ensureServer(projectDir);

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
    const content = [paragraph, installNote, serverNote]
      .filter((part): part is string => part !== undefined)
      .join('\n\n');
    const owed = armed || (paragraph !== undefined && paragraph !== told);
    if (!owed || broken || content === '') {
      if (!broken) armed = false;
      return undefined;
    }
    // Consumed: this session now has the current paragraph in front of it.
    armed = false;
    told = paragraph;
    const message: InjectMessage = {
      customType: SESSION_CONTEXT_TYPE,
      content,
      // Standing instruction, not conversation: the model reads it, and the
      // transcript does not grow a message the user never sent.
      display: false,
    };
    return { message };
  });
}

/**
 * One MCP tool, as pi's tool definition.
 *
 * `active` is read at CALL time, not captured: the host keeps the registration
 * for the life of the extension instance, and that instance can outlive the
 * server it first discovered (`session_start` after `session_shutdown` in the
 * same process). A captured server would be a closed pipe.
 */
function toolDefinition(
  tool: MellosServer['tools'][number],
  active: () => MellosServer,
): PiToolDefinition {
  return {
    name: tool.name,
    label: typeof tool.title === 'string' && tool.title !== '' ? tool.title : tool.name,
    description: typeof tool.description === 'string' && tool.description !== '' ? tool.description : tool.name,
    parameters: inputSchemaOf(tool.inputSchema),
    async execute(_toolCallId, params, signal) {
      try {
        return await callTool(active(), tool.name, params, signal);
      } catch (error) {
        // "Stopped asking" is not a failure: the user cancelled the turn. pi
        // marks a tool failed by THROWING, so this must not throw.
        if (signal?.aborted === true) {
          return { content: [{ type: 'text' as const, text: 'Cancelled.' }], details: { cancelled: true } };
        }
        throw error;
      }
    },
  };
}

/**
 * One `tools/call`, translated into pi's result shape.
 *
 * The server's own error words travel to the model unchanged — they are the
 * reason the model can fix its call (`expectedRevision`, a missing page) — and
 * pi learns about a failure by our THROWING, never by a field on the result.
 */
async function callTool(
  server: MellosServer,
  name: string,
  params: unknown,
  signal: AbortSignal | undefined,
): Promise<PiToolResult> {
  const args = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
  const result = await server.callTool(name, args, signal === undefined ? undefined : { signal });
  const text = textOf(result);
  if (result.isError === true) throw new Error(text);
  return {
    content: [{ type: 'text', text }],
    details: { tool: name, structuredContent: result.structuredContent },
  };
}

/**
 * The readable text of an MCP result. Every block this server sends is text,
 * but the type allows more, and dropping a block would silently hide output —
 * so anything else is handed over as JSON.
 */
function textOf(result: {
  readonly content?: readonly unknown[];
  readonly structuredContent?: unknown;
}): string {
  const blocks = (result.content ?? []).map((block) =>
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
      ? (block as { text: string }).text
      : JSON.stringify(block),
  );
  if (blocks.length > 0) return blocks.join('\n');
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  return '(no output)';
}

/**
 * The tool's parameter schema, handed to the host untouched except for the
 * `$schema` draft URL: the host compiles the JSON Schema itself, and a draft
 * declaration is the one key that describes the schema rather than the input.
 */
function inputSchemaOf(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return { type: 'object', properties: {} };
  const { $schema: _draft, ...rest } = schema as Record<string, unknown>;
  return rest;
}

/**
 * The session's working directory — the fact that decides which project's store
 * the server serves, and therefore the one fact this adapter must not guess. A
 * host that hands us no `cwd` gets this process's.
 */
function projectDirOf(ctx: unknown): string {
  const cwd = typeof ctx === 'object' && ctx !== null && 'cwd' in ctx ? (ctx as { cwd?: unknown }).cwd : undefined;
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd();
}

/** The release version, for the MCP handshake's client info. */
function pluginVersion(pluginRoot: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    // Cosmetic metadata: a version nobody reads must never cost a session.
    return '0.0.0';
  }
}

/** The first line of a failure, for the one-line report the model gets. */
function firstLineOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0] ?? 'unknown error';
}
