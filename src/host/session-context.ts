/**
 * Layer 4d — the standing paragraph, decided once and spoken by every host
 * that has no SessionStart hook to read.
 *
 * Claude Code reads `hooks/hooks.json` and runs `src/hook/session-start.ts`.
 * The other hosts reach the same moment by different roads — omp through an
 * extension module's `before_agent_start`, pi through an extension module's
 * `before_agent_start` — and none of them may grow its own dialect of the
 * policy: two hosts asking the same two questions of the same store must get
 * the same answer, or "the mapping policy" becomes a per-host opinion. So the
 * two questions live here, once:
 *
 *   1. what policy is in effect for THIS project (project scope over user
 *      scope, the rule `mmap_setup` writes and `mmap_read` reports), and
 *   2. is there a map here at all.
 *
 * What comes out is the paragraph `sessionStartContext()` composes — the exact
 * one the Claude hook prints, from the same module — or `undefined` when the
 * session must be told nothing. The message TYPE is shared too, because a
 * resumed session replays its own history: one namespaced, stable type is how
 * a reader recognizes our paragraph in the transcript later, whichever host
 * put it there.
 *
 * @module
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { hasMap, sessionStartContext } from '../hook/session-start.js';
import {
  STATE_FILE_RELATIVE_PATH,
  configFilePath,
  effectiveMappingPolicy,
  userConfigFilePath,
} from '../store/store.js';

/**
 * The message type every host adapter injects. Namespaced (hosts reserve bare
 * names) and stable across releases: a resumed session replays its own
 * history, so the type is how a reader recognizes our paragraph later.
 */
export const SESSION_CONTEXT_TYPE = 'mellos-mapping.session-context';

/**
 * The paragraph this session must hear, or undefined when it must hear nothing
 * — the decision `sessionStartContext()` makes for Claude Code, on the same two
 * facts: the policy in effect and whether a map exists here. A configuration
 * nobody can read returns undefined: that error belongs to `mmap_setup`, where
 * it is explained, not to every session start.
 * @param projectDir - the session's working directory.
 */
export function sessionParagraph(projectDir: string): string | undefined {
  const stateFile = join(projectDir, STATE_FILE_RELATIVE_PATH);
  const scopes = effectiveMappingPolicy(configFilePath(stateFile), userConfigFilePath(homedir()));
  if (!scopes.ok) return undefined;
  return sessionStartContext({ policy: scopes.value.effective, hasStore: hasMap(stateFile) });
}

/**
 * Whether this project's mapping configuration can be read at all — the
 * difference between "the policy says nothing" and "the policy could not be
 * consulted", which a host adapter must not treat the same way.
 */
export function storeIsReadable(projectDir: string): boolean {
  const stateFile = join(projectDir, STATE_FILE_RELATIVE_PATH);
  return effectiveMappingPolicy(configFilePath(stateFile), userConfigFilePath(homedir())).ok;
}
