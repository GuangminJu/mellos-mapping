/**
 * Spec for the omp host adapter (./extension.ts).
 *
 * omp gives an extension exactly one moment to put text in front of the model —
 * `before_agent_start` — so this pins the two things that are easy to get wrong
 * and hard to notice: the paragraph ARRIVES (once, on the first agent start,
 * and again after a compaction, because that is where a standing instruction
 * gets lost) and the SILENCE survives (a session with nothing to say must not
 * be told so on every single turn).
 *
 * The paragraph itself is not restated here: it is the same
 * `sessionStartContext()` the Claude hook prints, and the store scope rules are
 * read from the same files, so what this spec asserts is the wiring — policy
 * read from the project scope, one injection, one re-arm.
 *
 * @module
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MappingPolicy } from '../../store/store.js';
import { STATE_FILE_RELATIVE_PATH, configFilePath, saveMappingPolicy } from '../../store/store.js';
import { SESSION_CONTEXT_TYPE, sessionParagraph } from '../session-context.js';
import mellosMappingOmp from './extension.js';

/** A stand-in for omp's ExtensionAPI: records handlers, then lets a spec fire them. */
function fakePi(): {
  api: Parameters<typeof mellosMappingOmp>[0];
  fire: (event: string, ctx: unknown) => Promise<readonly unknown[]>;
} {
  const handlers: Record<string, ((event: unknown, ctx: unknown) => unknown)[]> = {};
  return {
    api: {
      on(event, handler) {
        handlers[event] = [...(handlers[event] ?? []), handler];
      },
    },
    async fire(event, ctx) {
      const results: unknown[] = [];
      for (const handler of handlers[event] ?? []) results.push(await handler({ type: event }, ctx));
      return results;
    },
  };
}

/** The message the adapter handed the host, read across its untyped boundary. */
function injectedMessage(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== 'object' || result === null || !('message' in result)) return undefined;
  const { message } = result;
  return typeof message === 'object' && message !== null ? { ...message } : undefined;
}

/** The text it carried. */
function injectedContext(result: unknown): string | undefined {
  const message = injectedMessage(result);
  return typeof message?.['content'] === 'string' ? message['content'] : undefined;
}

let project: string;

