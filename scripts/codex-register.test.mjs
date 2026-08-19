/**
 * Spec for the Codex registration script (scripts/codex-register.mjs).
 *
 * The registration itself talks to a CLI that may not be installed, so what
 * is pinned here is the reasoning around it: how a missing CLI is recognized
 * on a platform where it exits like any other failure, and how a path with
 * spaces survives the shell.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMMAND_NOT_FOUND_EXIT_CODE, describeFailure, quoteForShell } from './codex-register.mjs';

describe('reporting a failed registration', () => {
  it('names a missing CLI when cmd.exe reports one, not a mysterious exit code', () => {
    expect(describeFailure(COMMAND_NOT_FOUND_EXIT_CODE)).toContain('codex CLI not found');
    expect(describeFailure(null)).toContain('codex CLI not found');
  });

  it('reports any other exit code as the failure it is', () => {
    expect(describeFailure(1)).toBe('codex mcp add failed (exit 1).');
  });

  it('quotes only what the shell would otherwise split', () => {
    expect(quoteForShell('C:\\Program Files\\p\\dist\\server.mjs')).toBe('"C:\\Program Files\\p\\dist\\server.mjs"');
    expect(quoteForShell('mcp')).toBe('mcp');
  });

  it('captures the child output as bytes, so a non-English console is not mojibake', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'codex-register.mjs'), 'utf8');
    expect(source).not.toContain("encoding: 'utf8'");
  });
});
