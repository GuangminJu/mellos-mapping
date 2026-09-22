/**
 * Spec for the interpreter choice behind the pi adapter (./mcp-client.ts).
 *
 * The short version of the question this pins: the map server is a Node program,
 * so a host that is not running on Node cannot start it by naming its own path.
 * pi is both an npm package (hosted by Node, which is what `install.sh` installs)
 * and a set of standalone Bun-compiled binaries (the release assets), and the two
 * need different answers — one runs the server, the other has to say so.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { serverInterpreter } from './mcp-client.js';

describe('the interpreter the map server runs on', () => {
  it('is the interpreter the host is already running on', () => {
    expect(serverInterpreter({ execPath: '/usr/bin/node', bun: undefined })).toBe('/usr/bin/node');
  });

  /**
   * A compiled pi starts a SECOND pi when handed a script path, and then fails
   * its handshake a minute later — so the build is named here, in one line, while
   * the failure can still be explained. `process.versions.bun` is what pi's own
   * `isBunRuntime` reads to recognise this build.
   */
  it('is refused, by name, when the host is a Bun binary', () => {
    expect(() => serverInterpreter({ execPath: '/usr/local/bin/pi', bun: '1.2.3' })).toThrow(/compiled Bun binary/);
  });
});
