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

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

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
