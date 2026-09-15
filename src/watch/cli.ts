import { parseArgs, describeArgsError, runWatcher, USAGE } from './watch.js';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nativeWatcherIO } from './io.js';
import { createStarReminder, STAR_URL } from '../support/star-reminder.js';
const parsed = parseArgs(process.argv.slice(2), process.cwd());
if (!parsed.ok) {
  console.error(`mellos-mapping-watch: ${describeArgsError(parsed.error)}\n${USAGE}`);
  process.exit(1);
}
let viewed = false;
const io = nativeWatcherIO();
const reminder = createStarReminder({ entry: fileURLToPath(import.meta.url), userBase: homedir(), env: process.env });
runWatcher(parsed.value, { ...io, onMapRendered: () => { viewed = true; } });
// Registered after the watcher's cleanup: restore the user's terminal first.
process.on('exit', code => {
  if (code === 0 && viewed && io.interactive && process.stderr.isTTY && process.env['TERM'] !== 'dumb' && reminder.visit()) {
    process.stderr.write(`\nIf Mellos Mapping has been useful, a GitHub Star is welcome: ${STAR_URL}\nThis optional reminder will not appear again.\n`);
  }
});
