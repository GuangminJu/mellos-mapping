/**
 * Invariants of the two dsh plugin packages that this repo PUBLISHES but does
 * not build.
 *
 * `packages/dsh` and `packages/dsh-client` are developed inside a dsh
 * workspace and copied here by scripts/sync-dsh-plugin.mjs, `lib/` included —
 * the same policy that commits `dist/` at the root. Nothing in this repo can
 * rebuild that `lib/`, so CI's "committed dist matches src" diff has no
 * equivalent here. These are the checks that ARE possible without the dsh
 * toolchain, and they cover the ways a hand-edit or a half-finished sync has
 * actually been able to ship a broken bundle:
 *
 *   - a source module added or removed without its built counterpart,
 *   - a dsh-internal package name surviving the sync's rename, which the dsh
 *     web loader would fail to match against the installed package,
 *   - the packages drifting off the shared version line,
 *   - the MCP patch row regressing to an unpinned, Windows-broken `npx`.
 *
 * @module
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The published packages, by directory name under `packages/`. */
const PACKAGE_DIRS = ['dsh', 'dsh-client'];

/**
 * dsh-internal names the sync rewrites. Any survivor means the copy still
 * calls itself by its workspace name — for the client bundle's baked module
 * id that is fatal, because the dsh web loader matches it against the
 * installed package name.
 */
const WORKSPACE_SELF_NAMES = ['@deepseek-ai/dsh-mmap-host', '@deepseek-ai/dsh-client-ui-mmap'];

/** Where the workspace toolchain emits declarations for `src/<p>.ts(x)`. */
const DECLARATION_DIR = join('lib', 'types');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    if (statSync(child).isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

/** Repo-relative POSIX path, so failure messages read the same on every OS. */
function rel(path: string): string {
  return relative(repoRoot, path).split('\\').join('/');
}

const rootVersion = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string })
  .version;

describe.each(PACKAGE_DIRS)('packages/%s', (name) => {
  const packageDir = join(repoRoot, 'packages', name);
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    version: string;
    dependencies?: Record<string, string>;
  };

  it('rides the shared version line', () => {
    expect(manifest.version).toBe(rootVersion);
  });

  it('has a committed declaration for every source module', () => {
    const sources = walk(join(packageDir, 'src'))
      .filter((path) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts'))
      .map((path) => relative(join(packageDir, 'src'), path).replace(/\.tsx?$/, ''));
    const declarations = walk(join(packageDir, DECLARATION_DIR))
      .filter((path) => path.endsWith('.d.ts'))
      .map((path) => relative(join(packageDir, DECLARATION_DIR), path).replace(/\.d\.ts$/, ''));

    // Both directions: a source with no declaration means lib/ was not
    // rebuilt; a declaration with no source means lib/ is stale and still
    // ships a module that no longer exists.
    expect(sources.filter((path) => !declarations.includes(path))).toEqual([]);
    expect(declarations.filter((path) => !sources.includes(path))).toEqual([]);
  });

  it('carries no dsh-internal package name', () => {
    const survivors = walk(packageDir)
      .filter((path) => !path.endsWith('.map'))
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return WORKSPACE_SELF_NAMES.some((selfName) => text.includes(selfName));
      })
      .map(rel);
    expect(survivors).toEqual([]);
  });
});

describe('packages/dsh-client bundle identity', () => {
  it('bakes the published package name into the client bundle', () => {
    const bundle = readFileSync(join(repoRoot, 'packages/dsh-client/lib/client.js'), 'utf8');
    expect(bundle).toContain('mellos-mapping-dsh-client');
  });
});

describe('packages/dsh MCP patch row', () => {
  const patch = readFileSync(join(repoRoot, 'packages/dsh/cordis.patch.yml'), 'utf8');
  /** Only the row body matters; the surrounding comments explain the history. */
  const rowBody = patch
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  it('spawns the node binary rather than a shell shim', () => {
    // `npx` is a .cmd shim on Windows and dsh-mcp-client spawns with
    // shell:false, so it is ENOENT there (and `npx.cmd` is EINVAL since the
    // CVE-2024-27980 fix) — the panel mounts and the tools never appear.
    expect(rowBody).not.toMatch(/\bnpx\b/);
    expect(rowBody).toContain('command: !!js process.execPath');
  });

  it('pins the server through the dependency instead of naming a version', () => {
    // The version lives in packages/dsh/package.json, which release.mjs bumps.
    // A literal here would be a second, silently stale bump site.
    expect(rowBody).not.toMatch(/mellos-mapping@\d/);
    expect(rowBody).toContain("resolve('mellos-mapping/server')");
  });
});
