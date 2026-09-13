/** Checksummed release data; independent of host registration. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, join } from 'node:path';
import * as nativePath from 'node:path';
const editions = ['claude', 'chatgpt-app'];
const hash = data => createHash('sha256').update(data).digest('hex');

/** Relative paths across Windows volumes are absolute, never descendants. */
export function containsPath(root, candidate, paths = nativePath) {
  const rel = paths.relative(root, candidate);
  return !paths.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${paths.sep}`);
}

export function checkedPath(root, file) {
  if (isAbsolute(file) || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error(`Invalid release path: ${file}`);
  }
  const path = resolve(root, file);
  const rel = relative(resolve(root), path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path escapes release: ${file}`);
  const boundary = resolve(root);
  for (let cursor = path; ; cursor = dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Redirected installation path: ${cursor}`);
    if (cursor === boundary) break;
  }
  return path;
}
export function validateRelease(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
  if (!editions.includes(manifest.edition) || !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
      !manifest.sha256 || typeof manifest.sha256 !== 'object') throw new Error('Invalid release.json');
  const prefix = manifest.edition === 'chatgpt-app' ? 'plugins/mellos-mapping/' : '';
  for (const required of ['dist/server.mjs', 'dist/watch.mjs', 'skills/mellos-mapping/SKILL.md']) {
    if (!manifest.sha256[prefix + required]) throw new Error(`Release is missing ${required}`);
  }
  for (const [file, expected] of Object.entries(manifest.sha256)) {
    if (hash(readFileSync(checkedPath(root, file))) !== expected) throw new Error(`Release checksum mismatch: ${file}. Download a complete release again.`);
  }
  return manifest;
}
