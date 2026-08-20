/**
 * Spec for the last step of every mutating call: the save.
 *
 * A tool answer is a promise about the file on disk, so the one failure the
 * server must never blur is a write that did not land — the caller would
 * carry on believing the ledger recorded work it never saw. The rename is
 * faked here (and only here) for the same reason store's atomic spec fakes
 * it: EPERM on rename needs another process holding the file at the exact
 * instant of a synchronous call, which no test can schedule.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Injected fault state: how many renames still refuse to land. */
const fault = vi.hoisted(() => ({ renameFailures: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      if (fault.renameFailures > 0) {
        fault.renameFailures -= 1;
        // What Windows raises while any process holds `to` open for reading.
        const e = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
        e.code = 'EPERM';
        throw e;
      }
      real.renameSync(from, to);
    },
  };
});

const { buildServer } = await import('./server.js');

let dir: string;
let stateFile: string;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mellos-save-failure-'));
  stateFile = join(dir, '.mellos', 'map.json');
  fault.renameFailures = 0;
  // The user-scope config lives inside the temp tree too: a spec must never be
  // able to read, let alone write, the developer's real configuration.
  const server = buildServer(stateFile, join(dir, 'home', '.mellos', 'config.json'));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'spec-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  fault.renameFailures = 0;
  rmSync(dir, { recursive: true, force: true });
});

async function callText(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content as Array<{ type: string; text: string }>)[0];
  return { text: content?.text ?? '', isError: result.isError === true };
}

const GHOST = {
  layers: [{ id: 'base', name: 'Base', rank: 0 }],
  nodes: [{ id: 'core', label: 'Core', layer: 'base' }],
};

describe('a save that never lands is reported, never assumed', () => {
  it('answers isError and leaves the previous map byte-for-byte intact', async () => {
    expect((await callText('mmap_declare', GHOST)).isError).toBe(false);
    const before = readFileSync(stateFile, 'utf8');

    fault.renameFailures = Number.MAX_SAFE_INTEGER;
    const refused = await callText('mmap_update', { updates: [{ id: 'core', status: 'done', evidence: 'green' }] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('save failed, nothing changed (retry)');
    expect(refused.text).toContain(stateFile); // which file refused the write
    expect(readFileSync(stateFile, 'utf8')).toBe(before);

    // the failure was transient, so the retry the message asks for works
    fault.renameFailures = 0;
    const retried = await callText('mmap_update', { updates: [{ id: 'core', status: 'done', evidence: 'green' }] });
    expect(retried.isError).toBe(false);
    expect(readFileSync(stateFile, 'utf8')).toContain('"evidence": "green"');
  });

  it('says the same thing for a first declare that cannot create the file', async () => {
    fault.renameFailures = Number.MAX_SAFE_INTEGER;
    const refused = await callText('mmap_declare', GHOST);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('save failed, nothing changed (retry)');
    expect(() => readFileSync(stateFile, 'utf8')).toThrow(); // no half-made map either
  });

  it('says the same thing for the mapping policy — configuration is never half-set', async () => {
    fault.renameFailures = Number.MAX_SAFE_INTEGER;
    const refused = await callText('mmap_setup', { policy: 'always' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('save failed, nothing changed (retry)');

    fault.renameFailures = 0;
    expect((await callText('mmap_setup', {})).text).toContain('not set');
  });
});
