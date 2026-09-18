/** Load the shipped N-API implementation without a runtime npm dependency. */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export interface NativeLock {
  tryLock(fd: number): boolean;
  unlock(fd: number): void;
}

let loaded: NativeLock | undefined;

export function nativeLock(): NativeLock {
  if (loaded) return loaded;
  if (Number(process.versions.napi ?? 0) < 9) {
    throw new Error('Project locks require Node-API 9 (Node 18.17+ or 20.3+).');
  }
  // Bundled entry points live in dist/; source and npm library modules live
  // two directories below the package root. Never resolve from the user's cwd.
  const candidates = [
    new URL('./native-lock.cjs', import.meta.url),
    new URL('../../dist/native-lock.cjs', import.meta.url),
  ];
  const entry = candidates.find(candidate => existsSync(candidate));
  if (!entry) throw new Error('The installed package is missing dist/native-lock.cjs; reinstall the complete package.');
  const backend = createRequire(import.meta.url)(fileURLToPath(entry)) as NativeLock;
  if (typeof backend.tryLock !== 'function' || typeof backend.unlock !== 'function') {
    throw new Error('The installed native lock backend is invalid.');
  }
  loaded = backend;
  return backend;
}
