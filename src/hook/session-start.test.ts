/**
 * Spec for the SessionStart hook (./session-start.ts).
 *
 * The composition is a pure function of four values, so this states the whole
 * contract: what the assistant is told under each policy, and — the promise
 * that is easiest to break and hardest to notice — when it is told nothing.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MappingPolicy } from '../store/store.js';
import {
  type SessionContextInput,
  hasMap,
  hookOutput,
  installContextLine,
  mmapCommandResolves,
  mmapFallbackDirs,
  mmapShimCurrent,
  mmapShimFilePath,
  parseHookInput,
  sessionStartContext,
  shimIsOurs,
} from './session-start.js';

const base: SessionContextInput = {
  policy: 'always',
  hasStore: true,
};

const contextFor = (over: Partial<SessionContextInput>): string | undefined =>
  sessionStartContext({ ...base, ...over });

describe('nobody has chosen a policy yet', () => {
  const ask = (): string => contextFor({ policy: undefined })!;

  it('asks once ever, and says so — the whole point of the user scope', () => {
    expect(ask()).toContain('ONCE EVER');
    expect(ask()).toContain('not once per project');
  });

  it('offers all three options with the vocabulary every other surface uses', () => {
    for (const p of ['always', 'complex', 'on-request'] as MappingPolicy[]) {
      expect(ask()).toContain(p);
    }
    expect(ask()).toContain('map every structured task');
    expect(ask()).toContain('medium or complex');
    expect(ask()).toContain('explicitly asks');
  });

  it('names the exact call that records the answer, at user scope', () => {
    expect(ask()).toContain('mmap_setup');
    expect(ask()).toContain('scope: "user"');
    expect(ask()).toContain('scope: "project"'); // and how a project overrides it
  });

  it('forbids choosing for the user', () => {
    expect(ask()).toContain('Do not choose for them');
  });

  it('asks whether or not the project already has a map', () => {
    expect(contextFor({ policy: undefined, hasStore: false })).toBe(ask());
  });
});

describe('always — the pane opens without being asked', () => {
  const ctx = (): string => contextFor({ policy: 'always' })!;

  it('scopes the instruction to ANY structured task', () => {
    expect(ctx()).toContain('ANY structured task');
    expect(ctx()).toContain('map every structured task');
  });

  it('orders the loop: skill, ghost design, pane, then honest updates', () => {
    const text = ctx();
    expect(text.indexOf('mellos-mapping skill')).toBeLessThan(text.indexOf('mmap_declare'));
    expect(text.indexOf('mmap_declare')).toBeLessThan(text.indexOf('mmap_open'));
    expect(text).toContain('done WITH EVIDENCE');
  });

  it('says the recorded policy IS the consent, so the pane is not negotiated', () => {
    expect(ctx()).toContain('WITHOUT asking');
    expect(ctx()).toContain('standing consent');
  });

  // A tool call, not a command line: it needs no shell permission, no path
  // to expand and no host that has one. It is also the only route that says
  // back whether a pane actually came up.
  it('names the tool that opens the pane, and the page to open it on', () => {
    expect(ctx()).toContain('mmap_open {page: "<the page this effort lives on>"}');
    expect(ctx()).not.toContain('CLAUDE_PLUGIN_ROOT');
  });

  it('tells the session that every write reports whether anybody is looking', () => {
    expect(ctx()).toContain('pane: CLOSED');
  });

  it('leaves an explicit user request on top', () => {
    expect(ctx()).toContain('outranks');
  });
});

describe('complex — the same loop, on the tasks that deserve it', () => {
  const ctx = (): string => contextFor({ policy: 'complex' })!;

  it('scopes the instruction to medium and complex work, and says to skip trivial edits', () => {
    expect(ctx()).toContain('MEDIUM OR COMPLEX');
    expect(ctx()).toContain('skip trivial edits');
  });

  it('repeats the policy\'s own one-line meaning rather than inventing wording', () => {
    expect(ctx()).toContain('map only medium or complex tasks');
  });

  it('still opens the pane without asking, and still names the tool', () => {
    expect(ctx()).toContain('WITHOUT asking');
    expect(ctx()).toContain('mmap_open');
  });
});

describe('a project HAS a map when a page file does, not when a directory does', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mellos-hook-hasmap-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const stateFile = (): string => join(dir, '.mellos', 'map.json');

  it('says no for a project with nothing at all', () => {
    expect(hasMap(stateFile())).toBe(false);
  });

  // A pane publishes its viewer report from the moment it opens, so the
  // store directory now exists in projects that have never had a map. It
  // must not read as one.
  it('says no for a store directory a running pane created', () => {
    mkdirSync(join(dir, '.mellos', 'viewers'), { recursive: true });
    writeFileSync(join(dir, '.mellos', 'viewers', '4242.json'), '{}');
    expect(hasMap(stateFile())).toBe(false);
  });

  it('says yes for the default page, and for a pages directory', () => {
    mkdirSync(join(dir, '.mellos'), { recursive: true });
    writeFileSync(stateFile(), '{}');
    expect(hasMap(stateFile())).toBe(true);

    rmSync(stateFile());
    mkdirSync(join(dir, '.mellos', 'pages'), { recursive: true });
    expect(hasMap(stateFile())).toBe(true);
  });
});

describe('on-request — silence is the feature', () => {
  it('says one quiet line in a project that HAS a map', () => {
    const ctx = contextFor({ policy: 'on-request', hasStore: true })!;
    expect(ctx.split('\n')).toHaveLength(1);
    expect(ctx).toContain('only when they ask');
  });

  it('says NOTHING at all in a project that has none', () => {
    expect(contextFor({ policy: 'on-request', hasStore: false })).toBeUndefined();
  });
});

describe('the hook payload', () => {
  it('takes the project from the session cwd the host sends', () => {
    expect(parseHookInput('{"cwd":"C:\\\\work\\\\app","hook_event_name":"SessionStart"}')).toEqual({
      cwd: 'C:\\work\\app',
    });
  });

  it('treats every unusable payload as "no cwd", never as a failure', () => {
    for (const raw of ['', 'not json', 'null', '[]', '{}', '{"cwd":5}', '{"cwd":""}']) {
      expect(parseHookInput(raw)).toEqual({ cwd: undefined });
    }
  });

  it('emits exactly the envelope the SessionStart contract documents', () => {
    expect(JSON.parse(hookOutput('hello'))).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hello' },
    });
  });
});

describe('the mmap command installs itself — the hook side of the installer contract', () => {
  it('watches the exact file scripts/install-mmap-command.mjs owns (both specs pin these segments)', () => {
    expect(mmapShimFilePath('C:\\Users\\ada\\AppData\\Local')).toBe(
      join('C:\\Users\\ada\\AppData\\Local', 'mellos-mapping', 'bin', 'mmap.cmd'),
    );
  });

  it('a shim quoting THIS install\'s bundle is current; anything else is stale', () => {
    const mine = 'C:\\cache\\0.20.2\\dist\\mmap.mjs';
    expect(mmapShimCurrent(`@echo off\r\nnode "${mine}" %*\r\n`, mine)).toBe(true);
    expect(mmapShimCurrent(`@echo off\r\nnode "C:\\cache\\0.20.1\\dist\\mmap.mjs" %*\r\n`, mine)).toBe(false);
    expect(mmapShimCurrent(undefined, mine)).toBe(false);
  });

  it('counts the git-bash shape as our own — its slashes are not a different install', () => {
    const mine = 'C:\\cache\\0.26.0\\dist\\mmap.mjs';
    expect(mmapShimCurrent(`#!/bin/sh\nexec node "${mine.replaceAll('\\', '/')}" "$@"\n`, mine)).toBe(true);
  });

  it('a PATH update is announced, and names the one thing the user must do', () => {
    const line = installContextLine({ kind: 'installed', binDir: 'C:\\bin', path: 'updated', wanted: 'C:\\a;C:\\bin' })!;
    expect(line).toContain('C:\\bin');
    // a new TAB inherits the old environment — the instruction must be the
    // whole-process restart, or the user tries mmap and concludes it broke
    expect(line).toContain('close Windows Terminal entirely');
    expect(line).toContain('`mmap`');
  });

  it('a refusal is relayed with its reason and the manual step', () => {
    for (const path of ['refused', 'error'] as const) {
      const line = installContextLine({ kind: 'installed', binDir: 'C:\\bin', path, reason: 'because setx' })!;
      expect(line).toContain('NOT changed');
      expect(line).toContain('because setx');
      expect(line).toContain('user PATH');
    }
  });

  it('maintenance and noise are silent: unchanged, not-built, junk', () => {
    expect(installContextLine({ kind: 'installed', binDir: 'C:\\bin', path: 'unchanged' })).toBeUndefined();
    expect(installContextLine({ kind: 'not-built', missing: 'C:\\dist\\mmap.mjs' })).toBeUndefined();
    for (const junk of [undefined, null, 'text', 42, {}, { kind: 'installed' }]) {
      expect(installContextLine(junk)).toBeUndefined();
    }
  });
});

describe('the command resolving is not the file having been written', () => {
  const local = 'C:\\Users\\ada\\AppData\\Local';
  const home = 'C:\\Users\\ada';
  const mine = 'C:\\Users\\ada\\.omp\\cache\\plugins\\mellos-mapping___mellos-mapping___0.26.0\\dist\\mmap.mjs';
  const [windowsApps, dotLocal] = mmapFallbackDirs(local, home);
  const cmd = (target: string): string => `@echo off\r\nnode "${target}" %*\r\n`;
  const sh = (target: string): string => `#!/bin/sh\nexec node "${target.replaceAll('\\', '/')}" "$@"\n`;

  it('probes the same two directories the installer writes to — the pair is pinned on both sides', () => {
    expect([windowsApps, dotLocal]).toEqual([join(local, 'Microsoft', 'WindowsApps'), join(home, '.local', 'bin')]);
  });

  it('the canonical directory needs nothing else while the PATH names it', () => {
    const path = `C:\\Windows;${join(local, 'mellos-mapping', 'bin')}`;
    expect(mmapCommandResolves(local, mine, { path, home }, () => undefined, () => false)).toBe(true);
  });

  it('a fallback copy counts when it launches THIS install from a named directory — either shape', () => {
    const listing: Record<string, string> = { [join(windowsApps, 'mmap.cmd')]: cmd(mine) };
    expect(mmapCommandResolves(local, mine, { path: `C:\\Windows;${windowsApps}`, home }, (p) => listing[p], (p) => p === windowsApps)).toBe(true);
    const bash: Record<string, string> = { [join(dotLocal, 'mmap')]: sh(mine) };
    expect(mmapCommandResolves(local, mine, { path: dotLocal, home }, (p) => bash[p], (p) => p === dotLocal)).toBe(true);
  });

  it('a stale copy of ours is no resolution — the installer must run', () => {
    const stale: Record<string, string> = { [join(windowsApps, 'mmap.cmd')]: cmd(mine.replace('0.26.0', '0.24.0')) };
    expect(mmapCommandResolves(local, mine, { path: windowsApps, home }, (p) => stale[p], (p) => p === windowsApps)).toBe(false);
    // one current file does not excuse a stale sibling: each shell resolves its own shape
    const mixed: Record<string, string> = { [join(windowsApps, 'mmap.cmd')]: cmd(mine), [join(windowsApps, 'mmap')]: sh(mine.replace('0.26.0', '0.24.0')) };
    expect(mmapCommandResolves(local, mine, { path: windowsApps, home }, (p) => mixed[p], (p) => p === windowsApps)).toBe(false);
  });

  it('a stranger owning the name settles it — nothing of ours to repair', () => {
    const stranger: Record<string, string> = { [join(windowsApps, 'mmap')]: '#!/bin/sh\nexec /usr/bin/mmap "$@"\n' };
    expect(mmapCommandResolves(local, mine, { path: windowsApps, home }, (p) => stranger[p], (p) => p === windowsApps)).toBe(true);
  });

  it('an unnamed directory, or no copy at all, needs the installer', () => {
    const elsewhere: Record<string, string> = { [join(dotLocal, 'mmap')]: sh(mine) };
    expect(mmapCommandResolves(local, mine, { path: 'C:\\Windows', home }, (p) => elsewhere[p], (p) => p === dotLocal)).toBe(false);
    expect(mmapCommandResolves(local, mine, { path: `C:\\Windows;${windowsApps}`, home }, () => undefined, (p) => p === windowsApps)).toBe(false);
    expect(mmapCommandResolves(local, mine, { path: windowsApps, home: undefined }, () => undefined, () => true)).toBe(false);
  });

  it('recognizes the family\'s shims by marker, or by the path that predates it', () => {
    expect(shimIsOurs('@echo off\r\nrem mellos-mapping mmap shim\r\nnode "C:\\anywhere\\dist\\mmap.mjs" %*\r\n')).toBe(true);
    expect(shimIsOurs('#!/bin/sh\n# mellos-mapping mmap shim\nexec node "C:/anywhere/dist/mmap.mjs" "$@"\n')).toBe(true);
    expect(shimIsOurs('@echo off\r\nnode "C:\\x\\mellos-mapping\\dist\\mmap.mjs" %*\r\n')).toBe(true);
    expect(shimIsOurs('@echo off\r\nnode "C:\\tools\\mmap\\index.js" %*\r\n')).toBe(false);
    expect(shimIsOurs('')).toBe(false);
  });
});
