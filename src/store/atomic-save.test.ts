/**
 * Spec for the write half of P2 — the parts that only a FAULTY filesystem
 * can show: a rename the OS refuses while a reader holds the target open,
 * and two writers that must not share one temp file.
 *
 * node:fs is faked here (and only here) because the faults are real but not
 * reproducible on demand: EPERM on rename needs a concurrent reader holding
 * a handle at the exact instant of a synchronous call, which no test can
 * schedule. Everything else about the store is specified against a real
 * filesystem in store.test.ts.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareLayer, declareNode, setTitle } from '../domain/ops.js';
import { EMPTY_MAP, type LayerId, type MellosMap, type NodeId, type Rank, type Result } from '../domain/types.js';

/**
 * Injected fault state: how many renames still fail, every file written, and
 * what the target and the temp held at the instant of each rename — the only
 * moment at which "atomic" is observable from inside one process.
 */
const fault = vi.hoisted(() => ({
  renameFailures: 0,
  written: [] as string[],
  /** Target content just before each rename; undefined = the target did not exist. */
  targetAtRename: [] as (string | undefined)[],
  /** Temp content just before each rename — what the swap is about to install. */
  tempAtRename: [] as string[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    writeFileSync: (file: string, data: string, encoding: BufferEncoding) => {
      fault.written.push(String(file));
      real.writeFileSync(file, data, encoding);
    },
    renameSync: (from: string, to: string) => {
      if (fault.renameFailures > 0) {
        fault.renameFailures -= 1;
        // What Windows raises when any process holds `to` open for reading.
        const e = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
        e.code = 'EPERM';
        throw e;
      }
      let existing: string | undefined;
      try {
        existing = real.readFileSync(to, 'utf8');
      } catch {
        existing = undefined; // first save of this path: nothing to replace
      }
      fault.targetAtRename.push(existing);
      fault.tempAtRename.push(real.readFileSync(from, 'utf8'));
      real.renameSync(from, to);
    },
  };
});

const { describeStoreError, saveMapFile, saveMappingPolicy, serializeMap, configFilePath } = await import('./store.js');

function must<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
  return r.value;
}

function mustFail<T, E>(r: Result<T, E>): E {
  if (r.ok) throw new Error('expected an error, but the operation succeeded');
  return r.error;
}

function sampleMap(): MellosMap {
  const map = must(declareLayer(EMPTY_MAP, { id: 'base' as LayerId, name: 'Base', rank: 0 as Rank }));
  return must(declareNode(map, { id: 'n' as NodeId, label: 'N', layer: 'base' as LayerId }));
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mellos-atomic-spec-'));
  fault.renameFailures = 0;
  fault.written = [];
  fault.targetAtRename = [];
  fault.tempAtRename = [];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('atomic writes under a hostile filesystem (P2)', () => {
  /**
   * The promise itself, observed rather than assumed: a reader that looks at
   * the target at ANY point during a save sees a whole map, because the new
   * bytes are complete in the temp file before the single rename that
   * publishes them, and the target holds its previous content in full until
   * that instant. Nothing else in the suite can watch this — a real reader
   * would have to be scheduled inside a synchronous call.
   */
  it('replaces the whole file in one step: the target holds the old map in full until the swap', () => {
    const path = join(dir, 'map.json');
    const first = sampleMap();
    const second = setTitle(sampleMap(), 'v2');
    must(saveMapFile(path, first));
    must(saveMapFile(path, second));

    expect(fault.targetAtRename).toEqual([undefined, serializeMap(first)]);
    // ...and each rename installed a COMPLETE serialization, never a prefix
    expect(fault.tempAtRename).toEqual([serializeMap(first), serializeMap(second)]);
    expect(readFileSync(path, 'utf8')).toBe(serializeMap(second));
    expect(readdirSync(dir)).toEqual(['map.json']);
  });

  it('gives every save a temp file of its own — two writers never share one', () => {
    const path = join(dir, 'map.json');
    must(saveMapFile(path, sampleMap()));
    must(saveMapFile(path, sampleMap()));

    expect(fault.written).toHaveLength(2);
    expect(fault.written[0]).not.toBe(fault.written[1]);
    // ...and both are siblings of the target, so the rename stays on one volume
    for (const temp of fault.written) {
      expect(temp.startsWith(`${path}.`)).toBe(true);
      expect(temp.endsWith('.tmp')).toBe(true);
    }
    expect(readdirSync(dir)).toEqual(['map.json']);
  });

  it('retries a rename the OS refuses while a reader holds the file open', () => {
    const path = join(dir, 'map.json');
    fault.renameFailures = 3;
    must(saveMapFile(path, sampleMap()));
    expect(fault.renameFailures).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(serializeMap(sampleMap()));
  });

  it('reports a rename that never lands as a Result, not an exception', () => {
    const path = join(dir, 'map.json');
    fault.renameFailures = Number.MAX_SAFE_INTEGER;
    const error = mustFail(saveMapFile(path, sampleMap()));
    expect(error.kind).toBe('save-failed');
    expect(describeStoreError(error)).toContain('EPERM');
    expect(describeStoreError(error)).toContain(path);
    // the caller's map is untouched and no half-written temp survives
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports a failed policy write the same way — configuration is never half-set', () => {
    const defaultFile = join(dir, '.mellos', 'map.json');
    fault.renameFailures = Number.MAX_SAFE_INTEGER;
    expect(mustFail(saveMappingPolicy(defaultFile, 'always')).kind).toBe('save-failed');
    expect(readdirSync(join(dir, '.mellos'))).toEqual([]);
    fault.renameFailures = 0;
    must(saveMappingPolicy(defaultFile, 'always'));
    expect(readFileSync(configFilePath(defaultFile), 'utf8')).toContain('"policy": "always"');
  });
});
