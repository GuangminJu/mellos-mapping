/** Edition boundaries: shared runtime, independent host instructions and installers. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { CODEX_FILES, packageCodex } from './package-codex.mjs';

export const EDITIONS = ['claude', 'chatgpt-app'];
export const INSTALLER_FILES = ['install.mjs', '.gitattributes', 'scripts/install-release.mjs', 'scripts/host-cli.mjs',
  'scripts/release-files.mjs', 'scripts/release-transaction.mjs', 'scripts/host-installation.mjs',
  'scripts/codex-cli.mjs', 'scripts/codex-register.mjs', 'scripts/verify-runtime.mjs',
  'scripts/verify-release.mjs', 'scripts/verify-web-terminal.mjs', '.github/workflows/edition-ci.yml'];
export const CLAUDE_FILES = [...CODEX_FILES.filter(file => !file.startsWith('.codex-plugin/') &&
  !file.startsWith('scripts/codex-') && file !== 'docs/codex.md'),
  '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.mcp.json',
  'hooks/hooks.json', 'commands/mmap.md', 'dist/hook-session-start.mjs'];

export const digest = data => createHash('sha256').update(data).digest('hex');
export function copyFile(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  // Normalize release text to the LF bytes Git ships; preserve binary docs/assets.
  if (/\.(mjs|[cm]?js|ts|json|md|svg|html|css|ya?ml|toml|txt)$/.test(source) ||
      /(?:^|[\\/])(LICENSE|\.gitattributes|\.gitignore)$/.test(source)) {
    writeFileSync(target, readFileSync(source, 'utf8').replaceAll('\r\n', '\n'));
  } else copyFileSync(source, target);
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function codexCatalog() {
  return { name: 'mellos-mapping-codex', interface: { displayName: 'Mellos Mapping · ChatGPT App' },
    plugins: [{ name: 'mellos-mapping', source: { source: 'local', path: './plugins/mellos-mapping' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] };
}

/** Delete only the generated edition directory, never a redirected ancestor. */
export function resetOutput(root, edition) {
  if (!EDITIONS.includes(edition)) throw new Error(`Unknown edition: ${edition}`);
  root = realpathSync(root);
  const output = resolve(root, 'artifacts', 'release', edition);
  for (const dir of [join(root, 'artifacts'), join(root, 'artifacts/release'), output]) {
    if (existsSync(dir) && realpathSync(dir) !== dir) throw new Error(`Refusing redirected output: ${dir}`);
  }
  if (relative(root, output).split(/[\\/]/).join('/') !== `artifacts/release/${edition}`) throw new Error('Invalid release output');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  return output;
}

export function packageEdition(root, edition) {
  const codex = edition === 'chatgpt-app';
  const runtimeSource = codex ? packageCodex(root) : root;
  const runtimeFiles = codex ? CODEX_FILES : CLAUDE_FILES;
  const prefix = codex ? 'plugins/mellos-mapping/' : '';
  const entries = [
    ...runtimeFiles.map(file => [join(runtimeSource, file), prefix + file]),
    ...INSTALLER_FILES.map(file => [join(root, file), file]),
    [join(root, `docs/distributions/${edition}.md`), 'README.md'],
    [join(root, `docs/distributions/${edition}.zh-CN.md`), 'README.zh-CN.md'],
    [join(root, 'LICENSE'), 'LICENSE'],
  ];
  // Validate all inputs before replacing a prior build.
  for (const [source] of entries) readFileSync(source);
  const output = resetOutput(root, edition);
  for (const [source, target] of entries) copyFile(source, join(output, target));
  if (codex) writeJson(join(output, '.agents/plugins/marketplace.json'), codexCatalog());
  const files = [...new Set(entries.map(([, target]) => target))];
  if (codex) files.push('.agents/plugins/marketplace.json');
  const hashes = Object.fromEntries(files.sort().map(file => [file, digest(readFileSync(join(output, file)))]));
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  writeJson(join(output, 'release.json'), { edition, version, sha256: hashes });
  return output;
}
