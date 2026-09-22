/**
 * The version is declared once (package.json) and copied into every manifest
 * a host reads without npm: server.json, the plugin manifests, the package
 * copies, and the VERSION literal the MCP handshake reports and the pane shows.
 * scripts/release.mjs bumps them all — this spec pins that nothing drifted
 * between releases, so a missed bump fails `verify` instead of shipping.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { VERSION } from '../src/support/version.js';

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const pkgVersion = (JSON.parse(read('package.json')) as { version: string }).version;

/** Every file that restates the release version in a `"version": "…"` field. */
const VERSIONED_FILES = [
  'server.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
  // .agents/plugins/marketplace.json carries no version field on purpose:
  // its plugin entry points at the local source, which names its own.
] as const;

describe('one version, many manifests', () => {
  it('VERSION matches package.json', () => {
    expect(VERSION).toBe(pkgVersion);
  });

  for (const file of VERSIONED_FILES) {
    it(`every "version" field in ${file} matches package.json`, () => {
      const fields = [...read(file).matchAll(/"version"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(fields.length).toBeGreaterThan(0);
      for (const v of fields) expect(v).toBe(pkgVersion);
    });
  }
});
