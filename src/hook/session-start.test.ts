/**
 * Spec for the SessionStart hook (./session-start.ts).
 *
 * The composition is a pure function of four values, so this states the whole
 * contract: what the assistant is told under each policy, and — the promise
 * that is easiest to break and hardest to notice — when it is told nothing.
 */

import { describe, expect, it } from 'vitest';

import type { MappingPolicy } from '../store/store.js';
import { type SessionContextInput, hookOutput, parseHookInput, sessionStartContext } from './session-start.js';

const base: SessionContextInput = {
  policy: 'always',
  hasStore: true,
  projectDir: 'C:\\proj',
  pluginRoot: 'C:\\plugin',
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
    expect(text.indexOf('mmap_declare')).toBeLessThan(text.indexOf('open-pane.mjs'));
    expect(text).toContain('done WITH EVIDENCE');
  });

  it('says the recorded policy IS the consent, so the pane is not negotiated', () => {
    expect(ctx()).toContain('WITHOUT asking');
    expect(ctx()).toContain('standing consent');
  });

  it('gives the launcher command with real paths, not a placeholder to expand', () => {
    expect(ctx()).toContain('node "C:\\plugin\\scripts\\open-pane.mjs" "C:\\proj" --page <slug>');
    expect(ctx()).not.toContain('CLAUDE_PLUGIN_ROOT');
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

  it('still opens the pane without asking, and still names the launcher', () => {
    expect(ctx()).toContain('WITHOUT asking');
    expect(ctx()).toContain('open-pane.mjs');
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
