/** Map application operations, independent of MCP and presentation adapters. */
import { EMPTY_MAP, type MellosMap, type Result } from '../domain/types.js';
import { loadMapFile, saveMapFile, describeStoreError, type StoreError } from '../store/store.js';
import { existsSync } from 'node:fs';
import { assertRevision, revisionOf } from '../store/transaction.js';

export function loadOrEmpty(file: string): Result<MellosMap, string> {
  const loaded = loadMapFile(file);
  if (loaded.ok) return loaded;
  return loaded.error.kind === 'not-found' ? { ok: true, value: EMPTY_MAP }
    : { ok: false, error: describeStoreError(loaded.error) };
}
export type MutationFailure =
  | { readonly kind: 'load' | 'refused'; readonly detail: string }
  | { readonly kind: 'save'; readonly error: StoreError };

/** Caller holds the project lock for this complete synchronous operation. */
export function mutateMap(file: string, apply: (map: MellosMap) => Result<MellosMap, string>, expectedRevision?: string): Result<MellosMap, MutationFailure> {
  const current = loadOrEmpty(file);
  if (!current.ok) return { ok: false, error: { kind: 'load', detail: current.error } };
  assertRevision(existsSync(file) ? revisionOf(current.value) : 'absent', expectedRevision);
  const applied = apply(current.value);
  if (!applied.ok) return { ok: false, error: { kind: 'refused', detail: applied.error } };
  const saved = saveMapFile(file, applied.value);
  return saved.ok ? applied : { ok: false, error: { kind: 'save', error: saved.error } };
}
