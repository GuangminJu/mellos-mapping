/**
 * Spec for the pi host adapter (./extension.ts).
 *
 * pi is the one host that supplies NEITHER half of what this plugin needs: no
 * MCP client (pi rejects MCP on purpose) and no SessionStart hook. So the two
 * things this spec pins are the two halves the adapter has to build itself —
 * the tools it discovers from the server and registers, and the standing
 * paragraph it injects from `before_agent_start`.
 *
 * The tools are checked through a client seam rather than a real child process:
 * what can go wrong here is the WIRING (registering nothing, registering twice,
 * starting one server per turn, losing the server's own error words, throwing
 * on a cancelled turn), not the MCP handshake, which `./mcp-client.ts` and the
 * bundle's end-to-end smoke run cover.
 *
 * The paragraph itself is not restated here: it is the same
 * `sessionStartContext()` the Claude hook prints and the omp adapter injects,
 * so what this spec asserts is that pi gets it once, re-armed by a compaction,
 * and never turned into a chat message the user never sent.
 *
 * @module
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STATE_FILE_RELATIVE_PATH, configFilePath, saveMappingPolicy } from '../../store/store.js';
import type { MappingPolicy } from '../../store/store.js';
import { SESSION_CONTEXT_TYPE, sessionParagraph } from '../session-context.js';
import mellosMappingPi from './extension.js';
import type { PiToolDefinition } from './extension.js';
import type { MellosServer, ServerOptions } from './mcp-client.js';

/** One call the adapter made to the server, in order. */
interface RecordedCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** A stand-in for the MCP client: records what the adapter asked it for. */
interface FakeServer {
  /** Every tool call the adapter forwarded, in order. */
  readonly calls: RecordedCall[];
  /** Every start request, in order — one per session, never one per turn. */
  readonly starts: ServerOptions[];
  /** How many times the child was asked to close. */
  readonly closes: number;
  /** Fail the next start, as a server that cannot come up does. */
  failStart(error: Error): void;
  /** Fail the next tool call with the server's own words. */
  failCall(text: string): void;
  /** What the adapter is told to close, per instance. */
  readonly closed: MellosServer[];
  readonly start: (options: ServerOptions) => Promise<MellosServer>;
}

function fakeServer(): FakeServer {
  const state = {
    calls: [] as RecordedCall[],
    starts: [] as ServerOptions[],
    closed: [] as MellosServer[],
    closes: 0,
    startError: undefined as Error | undefined,
    callError: undefined as string | undefined,
  };
  const server: MellosServer = {
    tools: [
      {
        name: 'mmap_view',
        title: 'View the map',
        description: 'Read the map',
        // `$schema` rides along because real servers send it; the adapter is
        // expected to pass the schema on and drop only that key.
        inputSchema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { page: { type: 'string' } },
          required: ['page'],
        },
      },
      { name: 'mmap_open', description: 'Open the pane', inputSchema: { type: 'object', properties: {} } },
    ],
    async callTool(name, args, options) {
      // The transport ends a call whose turn was cancelled the way the MCP SDK
      // does: by rejecting. The adapter's job is to tell that apart from a
      // real failure and answer instead of throwing.
      if (options?.signal?.aborted === true) throw new Error('This operation was aborted');
      if (state.callError !== undefined) {
        const text = state.callError;
        state.callError = undefined;
        return { content: [{ type: 'text', text }], isError: true };
      }
      state.calls.push({ name, args });
      return { content: [{ type: 'text', text: `called ${name}` }], isError: false };
    },
    async close() {
      state.closes += 1;
      state.closed.push(server);
    },
  };
  return {
    get calls() {
      return state.calls;
    },
    get starts() {
      return state.starts;
    },
    get closed() {
      return state.closed;
    },
    get closes() {
      return state.closes;
    },
    failStart(error) {
      state.startError = error;
    },
    failCall(text) {
      state.callError = text;
    },
    async start(options) {
      if (state.startError !== undefined) {
        const error = state.startError;
        state.startError = undefined;
        throw error;
      }
      state.starts.push(options);
      return server;
    },
  };
}

/** A stand-in for pi's ExtensionAPI: records handlers and tools, then fires them. */
function fakeHost(): {
  api: Parameters<typeof mellosMappingPi>[0];
  tools: Map<string, PiToolDefinition>;
  registered: string[];
  fire: (event: string, ctx: unknown) => Promise<readonly unknown[]>;
} {
  const handlers: Record<string, ((event: unknown, ctx: unknown) => unknown)[]> = {};
  const tools = new Map<string, PiToolDefinition>();
  const registered: string[] = [];
  return {
    api: {
      on(event, handler) {
        handlers[event] = [...(handlers[event] ?? []), handler];
      },
      registerTool(definition) {
        registered.push(definition.name);
        tools.set(definition.name, definition);
      },
    },
    tools,
    registered,
    async fire(event, ctx) {
      const results: unknown[] = [];
      for (const handler of handlers[event] ?? []) results.push(await handler({ type: event }, ctx));
      return results;
    },
  };
}

