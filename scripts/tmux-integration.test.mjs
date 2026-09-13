import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const available = process.platform === 'linux' &&
  spawnSync('tmux', ['-V']).status === 0 && spawnSync('script', ['--version']).status === 0;

it.skipIf(!available)('the shipped launcher and MCP server open and reuse real tmux PTYs', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./verify-tmux.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 60000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`).toBe(0);
}, 65000);
