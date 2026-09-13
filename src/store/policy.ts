import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Result, err, ok } from '../domain/types.js';
import { type StoreError } from './format.js';
import { STORE_DIR_NAME } from './pages.js';
import { writeFileAtomic } from './atomic.js';
import { isRecord, stripBom } from './json-text.js';

// ---------------------------------------------------------------------------
// mapping policy — WHEN the assistant should open a map, chosen by the user
// ---------------------------------------------------------------------------
//
// Plugin configuration, not map data: it never enters a MellosMap and the
// ledger never enforces it (the ledger is not a judge). It lives in its own
// file so hand-editing or corrupting it can never touch a map.
//
// TWO SCOPES, one file format:
//
//   user    <home>/.mellos/config.json — the normal one. The question "when
//           should maps open?" is about how somebody works, not about a
//           particular repository, so it is asked ONCE, right after install,
//           and answered for every project they will ever open.
//   project <root>/.mellos/config.json — the override. A project that needs a
//           different answer from its owner's habit says so, and wins.
//
// PROJECT beats USER wherever both are set (effectiveMappingPolicy); neither
// set means nobody has chosen yet, which is the one state that still prompts.
// Both are read and written by the same pair of functions, which take the
// CONFIG FILE PATH — not a map path — precisely so neither scope can grow a
// loader of its own.

/** Name of the file holding a mapping-policy configuration, in either scope. */
export const CONFIG_FILE_NAME = 'config.json';

/** On-disk config format version. Bump only with a documented migration. */
export const CONFIG_FILE_VERSION = 1;

/** The PROJECT-scope configuration file: sibling of the default page. */
export function configFilePath(defaultFile: string): string {
  return join(dirname(defaultFile), CONFIG_FILE_NAME);
}

/**
 * The USER-scope configuration file: the same store directory name, under the
 * user's own base directory.
 *
 * @param userBase - the user's home directory. Always passed in, never read
 *   from the environment down here: a function that reached for os.homedir()
 *   itself would make every spec a gamble on the developer's real
 *   configuration, and one of them would eventually write it. Entry points
 *   resolve the home once and hand it down.
 */
export function userConfigFilePath(userBase: string): string {
  return join(userBase, STORE_DIR_NAME, CONFIG_FILE_NAME);
}

export const MAPPING_POLICIES = ['always', 'complex', 'on-request'] as const;

/** How eagerly maps are opened; 'complex' is the behavior of an unconfigured project. */
export type MappingPolicy = (typeof MAPPING_POLICIES)[number];

export interface InvalidPolicy {
  readonly kind: 'invalid-policy';
  readonly raw: string;
  readonly allowed: readonly string[];
}

export function makeMappingPolicy(raw: string): Result<MappingPolicy, InvalidPolicy> {
  return (MAPPING_POLICIES as readonly string[]).includes(raw)
    ? ok(raw as MappingPolicy)
    : err({ kind: 'invalid-policy', raw, allowed: MAPPING_POLICIES });
}

/** One line of meaning per policy — the wording every surface repeats. */
export function describeMappingPolicy(policy: MappingPolicy): string {
  switch (policy) {
    case 'always':
      return 'map every structured task — workflows, designs, architecture, technical dependencies';
    case 'complex':
      return 'map only medium or complex tasks — several modules, a new subsystem, roughly an hour or more';
    case 'on-request':
      return 'map only when the user explicitly asks';
  }
}

/**
 * The policy recorded in ONE configuration file, or ok(undefined) when nobody
 * has chosen there (missing file or missing key — both mean the same thing).
 * A file that exists but does not parse is an error, never silently ignored.
 *
 * @param path - the configuration file itself: {@link configFilePath} for a
 *   project, {@link userConfigFilePath} for the user. One loader, two scopes.
 */
export function loadMappingPolicy(path: string): Result<MappingPolicy | undefined, StoreError> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ok(undefined);
    throw e; // unexpected I/O fault: fail fast, nothing meaningful to recover here
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (e) {
    return err({ kind: 'malformed-json', path, detail: (e as Error).message });
  }
  if (!isRecord(raw)) return err({ kind: 'bad-shape', path, detail: 'root is not an object' });
  if (raw['version'] !== CONFIG_FILE_VERSION) {
    return err({ kind: 'bad-shape', path, detail: `version is ${String(raw['version'])}, expected ${CONFIG_FILE_VERSION}` });
  }
  const rawPolicy = raw['policy'];
  if (rawPolicy === undefined) return ok(undefined);
  if (typeof rawPolicy !== 'string') return err({ kind: 'bad-shape', path, detail: 'policy is not a string' });
  const policy = makeMappingPolicy(rawPolicy);
  return policy.ok
    ? ok(policy.value)
    : err({ kind: 'bad-shape', path, detail: `policy is "${rawPolicy}", expected one of: ${MAPPING_POLICIES.join(' | ')}` });
}

/**
 * Persist the policy atomically (P2), same write as the map files.
 * @param path - the configuration file to write; see {@link loadMappingPolicy}.
 * @returns ok when the file holds the policy; save-failed leaves the previous
 *   configuration in place.
 */
export function saveMappingPolicy(path: string, policy: MappingPolicy): Result<void, StoreError> {
  const body = JSON.stringify({ version: CONFIG_FILE_VERSION, policy }, null, 2) + '\n';
  return writeFileAtomic(path, body);
}

/** The two places a mapping policy can be recorded, in override order. */
export const POLICY_SCOPES = ['user', 'project'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

/** What both scopes say, and which of them actually governs. */
export interface MappingPolicyScopes {
  readonly project: MappingPolicy | undefined;
  readonly user: MappingPolicy | undefined;
  /** What to act on. undefined = nobody has chosen yet, anywhere. */
  readonly effective: MappingPolicy | undefined;
  /** Where `effective` came from; undefined exactly when `effective` is. */
  readonly source: PolicyScope | undefined;
}

/**
 * Resolve the policy that governs this project: the PROJECT file if it names
 * one, otherwise the USER file, otherwise nothing.
 *
 * Both scopes are reported, not just the winner — a surface that says "always"
 * without saying where it came from cannot tell a user why changing their
 * user-level choice did nothing here.
 *
 * @param projectConfigFile - see {@link configFilePath}.
 * @param userConfigFile - see {@link userConfigFilePath}.
 * @returns err as soon as EITHER file exists and is broken, project first: a
 *   configuration nobody can read is not the same as a configuration nobody
 *   wrote, and silently falling through to the other scope would act on a
 *   choice the user did not make.
 */
export function effectiveMappingPolicy(
  projectConfigFile: string,
  userConfigFile: string,
): Result<MappingPolicyScopes, StoreError> {
  const project = loadMappingPolicy(projectConfigFile);
  if (!project.ok) return project;
  const user = loadMappingPolicy(userConfigFile);
  if (!user.ok) return user;
  const effective = project.value ?? user.value;
  const source: PolicyScope | undefined =
    project.value !== undefined ? 'project' : user.value !== undefined ? 'user' : undefined;
  return ok({ project: project.value, user: user.value, effective, source });
}
