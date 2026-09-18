/** Test-only workers. stdout readiness/completion and stdin commands are events. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const [mode, moduleUrl, file, label] = process.argv.slice(2);
const { withStoreLock, storeDirectory } = await import(moduleUrl);
const report = message => writeSync(1, JSON.stringify(message) + '\n');

function command(expected) {
  // A blocking pipe read: no timer or retrying a state query. The synchronous
  // store callback deliberately remains on the stack while the parent writes.
  let line = '';
  const byte = Buffer.alloc(1);
  while (!line.endsWith('\n')) {
    if (readSync(0, byte, 0, 1, null) === 0) throw new Error('Parent closed the command pipe.');
    line += byte.toString('utf8');
  }
  if (line.trim() !== expected) throw new Error(`Expected ${expected}, got ${line.trim()}.`);
}

function attempt(lock = withStoreLock) {
  let executed = false;
  try {
    lock(file, () => {
      executed = true;
      mkdirSync(dirname(file), { recursive: true });
      const values = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
      values.push(label);
      writeFileSync(file, JSON.stringify(values));
    });
    report({ type: 'result', code: 'OK', executed });
  } catch (error) {
    report({ type: 'result', code: error.code, message: error.message, executed });
  }
}

try {
  if (mode === 'write') attempt();
  else if (mode === 'legacy') {
    const legacy = await import('./legacy-store-lock.mjs');
    attempt(legacy.withStoreLock);
  } else if (mode === 'hold') {
    withStoreLock(file, () => { report({ type: 'locked' }); command('release'); });
    report({ type: 'released' });
  } else if (mode === 'old-fd') {
    const { nativeLock } = await import(new URL('./native-lock.js', moduleUrl));
    const backend = nativeLock();
    const fd = openSync(join(storeDirectory(file), '.write-lock'), 'a+');
    let locked = false;
    try {
      locked = backend.tryLock(fd);
      if (!locked) throw new Error('Old descriptor unexpectedly contended.');
      report({ type: 'locked' });
      command('unlock');
      backend.unlock(fd); locked = false;
      report({ type: 'unlocked' });
      command('close');
    } finally {
      if (locked) backend.unlock(fd);
      closeSync(fd);
    }
    report({ type: 'closed' });
  } else if (mode === 'wait-for-kernel-release') {
    // Test-only blocking OS wait handles Windows' delayed cleanup after death.
    // The shipped product API remains immediate tryLock/BUSY with no polling.
    // Load the exact shipped addon directly. Upstream's development-package
    // resolver uses Array.prototype.with on macOS, which Node 18 lacks. The
    // product also deliberately avoids that resolver. Only this test worker
    // uses the addon's blocking primitive; no product API is added for it.
    const binding = createRequire(import.meta.url)(fileURLToPath(new URL(
      `../../dist/native/${process.platform}-${process.arch}/fs-native-extensions.node`, moduleUrl)));
    const fd = openSync(join(storeDirectory(file), '.write-lock'), 'a+');
    let locked = false;
    try {
      report({ type: 'waiting' });
      binding.waitForLockSync(fd, 0, 0, true); locked = true;
      report({ type: 'locked' });
      command('release');
    } finally {
      if (locked) binding.unlock(fd, 0, 0);
      closeSync(fd);
    }
    report({ type: 'released' });
  } else throw new Error(`Unknown worker mode: ${mode}`);
} catch (error) {
  report({ type: 'fatal', message: error.stack || error.message });
  process.exitCode = 1;
}
