import { parseArgs, describeArgsError, runWatcher, USAGE } from './watch.js';
const parsed = parseArgs(process.argv.slice(2), process.cwd());
if (!parsed.ok) {
  console.error(`mellos-mapping-watch: ${describeArgsError(parsed.error)}\n${USAGE}`);
  process.exit(1);
}
runWatcher(parsed.value);
