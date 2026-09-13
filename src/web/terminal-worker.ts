/** Dedicated mmap process for one browser, using pipes instead of native addons. */
import { PassThrough, Writable } from 'node:stream';
import { runWatcher, parseArgs, describeArgsError } from '../watch/watch.js';
import { parseTerminalInput, type TerminalOutput } from './terminal-protocol.js';

const config = parseArgs(process.argv.slice(2), process.cwd());
if (!config.ok || !process.send) {
  console.error(config.ok ? 'This worker requires its local service.' : describeArgsError(config.error));
  process.exit(1);
}
const send = (message: TerminalOutput): void => { if (process.connected) process.send!(message); };
class BrowserOutput extends Writable {
  columns = 100;
  rows = 35;
  acknowledge: (() => void) | undefined;
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.acknowledge = () => { this.acknowledge = undefined; callback(); };
    send({ type: 'data', data: chunk.toString('utf8') });
  }
}
const input = new PassThrough();
const output = new BrowserOutput({ highWaterMark: 1 });
let started = false;
process.on('message', raw => {
  const message = parseTerminalInput(JSON.stringify(raw));
  if (!message) return process.exit(1);
  if (message.type === 'ack') output.acknowledge?.();
  else if (message.type === 'start' && !started) {
    started = true;
    output.columns = message.cols; output.rows = message.rows;
    runWatcher(config.value, {
      interactive: true,
      input: { setRawMode() {}, resume: () => { input.resume(); }, setEncoding: encoding => { input.setEncoding(encoding); }, on: (event, listener) => input.on(event, listener) },
      output,
      report: view => send({ type: 'view', ...(view.page ? { page: view.page } : {}), follow: view.follow }),
    });
  } else if (message.type === 'resize' && started) {
    output.columns = message.cols; output.rows = message.rows; output.emit('resize');
  } else if (message.type === 'input' && started) input.write(message.data);
});
process.on('disconnect', () => process.exit(0));
