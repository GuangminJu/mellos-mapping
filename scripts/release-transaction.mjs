// @ts-check
/** Stage a complete installation before switching the stable host-facing path. */
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { checkedPath, containsPath, validateRelease } from './release-files.mjs';

const RECORD = 'transaction.json';
const completedStates = new Set(['committed', 'rolled-back', 'abandoned']);

/** Preserve the entire backup when Windows still has one of its addons mapped.
 * Opening for writing does not change bytes, but fails for a loaded DLL.
 * @param {string} directory */
function checkNativeFilesReleasable(directory) {
  if (process.platform !== 'win32') return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) checkNativeFilesReleasable(path);
    else if (entry.isFile() && entry.name.endsWith('.node')) {
      const fd = openSync(path, 'r+');
      closeSync(fd);
    }
  }
}

/** @param {string} work @param {object} record @param {(message: string) => void} warn */
function cleanCompletedWork(work, record, warn) {
  try {
    writeFileSync(join(work, RECORD), JSON.stringify(record, null, 2) + '\n');
    checkNativeFilesReleasable(work);
    rmSync(work, { recursive: true, force: true });
  } catch (error) {
    // A partial cleanup must retain its identity for the next installer. Never
    // treat an unmarked or unfinished transaction as disposable recovery data.
    try { writeFileSync(join(work, RECORD), JSON.stringify(record, null, 2) + '\n'); } catch { /* The warning still identifies the retained directory. */ }
    warn(`Installation cleanup deferred at ${work}. Stop processes using the previous runtime; the next installer will retry cleanup. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Retry completed cleanup only, under this target's installation lock.
 * @param {string} target @param {(message: string) => void} warn */
function cleanPreviousTransactions(target, warn) {
  const parent = dirname(target), prefix = `.${basename(target)}-install-`;
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const work = checkedPath(parent, entry.name);
    try {
      const record = JSON.parse(readFileSync(join(work, RECORD), 'utf8'));
      if (record.format !== 1 || record.target !== target || !completedStates.has(record.state)) continue;
      cleanCompletedWork(work, record, warn);
    } catch { /* Unreadable/unrecognized evidence requires manual inspection. */ }
  }
}

/** @param {string} source @param {string} target
 * @param {import('./install-types.js').ReleaseManifest} manifest
 * @param {{copy?: typeof copyFileSync, warn?: (message: string) => void}} [options] */
export function stageRelease(source, target, manifest, { copy = copyFileSync, warn = console.warn } = {}) {
  source = resolve(source); target = resolve(target);
  if (containsPath(target, source)) throw new Error('Release source must be outside the installation.');
  checkedPath(dirname(target), basename(target));
  mkdirSync(dirname(target), { recursive: true });
  const lock = `${target}.install-lock`;
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch (error) { throw new Error(`Installation is locked: ${lock}. Check for another installer before removing the lock.`, { cause: error }); }
  /** @type {string | undefined} */
  let work;
  let active = false;
  let backedUp = false;
  const record = { format: 1, target, source, state: 'staging', next: manifest };
  /** @param {string} message */
  const report = message => { try { warn(message); } catch { /* Logging cannot change an installation result. */ } };
  const releaseLock = () => {
    try { rmSync(lock); }
    catch (error) { report(`Installation finished, but its lock could not be removed: ${lock}. Check for an active installer before removing it. ${String(error)}`); }
  };
  /** @param {string} state */
  const finish = state => {
    record.state = state;
    try { if (work) cleanCompletedWork(work, record, report); }
    finally { releaseLock(); }
  };
  try {
    cleanPreviousTransactions(target, report);
    work = mkdtempSync(join(dirname(target), `.${basename(target)}-install-`));
    writeFileSync(join(work, RECORD), JSON.stringify(record, null, 2) + '\n');
    const staged = join(work, 'next');
    const previous = join(work, 'previous');
    if (existsSync(target)) {
      cpSync(target, staged, { recursive: true, verbatimSymlinks: true });
      // Remove only files owned by the previous release; keep unrelated user files.
      if (existsSync(join(target, 'release.json'))) {
        const old = JSON.parse(readFileSync(join(target, 'release.json'), 'utf8'));
        for (const file of Object.keys(old.sha256 ?? {})) rmSync(checkedPath(staged, file), { force: true });
      }
    } else mkdirSync(staged);
    for (const file of [...Object.keys(manifest.sha256), 'release.json']) {
      const destination = checkedPath(staged, file);
      mkdirSync(dirname(destination), { recursive: true });
      copy(checkedPath(source, file), destination);
    }
    validateRelease(staged);
    return {
      activate() {
        record.state = 'activating';
        if (work) writeFileSync(join(work, RECORD), JSON.stringify(record, null, 2) + '\n');
        if (existsSync(target)) { renameSync(target, previous); backedUp = true; }
        try { renameSync(staged, target); active = true; }
        catch (error) { if (backedUp) { renameSync(previous, target); backedUp = false; } throw error; }
      },
      commit() { finish('committed'); },
      rollback() {
        // Keep the recovery copy and lock if restoration fails, and report its path.
        try {
          if (active) { renameSync(target, staged); active = false; }
          if (backedUp) { renameSync(previous, target); backedUp = false; }
        } catch (error) { throw new Error(`Could not restore installation. Recovery files retained at ${work}`, { cause: error }); }
        finish('rolled-back');
      },
    };
  } catch (error) { finish('abandoned'); throw error; }
}

/** Synchronous copy for packaging callers, with the same all-files boundary.
 * @param {string} source @param {string} target @param {import('./install-types.js').ReleaseManifest} manifest */
export function copyRelease(source, target, manifest) {
  const transaction = stageRelease(source, target, manifest);
  try { transaction.activate(); }
  catch (error) { transaction.rollback(); throw error; }
  transaction.commit();
}