const record = (policy: MappingPolicy): void => {
  mkdirSync(join(project, '.mellos'), { recursive: true });
  const saved = saveMappingPolicy(configFilePath(join(project, STATE_FILE_RELATIVE_PATH)), policy);
  expect(saved.ok).toBe(true);
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mellos-omp-adapter-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('nothing happens when omp loads the extension', () => {
  /**
   * The same load contract pi enforces with a hard failure, pinned here for the
   * host that merely documents it: a factory may register handlers and nothing
   * else, so `setLabel` — an action — is asked for from `session_start`, the
   * first moment the host is bound and can be told something.
   */
  it('touches no runtime action while loading, and labels itself at session start', async () => {
    const handlers: Record<string, ((event: unknown, ctx: unknown) => unknown)[]> = {};
    const labels: string[] = [];
    let bound = false;
    const notBound = (): never => {
      throw new Error('runtime actions are not available while the extension loads');
    };
    const api: Parameters<typeof mellosMappingOmp>[0] = {
      on(event, handler) {
        handlers[event] = [...(handlers[event] ?? []), handler];
      },
      setLabel(label) {
        if (!bound) notBound();
        labels.push(label);
      },
    };

    expect(() => mellosMappingOmp(api)).not.toThrow();
    expect(labels).toEqual([]);

    bound = true;
    const start = handlers['session_start']?.[0];
    expect(start).toBeDefined();
    await start?.({ type: 'session_start' }, undefined);

    expect(labels).toEqual(['Mellos Mapping']);
  });
});

describe('the paragraph the adapter reads', () => {
  it('takes the policy from this project — the same store the Claude hook reads', () => {
    record('always');
    expect(sessionParagraph(project)).toContain('mellos-mapping policy: always');
  });

  it('says nothing for on-request in a project that never had a map', () => {
    record('on-request');
    expect(sessionParagraph(project)).toBeUndefined();
  });
});

describe('the injection omp gets instead of a SessionStart hook', () => {
  it('arrives on the first agent start, hidden, once per session', async () => {
    record('always');
    const { api, fire } = fakePi();
    mellosMappingOmp(api);

    const [first] = await fire('before_agent_start', { cwd: project });
    expect(injectedContext(first)).toContain('mellos-mapping policy: always');
    expect(injectedMessage(first)).toMatchObject({
      customType: SESSION_CONTEXT_TYPE,
      display: false,
      attribution: 'agent',
    });

    // The second turn of the same session is not told the same paragraph again.
    const [second] = await fire('before_agent_start', { cwd: project });
    expect(second).toBeUndefined();
  });

  it('is delivered again after a compaction', async () => {
    record('always');
    const { api, fire } = fakePi();
    mellosMappingOmp(api);

    await fire('before_agent_start', { cwd: project });
    await fire('session_compact', {});
    const [after] = await fire('before_agent_start', { cwd: project });
    expect(injectedContext(after)).toContain('mellos-mapping policy: always');
  });

  /**
   * omp emits `session_start` only when the process creates a session; `/new`,
   * resume, fork and branch reuse the same runner and emit `session_switch` /
   * `session_branch` instead. Without arming on those, the first session would
   * spend the paragraph for every session that follows in the same process.
   */
  it('is delivered again to a session that follows in the same process', async () => {
    record('always');
    const { api, fire } = fakePi();
    mellosMappingOmp(api);

    await fire('before_agent_start', { cwd: project });
    await fire('session_switch', { reason: 'new' });
    expect(injectedContext((await fire('before_agent_start', { cwd: project }))[0])).toContain('mellos-mapping policy: always');

    await fire('session_switch', { reason: 'resume' });
    expect(injectedContext((await fire('before_agent_start', { cwd: project }))[0])).toContain('mellos-mapping policy: always');

    await fire('session_branch', {});
    expect(injectedContext((await fire('before_agent_start', { cwd: project }))[0])).toContain('mellos-mapping policy: always');
  });

  /**
   * The paragraph describes a policy that can move under a long session, and
   * the store can be unreadable for a moment (a half-written file, a lock).
   * Neither may end with the session quietly holding a stale answer — or, in
   * the failure case, no answer at all for the rest of its life.
   */
  it('is delivered again when the policy changed under the session', async () => {
    record('always');
    const { api, fire } = fakePi();
    mellosMappingOmp(api);
    expect(injectedContext((await fire('before_agent_start', { cwd: project }))[0])).toContain('policy: always');

    record('complex');
    const [after] = await fire('before_agent_start', { cwd: project });
    expect(injectedContext(after)).toContain('policy: complex');

    // ...and an unchanged policy is not repeated on every turn
    expect((await fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();
  });

  it('keeps the arming when the store itself could not be read', async () => {
    mkdirSync(join(project, '.mellos'), { recursive: true });
    writeFileSync(configFilePath(join(project, STATE_FILE_RELATIVE_PATH)), '{ this is not json');
    const { api, fire } = fakePi();
    mellosMappingOmp(api);

    // the read failed: nothing is said AND nothing is spent
    expect((await fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();

    // the store is readable again on the next turn: the session gets its policy
    record('always');
    expect(injectedContext((await fire('before_agent_start', { cwd: project }))[0])).toContain('policy: always');
  });

  it('consumes the arming even when there is nothing to say', async () => {
    record('on-request');
    const { api, fire } = fakePi();
    mellosMappingOmp(api);

    expect((await fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();
    // Nothing was said once, so nothing is said again — silence is not a queue.
    expect((await fire('before_agent_start', { cwd: project }))[0]).toBeUndefined();
  });
});
