/** Stage a complete installation before switching the stable host-facing path. */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { checkedPath, containsPath, validateRelease } from './release-files.mjs';

export function stageRelease(source, target, manifest, { copy = copyFileSync } = {}) {
  source = resolve(source); target = resolve(target);
  if (containsPath(target, source)) throw new Error('Release source must be outside the installation.');
  checkedPath(dirname(target), basename(target));
  mkdirSync(dirname(target), { recursive: true });
  const lock = `${target}.install-lock`;
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch (error) { throw new Error(`Installation is locked: ${lock}. Check for another installer before removing the lock.`, { cause: error }); }
  let work;
  let active = false;
  let backedUp = false;
  const cleanup = () => { if (work) rmSync(work, { recursive: true, force: true }); rmSync(lock); };
  try {
    work = mkdtempSync(join(dirname(target), `.${basename(target)}-install-`));
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
        if (existsSync(target)) { renameSync(target, previous); backedUp = true; }
        try { renameSync(staged, target); active = true; }
        catch (error) { if (backedUp) { renameSync(previous, target); backedUp = false; } throw error; }
      },
      commit() { cleanup(); },
      rollback() {
        // Keep the recovery copy and lock if restoration fails, and report its path.
        try {
          if (active) { renameSync(target, staged); active = false; }
          if (backedUp) { renameSync(previous, target); backedUp = false; }
        } catch (error) { throw new Error(`Could not restore installation. Recovery files retained at ${work}`, { cause: error }); }
        cleanup();
      },
    };
  } catch (error) { cleanup(); throw error; }
}

/** Synchronous copy for packaging callers, with the same all-files boundary. */
export function copyRelease(source, target, manifest) {
  const transaction = stageRelease(source, target, manifest);
  try { transaction.activate(); }
  catch (error) { transaction.rollback(); throw error; }
  transaction.commit();
}
