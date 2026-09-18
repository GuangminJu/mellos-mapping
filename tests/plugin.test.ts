/**
 * The plugin's contract with its HOST, checked where nothing else can check it.
 *
 * A hook is registered by a JSON file naming a path inside a bundle the build
 * produces. Neither half fails loudly when it drifts: a command pointing at a
 * file that is not built exits non-zero and Claude Code carries on without the
 * context, so the plugin simply stops working with no error anyone sees. This
 * spec is the only place the two are ever compared.
 *
 * @module
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

// Keep the published manifests compatible with Claude Code versions that
// reject unknown keys (#7). Newer hosts accept displayName, but installing
// this plugin should not require users to upgrade their host first.
describe('Claude manifests use the backwards-compatible metadata schema', () => {
  const author = z.object({ name: z.string(), email: z.string().optional(), url: z.string().optional() }).strict();
  const metadata = {
    name: z.string(), version: z.string(), description: z.string(), author,
    homepage: z.string().optional(),
  };
  const plugin = z.object({
    ...metadata,
    repository: z.string().optional(), license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  }).strict();
  const marketplace = z.object({
    name: z.string(), owner: author, description: z.string(),
    plugins: z.array(z.object({
      ...metadata, source: z.literal('./'),
      category: z.string().optional(), tags: z.array(z.string()).optional(),
      strict: z.boolean().optional(),
    }).strict()).min(1),
  }).strict();

  it('the installable plugin retains supported metadata without newer host-only fields', () => {
    expect(() => plugin.parse(JSON.parse(read('.claude-plugin/plugin.json')))).not.toThrow();
  });

  it('the marketplace uses tags and only metadata older marketplace validators accept', () => {
    expect(() => marketplace.parse(JSON.parse(read('.claude-plugin/marketplace.json')))).not.toThrow();
  });
});

interface HookHandler {
  readonly type: string;
  readonly command: string;
}
interface HookMatcher {
  readonly matcher?: string;
  readonly hooks: readonly HookHandler[];
}
interface HooksFile {
  readonly hooks: Record<string, readonly HookMatcher[]>;
}

/**
 * Claude Code discovers `hooks/hooks.json` at the PLUGIN ROOT with no manifest
 * field (docs: /docs/en/plugins, "Plugin structure overview"). It is therefore
 * registered by existing at exactly this path — which is why the path is
 * asserted rather than derived.
 */
const HOOKS_FILE = 'hooks/hooks.json';

describe('the SessionStart hook is registered where the host looks', () => {
  const hooks = JSON.parse(read(HOOKS_FILE)) as HooksFile;

  it('lives at the plugin root, outside .claude-plugin/', () => {
    expect(existsSync(join(repoRoot, HOOKS_FILE))).toBe(true);
    expect(existsSync(join(repoRoot, '.claude-plugin', 'hooks'))).toBe(false);
  });

  it('registers SessionStart with no matcher — resume and compact need the context too', () => {
    expect(Object.keys(hooks.hooks)).toEqual(['SessionStart']);
    const [entry] = hooks.hooks['SessionStart']!;
    expect(entry?.matcher).toBeUndefined();
    expect(entry?.hooks).toHaveLength(1);
    expect(entry?.hooks[0]?.type).toBe('command');
  });

  it('finds its bundle through ${CLAUDE_PLUGIN_ROOT}, the only portable anchor', () => {
    const { command } = hooks.hooks['SessionStart']![0]!.hooks[0]!;
    expect(command).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(command).toMatch(/^node "/); // quoted: a plugin root can hold spaces
  });

  it('names a bundle the build actually emits', () => {
    const { command } = hooks.hooks['SessionStart']![0]!.hooks[0]!;
    const relative = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/.exec(command)?.[1];
    expect(relative, 'the command no longer names a path under the plugin root').toBeDefined();
    expect(read('build.mjs')).toContain(`outfile: '${relative}'`);
  });
});

describe('nothing drops the registration on the way to a user', () => {
  it('is not ignored by git — a plugin install is a clone', () => {
    // The one directory-level rule that could swallow it; `git check-ignore`
    // would need a process, and this file's whole job is being cheap.
    expect(read('.gitignore')).not.toMatch(/^\s*hooks\/?\s*$/m);
  });

  it('is absent from the npm surface on purpose — `files` ships a library, not a plugin', () => {
    const manifest = JSON.parse(read('package.json')) as { files: readonly string[] };
    expect(manifest.files).not.toContain('hooks');
  });
});

/**
 * omp has no `hooks/hooks.json`, so its session paragraph comes from an
 * extension module — and an extension module is named by a MANIFEST FIELD
 * pointing at a bundle the build must have produced. Drift between the two
 * fails the same silent way the hook registration does: the host imports a
 * path that is not there, mapping simply stops being mentioned, and nothing
 * reports it. Same contract, second host.
 */
describe('the omp session adapter is declared where omp looks', () => {
  interface OmpManifest {
    readonly omp?: { readonly extensions?: readonly string[] };
  }

  it('names, in package.json#omp.extensions, a bundle the build emits', () => {
    const manifest = JSON.parse(read('package.json')) as OmpManifest;
    const entry = manifest.omp?.extensions?.[0];
    expect(entry, 'package.json no longer declares an omp extension').toBeDefined();
    const relative = (entry ?? '').replace(/^\.\//, '');
    expect(relative).not.toBe('');
    expect(read('build.mjs')).toContain(`outfile: '${relative}'`);
  });
});