/**
 * A host that enforces pi's LOAD contract, which a real session taught us the
 * hard way: while a factory runs, pi 0.86.1 has replaced every action method
 * with a stub that throws the exact text below, and a factory that calls one
 * loses the whole extension — "Failed to load extension", no tools, no
 * paragraph. `on()` is a registration and the one call that always gets
 * through; `registerTool` is legal in pi during load, but this host refuses it
 * too, which pins the narrower rule this adapter keeps: with no session begun
 * there is no project, so there is nothing to register yet.
 *
 * Binding the runtime is what `fire()` stands in for: the first event a host
 * delivers is delivered after the bind.
 */
function strictHost(): {
  api: Parameters<typeof mellosMappingPi>[0];
  fire: (event: string, ctx: unknown) => Promise<readonly unknown[]>;
} {
  const handlers: Record<string, ((event: unknown, ctx: unknown) => unknown)[]> = {};
  let bound = false;
  const notLoaded = (): never => {
    throw new Error('Extension runtime not initialized. Action methods cannot be called during extension loading.');
  };
  return {
    api: {
      on(event, handler) {
        handlers[event] = [...(handlers[event] ?? []), handler];
      },
      registerTool() {
        if (!bound) notLoaded();
      },
    },
    async fire(event, ctx) {
      bound = true;
      const results: unknown[] = [];
      for (const handler of handlers[event] ?? []) results.push(await handler({ type: event }, ctx));
      return results;
    },
  };
}

/** The injected message, read across the adapter's untyped boundary. */
function injected(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== 'object' || result === null || !('message' in result)) return undefined;
  const { message } = result;
  return typeof message === 'object' && message !== null ? { ...message } : undefined;
}

/** The text it carried. */
function injectedText(result: unknown): string | undefined {
  const content = injected(result)?.['content'];
  return typeof content === 'string' ? content : undefined;
}

let project: string;

const record = (policy: MappingPolicy): void => {
  mkdirSync(join(project, '.mellos'), { recursive: true });
  expect(saveMappingPolicy(configFilePath(join(project, STATE_FILE_RELATIVE_PATH)), policy).ok).toBe(true);
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mellos-pi-adapter-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('nothing happens when pi loads the extension', () => {
  /**
   * pi runs extension factories in invocations that never begin a session
   * (`pi --list-models`, `pi config`). A child process started here would
   * outlive a command that only wanted a model list.
   */
  it('registers handlers, but starts no server and registers no tool', () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    expect(host.registered).toEqual([]);
    expect(server.starts).toEqual([]);
  });

  /**
   * The load contract, pinned against the failure a real pi session produced:
   * a factory that calls an action method does not lose that call, it loses the
   * whole extension. So the factory gets through a host that refuses every
   * action, and the handlers it registered during loading still do their work
   * once the host has bound its runtime.
   */
  it('gets through a host that refuses every action until its runtime is bound', async () => {
    const server = fakeServer();
    const host = strictHost();

    expect(() => mellosMappingPi(host.api, server.start)).not.toThrow();
    expect(server.starts).toEqual([]);

    await host.fire('session_start', { cwd: project });

    expect(server.starts).toHaveLength(1);
  });
});

