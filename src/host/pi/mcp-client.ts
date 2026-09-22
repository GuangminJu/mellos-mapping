/**
 * Layer 4d — the MCP client behind the pi adapter (./extension.ts).
 *
 * pi has no MCP by design: its plugin surface is an extension module, and an
 * extension that speaks MCP is the supported shape. This module is that piece
 * and nothing else — it starts the SAME server Claude Code's `.mcp.json`
 * launches (`dist/server.mjs`), keeps it for the life of a session, and hands
 * the adapter one flat interface: the tools the server advertises, and a call.
 *
 * Everything the map actually does — the store, the pane, the policy — stays on
 * the server side, so the two hosts cannot grow two behaviours. The client owns
 * exactly three decisions:
 *
 *   ENVIRONMENT — inherited, not curated. The SDK's default environment is a
 *   safe subset that drops the terminal markers the pane launcher reads
 *   (`TMUX`, `WT_SESSION`, `TERM_PROGRAM`, `LOCALAPPDATA`). A curated
 *   environment would therefore change WHICH terminal integration triggers —
 *   the map would open in a different place under pi than under Claude Code for
 *   no visible reason. So the child gets this process's environment.
 *
 *   WORKING DIRECTORY — the session's, because that is how the server decides
 *   which project's store it is serving. It is the same fact Claude Code's
 *   stdio server gets from its own cwd, which is why a project maps to one
 *   store under both hosts.
 *
 *   STDERR — discarded. The server has no log channel to speak on, and an
 *   extension that lets a child write to the terminal corrupts the TUI it is
 *   drawn in. A fault here reaches the model as a tool error instead.
 *
 * @module
 */

import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

/** The running map server, as the adapter sees it. */
export interface MellosServer {
  /** The tools the server advertised at handshake. */
  readonly tools: readonly Tool[];
  /** Call one tool. Throws on a transport fault; `isError` is the server's own. */
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CallToolResult>;
  /** Terminate the child process and release the transport. */
  close(): Promise<void>;
}

/** Where the server lives and which project it serves. */
export interface ServerOptions {
  /** The plugin root — the directory holding `dist/`. */
  readonly pluginRoot: string;
  /** The session's working directory: the project whose store is served. */
  readonly projectDir: string;
  /** Reported to the server in the MCP handshake, for its logs only. */
  readonly clientVersion: string;
}

/**
 * Start the map server and complete the MCP handshake, returning the tools it
 * advertises. Rejects when the child cannot start or does not answer — the
 * caller decides whether that is worth telling anyone about.
 */
export async function startMellosServer(options: ServerOptions): Promise<MellosServer> {
  const transport = new StdioClientTransport({
    command: serverInterpreter({
      execPath: process.execPath,
      bun: (process.versions as { bun?: unknown }).bun,
    }),
    args: [join(options.pluginRoot, 'dist', 'server.mjs')],
    cwd: options.projectDir,
    env: inheritedEnv(),
    stderr: 'ignore',
  });
  const client = new Client(
    { name: 'mellos-mapping', version: options.clientVersion },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return {
      tools,
      async callTool(name, args, callOptions) {
        // The SDK widens this call's return type to include the LEGACY result
        // shape (a bare `toolResult`, kept for old servers) even when the
        // schema is pinned. Narrowing it here keeps our own callers — and the
        // host adapter above — free of both shapes and of a cast.
        const raw = await client.callTool(
          { name, arguments: args },
          CallToolResultSchema,
          callOptions?.signal === undefined ? undefined : { signal: callOptions.signal },
        );
        return {
          content: Array.isArray(raw.content) ? raw.content : [],
          isError: raw.isError === true,
          structuredContent: structuredOf(raw.structuredContent),
        };
      },
      async close() {
        await client.close();
      },
    };
  } catch (error) {
    // A child without a handshake has no owner: close it here, or a failed
    // session leaves a server process holding the store lock.
    await client.close().catch(() => undefined);
    throw error;
  }
}

/**
 * The interpreter the map server runs on.
 *
 * `process.execPath` is right for the pi everybody installs: `npm i -g` and the
 * `pi.dev/install.sh` path, which installs through npm onto Node. The host is a
 * Node process there, and the child must run on the interpreter this process
 * already is, rather than on whichever `node` a PATH lookup happens to find
 * first. pi is ALSO released as standalone Bun-compiled binaries — the release
 * assets, not the npm package or the `install.sh` script — and there `execPath`
 * is pi itself, so spawning it with a script path starts a second pi instead of a
 * server. No interpreter can be named in that case, and a session is not the
 * place to guess one, so that host is refused in words that say which build it
 * is: `process.versions.bun` is the same fact pi's own `isBunRuntime` reads.
 *
 * The runtime facts are injected rather than read from the globals so a spec can
 * pose as each kind of host.
 */
export function serverInterpreter(runtime: { readonly execPath: string; readonly bun: unknown }): string {
  if (typeof runtime.bun === 'string') {
    throw new Error('this pi is a compiled Bun binary, which cannot host the map server; install pi from npm');
  }
  return runtime.execPath;
}

/**
 * A structured result, as the MCP type wants it: a plain record, or nothing.
 * Rebuilt instead of asserted, so an array or a primitive coming out of a
 * non-conforming server is dropped rather than typed away.
 */
function structuredOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

/**
 * This process's environment, as the child should inherit it: the same
 * variables the host was given, minus the ones that cannot be passed on.
 * `process.env` types as possibly-undefined and `spawn` does not.
 */
function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}
