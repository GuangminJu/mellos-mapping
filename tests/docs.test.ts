/**
 * Doc lint: the documentation is part of the API contract, so the claims it
 * makes about NAMES are checked against the code that owns them.
 *
 * This spec deliberately asserts only what is mechanically decidable and
 * stable — a tool that does not exist, a flag no parser accepts, a store path
 * that moved two releases ago, and the two READMEs drifting out of lockstep.
 * Prose is not linted here: a sentence can go stale in ways no regex sees,
 * and a test that pretended otherwise would be the least honest thing in the
 * repo.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

/** Every prose document this repo ships. */
const DOCS = [
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'skills/mellos-mapping/SKILL.md',
  'commands/mmap.md',
  'packages/dsh/README.md',
  'packages/dsh-client/README.md',
];

/**
 * Documents that tell a user how to open the pane. The dsh package READMEs
 * are out: their flags belong to `dsh plugin`, not to this repo's launcher.
 */
const PANE_DOCS = ['README.md', 'README.zh-CN.md', 'skills/mellos-mapping/SKILL.md', 'commands/mmap.md'];

describe('the store path in the docs', () => {
  /**
   * The store moved to `.mellos/` in 0.20. The legacy names may still appear —
   * an upgrade note that cannot say where the files WERE is useless — but only
   * beside their replacement, which is what a migration table looks like and
   * what a stale instruction does not.
   */
  it('names `.claude/mellos-mapping` only next to what replaced it', () => {
    const stale: string[] = [];
    for (const doc of DOCS) {
      for (const [i, line] of read(doc).split('\n').entries()) {
        if (line.includes('.claude/mellos-mapping') && !line.includes('.mellos/')) {
          stale.push(`${doc}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });
});

describe('the tool names in the docs', () => {
  /** The tools the server actually registers — the only names a doc may use. */
  const registered = new Set(
    [...read('src/server/server.ts').matchAll(/registerTool\(\s*'(mmap_[a-z_]+)'/g)].map((m) => m[1]!),
  );

  it('the server registers the six tools the docs are checked against', () => {
    expect([...registered].sort()).toEqual([
      'mmap_declare',
      'mmap_open',
      'mmap_remove',
      'mmap_setup',
      'mmap_update',
      'mmap_view',
    ]);
  });

  it('mentions no tool the server does not register', () => {
    const unknown: string[] = [];
    for (const doc of DOCS) {
      for (const m of read(doc).matchAll(/mmap_[a-z_]+/g)) {
        if (!registered.has(m[0])) unknown.push(`${doc}: ${m[0]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('documents every tool the server registers', () => {
    const readme = read('README.md');
    const chinese = read('README.zh-CN.md');
    for (const tool of registered) {
      expect(readme, `README.md omits ${tool}`).toContain(tool);
      expect(chinese, `README.zh-CN.md omits ${tool}`).toContain(tool);
    }
  });
});

describe('the pane flags in the docs', () => {
  /**
   * What the two parsers accept. Read out of the sources rather than listed
   * here: a flag added to one parser and not to the other is exactly the drift
   * this checks for, and a third copy of the list would hide it.
   */
  const watcherFlags = new Set(
    [...read('src/watch/watch.ts').matchAll(/case '(--[a-z][a-z0-9-]*)':/g)].map((m) => m[1]!),
  );
  /**
   * The launchers' own flag vocabulary, taken from the three exported arrays
   * that ARE that vocabulary — not from every `--x` literal in the file, which
   * would also collect the arguments passed on to `wt`. Both entry points
   * (`open-pane.mjs`, `mmap.mjs`) read these same arrays from the shared core,
   * which is what makes one extraction enough.
   */
  const launcherSource = read('scripts/pane-core.mjs');
  const flagArray = (name: string): string[] => {
    const declaration = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(launcherSource);
    expect(declaration, `scripts/pane-core.mjs no longer declares ${name}`).not.toBeNull();
    return [...declaration![1]!.matchAll(/'(--[a-z][a-z0-9-]*)'/g)].map((m) => m[1]!);
  };
  const launcherFlags = new Set([
    ...flagArray('WATCHER_BOOLEAN_FLAGS'),
    ...flagArray('WATCHER_VALUE_FLAGS'),
    ...flagArray('PANE_FLAGS'),
    '--page', // consumed inline by parsePaneArgs, so it is in no array
  ]);
  /**
   * The PATH installer is a third command line with a vocabulary of its own,
   * and the READMEs document it. Taken from the usage line it prints, which is
   * the same string a user is shown when they get it wrong.
   */
  const installerFlags = new Set(
    [
      ...(/export const USAGE = '([^']*)'/.exec(read('scripts/install-mmap-command.mjs'))?.[1] ?? '').matchAll(
        /--[a-z][a-z0-9-]*/g,
      ),
    ].map((m) => m[0]),
  );
  const accepted = new Set([...watcherFlags, ...launcherFlags, ...installerFlags]);

  it('all three parsers were found (the extraction still matches the sources)', () => {
    expect(watcherFlags.has('--no-follow')).toBe(true);
    expect(launcherFlags.has('--window')).toBe(true);
    expect(installerFlags.has('--uninstall')).toBe(true);
    expect(accepted.size).toBeGreaterThanOrEqual(10);
  });

  it('mentions no flag neither parser accepts', () => {
    const unknown: string[] = [];
    for (const doc of PANE_DOCS) {
      for (const m of read(doc).matchAll(/(?<![-\w])--[a-z][a-z0-9-]*/g)) {
        if (!accepted.has(m[0])) unknown.push(`${doc}: ${m[0]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('documents the whole launcher flag set in both READMEs', () => {
    for (const doc of ['README.md', 'README.zh-CN.md']) {
      const text = read(doc);
      for (const flag of accepted) {
        expect(text, `${doc} omits ${flag}`).toContain(flag);
      }
    }
  });
});

describe('the two READMEs stay in lockstep', () => {
  /** Heading levels in order — structure survives translation, wording does not. */
  const outline = (doc: string): string[] =>
    [...read(doc).matchAll(/^(#{2,})\s/gm)].map((m) => m[1]!);

  it('has the same section outline in English and Chinese', () => {
    expect(outline('README.zh-CN.md')).toEqual(outline('README.md'));
  });
});