describe('the tools pi gets instead of an MCP client', () => {
  it('registers every tool the server advertises, at session start', async () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    await host.fire('session_start', { cwd: project });

    expect([...host.tools.keys()].sort()).toEqual(['mmap_open', 'mmap_view']);
    const view = host.tools.get('mmap_view');
    expect(view?.label).toBe('View the map');
    expect(view?.description).toBe('Read the map');
    // The schema travels to the host as JSON Schema, minus the draft URL: the
    // key describes the schema, not the input the model fills in.
    expect(view?.parameters).toEqual({
      type: 'object',
      properties: { page: { type: 'string' } },
      required: ['page'],
    });
  });

  it('serves the session it was given, not the process it runs in', async () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    await host.fire('session_start', { cwd: project });

    expect(server.starts).toHaveLength(1);
    // `project` is a temporary directory and this spec runs in the repository,
    // so a `process.cwd()` fallback would be visible right here.
    expect(server.starts[0]?.projectDir).toBe(project);
  });

  it('forwards the call and answers with the server text', async () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);
    await host.fire('session_start', { cwd: project });

    const result = await host.tools.get('mmap_view')!.execute('call-1', { page: 'auth' });

    expect(server.calls).toEqual([{ name: 'mmap_view', args: { page: 'auth' } }]);
    expect(result.content).toEqual([{ type: 'text', text: 'called mmap_view' }]);
  });

  /**
   * pi learns that a tool failed by THROWING, and the server's own words are
   * the reason the model can fix its call (`expectedRevision`, a missing page),
   * so they must survive the trip.
   */
  it("throws the server's own error words when the call failed", async () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);
    await host.fire('session_start', { cwd: project });

    server.failCall('mmap_declare: expectedRevision is required');
    await expect(host.tools.get('mmap_view')!.execute('call-2', {})).rejects.toThrow(
      'expectedRevision is required',
    );
  });

  it('answers a cancelled turn instead of throwing', async () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);
    await host.fire('session_start', { cwd: project });

    const controller = new AbortController();
    controller.abort();
    const result = await host.tools.get('mmap_view')!.execute('call-3', {}, controller.signal);

    expect(result.content).toEqual([{ type: 'text', text: 'Cancelled.' }]);
    expect(server.calls).toEqual([]);
  });

  it('starts one server per session, not one per turn', async () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    await host.fire('session_start', { cwd: project });
    await host.fire('before_agent_start', { cwd: project });
    await host.fire('before_agent_start', { cwd: project });

    expect(server.starts).toHaveLength(1);
  });

  /**
   * pi reloads extensions between sessions and emits `session_shutdown` first,
   * so each session owns its child — and never leaves the previous one holding
   * the store.
   */
  it('closes the server at session end and opens a fresh one next time', async () => {
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    await host.fire('session_start', { cwd: project });
    await host.fire('session_shutdown', {});
    expect(server.closes).toBe(1);

    await host.fire('session_start', { cwd: project });
    expect(server.starts).toHaveLength(2);
  });

  /**
   * A session can end while the startup handshake is still running — pi's TUI
   * takes an interrupt while `session_start` handlers run — and at that moment
   * `server` is still undefined, because the start assigns it when it lands. A
   * shutdown that only looked at `server` would close nothing and leave the child
   * that arrives afterwards with nobody to close it.
   */
  it('closes a server whose start was still in flight when the session ended', async () => {
    const server = fakeServer();
    const host = fakeHost();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = async (options: ServerOptions): Promise<MellosServer> => {
      await gate;
      return server.start(options);
    };
    mellosMappingPi(host.api, start);

    const starting = host.fire('session_start', { cwd: project });
    const ending = host.fire('session_shutdown', {});
    release();
    await Promise.all([starting, ending]);

    expect(server.starts).toHaveLength(1);
    expect(server.closes).toBe(1);
  });
});

describe('the paragraph pi gets instead of a SessionStart hook', () => {
  it('takes the policy from this project — the same store the Claude hook reads', () => {
    record('always');
    expect(sessionParagraph(project)).toContain('mellos-mapping policy: always');
  });

  it('arrives on the first agent start, hidden, once per session', async () => {
    record('always');
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);
    await host.fire('session_start', { cwd: project });

    const [first] = await host.fire('before_agent_start', { cwd: project });
    expect(injectedText(first)).toContain('mellos-mapping policy: always');
    expect(injected(first)).toMatchObject({ customType: SESSION_CONTEXT_TYPE, display: false });

    expect((await host.fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();
  });

  it('is delivered again after a compaction, and after a policy change', async () => {
    record('always');
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    await host.fire('before_agent_start', { cwd: project });
    await host.fire('session_compact', {});
    expect(injectedText((await host.fire('before_agent_start', { cwd: project }))[0])).toContain('policy: always');

    record('complex');
    expect(injectedText((await host.fire('before_agent_start', { cwd: project }))[0])).toContain('policy: complex');
  });

  /**
   * A paragraph that told the model to open a pane the session cannot open is
   * worse than no paragraph, so a failed start is reported — once, in the same
   * message, and in the same breath as the policy.
   */
  it('says so, once, when the map server could not start', async () => {
    record('always');
    const server = fakeServer();
    server.failStart(new Error('spawn failed: ENOENT'));
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    await host.fire('session_start', { cwd: project });
    const [first] = await host.fire('before_agent_start', { cwd: project });

    expect(injectedText(first)).toContain('policy: always');
    expect(injectedText(first)).toContain('could not start');
    expect(injectedText(first)).toContain('spawn failed: ENOENT');
    expect((await host.fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();
  });

  it('consumes the arming even when there is nothing to say', async () => {
    record('on-request');
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    expect((await host.fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();
    expect((await host.fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();
  });

  it('keeps the arming when the store itself could not be read', async () => {
    mkdirSync(join(project, '.mellos'), { recursive: true });
    writeFileSync(configFilePath(join(project, STATE_FILE_RELATIVE_PATH)), '{ this is not json');
    const server = fakeServer();
    const host = fakeHost();
    mellosMappingPi(host.api, server.start);

    expect((await host.fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();

    record('always');
    expect(injectedText((await host.fire('before_agent_start', { cwd: project }))[0])).toContain('policy: always');
  });
});
