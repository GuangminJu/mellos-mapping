// @ts-check
/** Install a prebuilt edition without npm dependencies or developer-local paths. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostRunner, requireSuccess } from './host-cli.mjs';
import { validateRelease } from './release-files.mjs';
import { stageRelease } from './release-transaction.mjs';
import { createHostInstallation } from './host-installation.mjs';
export { checkedPath, validateRelease } from './release-files.mjs';
export { copyRelease } from './release-transaction.mjs';
import { verifyRuntime } from './verify-runtime.mjs';

const editions = ['claude', 'chatgpt-app'];
export const USAGE = 'node install.mjs [claude|chatgpt-app] [--check]';


/** @param {string} source @param {string[]} argv
 * @param {{env?: NodeJS.ProcessEnv, installHome?: string, makeRunner?: typeof hostRunner,
 * verify?: typeof verifyRuntime, log?: (message: string) => void}} [options] */
export async function installRelease(source, argv, {
  env = process.env, installHome = join(homedir(), '.mellos', 'installations'),
  makeRunner = hostRunner, verify = verifyRuntime, log = console.log,
} = {}) {
  if (argv.includes('--help')) { log(USAGE); return; }
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node.js 18+ is required. Install Node.js and retry.');
  const selected = argv.find(arg => editions.includes(arg));
  if (argv.some(arg => !editions.includes(arg) && arg !== '--check') || argv.filter(arg => editions.includes(arg)).length > 1) throw new Error(USAGE);
  if (!existsSync(join(source, 'release.json'))) {
    if (!selected) throw new Error(`Choose the host: ${USAGE}`);
    const { packageEdition } = await import('./release-layout.mjs');
    source = packageEdition(source, selected);
  }
  const manifest = validateRelease(source);
  if (selected && selected !== manifest.edition) throw new Error(`This is the ${manifest.edition} edition. Clone the ${selected} branch instead.`);
  const edition = manifest.edition;
  const codex = edition === 'chatgpt-app';
  const run = makeRunner(edition, env);
  const cliVersion = requireSuccess(run(['--version']), 'Host CLI prerequisite').trim();
  requireSuccess(run(['plugin', codex ? 'add' : 'install', '--help']), 'Host plugin support (update your host CLI if missing)');
  if (codex) requireSuccess(run(['mcp', 'add', '--help']), 'Codex MCP registration support');
  const prefix = codex ? 'plugins/mellos-mapping' : '';
  const scratch = mkdtempSync(join(tmpdir(), 'mellos-install-check-'));
  // Use a new project; never migrate or write the caller's maps during installation.
  const checkEnv = { ...env };
  delete checkEnv.MELLOS_MAPPING_CWD;
  delete checkEnv.CLAUDE_PROJECT_DIR;
  try { await verify(join(source, prefix, 'dist/server.mjs'), scratch, checkEnv); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
  log(`Verified ${edition} ${manifest.version}: ${cliVersion}; all eight MCP tools available.`);
  if (argv.includes('--check')) return { edition, checked: true };
  const target = join(installHome, edition);
  const transaction = stageRelease(source, target, manifest);
  let host;
  let previous;
  let hostChanged = false;
  try {
    // Read ownership and the previous manifest while holding the installation lock.
    previous = existsSync(join(target, 'release.json')) ? validateRelease(target) : undefined;
    if (previous?.version === manifest.version &&
        (Object.keys(previous.sha256).length !== Object.keys(manifest.sha256).length ||
         Object.entries(previous.sha256).some(([file, digest]) => manifest.sha256[file] !== digest))) {
      throw new Error('This version is already installed with different files. Bump the release version before upgrading.');
    }
    host = createHostInstallation(edition, target, run);
    transaction.activate();
    hostChanged = true;
    const runtimeRoot = host.install(manifest);
    const installedScratch = mkdtempSync(join(tmpdir(), 'mellos-installed-check-'));
    try { await verify(join(runtimeRoot, 'dist/server.mjs'), installedScratch, checkEnv); }
    finally { rmSync(installedScratch, { recursive: true, force: true }); }
  } catch (error) {
    transaction.rollback();
    if (hostChanged && previous && host?.previous) {
      try { host.install(previous); }
      catch (restoreError) { throw new AggregateError([error, restoreError], 'Upgrade failed; previous files restored, but host registration could not be verified. Rerun the previous release installer.'); }
    }
    throw error;
  }
  transaction.commit();
  const market = host.market;
  log(`Installed in ${target}. The clone can be moved or deleted; runtime files are retained here.`);
  log('Start a new host conversation to load the skill and tools. Existing conversations keep their previous tools.');
  if (codex) log('Ask: 用梅勒斯地图制定计划，用 web-terminal 自动在当前对话右侧展示。 The browser page starts mmap directly; no manual paste is needed.');
  return { edition, target, market };
}
