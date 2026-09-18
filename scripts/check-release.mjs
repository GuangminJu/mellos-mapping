#!/usr/bin/env node
/** Check what a clone receives using only the files shipped in each edition. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITIONS, packageEdition } from './release-layout.mjs';
import { validateRelease, copyRelease } from './install-release.mjs';
import { verifyRuntime } from './verify-runtime.mjs';
import { verifyWebTerminal } from './verify-web-terminal.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'mellos-release-check-'));
try {
  for (const edition of EDITIONS) {
    const output = packageEdition(root, edition);
    const manifest = validateRelease(output);
    const clone = join(temporary, `克隆 & ${edition}`);
    copyRelease(output, clone, manifest);
    const prefix = edition === 'chatgpt-app' ? 'plugins/mellos-mapping' : '';
    const runtime = join(clone, prefix);
    assert.equal(existsSync(join(clone, 'node_modules')), false);
    const help = spawnSync(process.execPath, [join(clone, 'install.mjs'), '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(help.status, 0, help.stderr);
    const checkEnv = { ...process.env };
    delete checkEnv.MELLOS_MAPPING_CWD; delete checkEnv.CLAUDE_PROJECT_DIR;
    await verifyRuntime(join(runtime, 'dist/server.mjs'), temporary, checkEnv);
    await verifyWebTerminal(join(runtime, 'dist/server.mjs'), temporary, checkEnv);
    if (edition === 'chatgpt-app') {
      assert.equal(existsSync(join(runtime, 'hooks')), false);
      assert.equal(existsSync(join(runtime, '.mcp.json')), false);
      const plugin = JSON.parse(readFileSync(join(runtime, '.codex-plugin/plugin.json'), 'utf8'));
      assert.equal(plugin.skills, './skills/');
      assert.ok(existsSync(join(runtime, plugin.skills, 'mellos-mapping/SKILL.md')));
    } else {
      assert.equal(existsSync(join(runtime, '.codex-plugin')), false);
      assert.ok(existsSync(join(runtime, 'dist/hook-session-start.mjs')));
      // omp installs this same edition: its adapter must be declared AND packed,
      // or the host imports a manifest entry that resolves to nothing.
      const ompEntry = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')).omp?.extensions?.[0];
      assert.equal(typeof ompEntry, 'string', 'the Claude edition no longer declares package.json#omp.extensions');
      assert.ok(existsSync(join(runtime, ompEntry.replace(/^\.\//, ''))), `the Claude edition is missing ${ompEntry}`);
    }
    console.log(`${edition}: complete clone, checksums, dependency-free installer and eight-tool MCP handshake passed.`);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
