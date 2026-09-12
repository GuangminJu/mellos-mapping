import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODEX_FILES, codexSource, packageCodex } from './package-codex.mjs';

let temporary;
let source;
beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'mellos-package-spec-'));
  source = join(temporary, 'source');
  for (const file of CODEX_FILES) {
    mkdirSync(dirname(join(source, codexSource(file))), { recursive: true });
    writeFileSync(join(source, codexSource(file)), file === '.codex-plugin/plugin.json' ? '{"name":"mellos-mapping"}' : file);
  }
});
afterEach(() => rmSync(temporary, { recursive: true, force: true }));

describe('Codex distribution boundary', () => {
  it('copies only allowed files and clears stale generated output on rebuild', () => {
    mkdirSync(join(source, '.mellos'));
    writeFileSync(join(source, '.mellos', 'map.json'), 'private project map');
    writeFileSync(join(source, '.mcp.json'), 'Claude configuration');
    const output = packageCodex(source);
    for (const file of CODEX_FILES.filter(file => file !== '.codex-plugin/plugin.json')) expect(readFileSync(join(output, file), 'utf8')).toBe(file);
    expect(JSON.parse(readFileSync(join(output, '.codex-plugin/plugin.json'), 'utf8')).skills).toBe('./skills/');
    expect(existsSync(join(output, '.mellos'))).toBe(false);
    expect(existsSync(join(output, '.mcp.json'))).toBe(false);
    writeFileSync(join(output, 'obsolete.txt'), 'old generated output');
    packageCodex(source);
    expect(existsSync(join(output, 'obsolete.txt'))).toBe(false);
    expect(readFileSync(join(source, '.mellos', 'map.json'), 'utf8')).toBe('private project map');
  });

  it('preserves a previous package when a required input is missing', () => {
    const output = packageCodex(source);
    rmSync(join(source, 'dist', 'server.mjs'));
    expect(() => packageCodex(source)).toThrow('input missing');
    expect(readFileSync(join(output, 'dist', 'server.mjs'), 'utf8')).toBe('dist/server.mjs');
  });

  it('refuses an output ancestor redirected outside the source checkout', () => {
    const outside = join(temporary, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'unrelated');
    symlinkSync(outside, join(source, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => packageCodex(source)).toThrow('Refusing redirected');
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('unrelated');
  });
});
