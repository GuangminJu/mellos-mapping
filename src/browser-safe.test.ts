/**
 * Gate: the library's browser-safe entry points must stay free of Node
 * builtins, transitively. These are the modules the package exports for
 * browser consumption (a web map panel imports format + semantics + domain,
 * and the shared glyph vocabulary through the semantics entry); a `node:*`
 * import anywhere in their closure would break that consumer at bundle time.
 *
 * The entry list is DERIVED from the package's `exports` map, minus the
 * subpaths that are Node's by contract. A hand-written list is the wrong
 * shape for this gate: the promise is about the PUBLISHED surface, so a new
 * export would have to be remembered here to be covered — and forgetting is
 * silent, the suite staying green while an ungated subpath ships.
 *
 * ./render is covered for a different promise than the others. Nothing
 * browser-side depends on it any more — the vocabulary a browser shares with
 * the pane lives in ./semantics — but the renderer's own header opens with
 * "pure function of (map, options): no I/O, no clock", and a `node:*` import
 * anywhere in its eight modules would be exactly that promise breaking. The
 * gate walks imports transitively, so naming the composition root covers the
 * whole stage pipeline behind it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..');

/**
 * Subpaths this promise does NOT cover, each with the reason it is out. Every
 * other export is gated, whether or not anyone remembered to list it.
 */
const NODE_ONLY_SUBPATHS: Readonly<Record<string, string>> = {
  './store': 'the Node filesystem half by contract — the whole point of the split',
  './server': 'the bundled MCP server entry: a process to spawn, not a module to import',
  './package.json': 'the manifest itself',
};

interface Manifest {
  readonly exports: Record<string, string | { readonly default: string }>;
}

const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Manifest;

/** `./lib/domain/types.js` (what ships) -> `src/domain/types.ts` (what is read). */
function sourceOf(target: string | { readonly default: string }): string {
  const file = typeof target === 'string' ? target : target.default;
  return file.replace(/^\.\/lib\//, 'src/').replace(/\.js$/, '.ts');
}

const BROWSER_SAFE_ENTRIES = Object.entries(manifest.exports)
  .filter(([subpath]) => !(subpath in NODE_ONLY_SUBPATHS))
  .map(([, target]) => sourceOf(target));

/** Static import/export-from specifiers of one TypeScript module. */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/g)) {
    out.push(m[1]!);
  }
  return out;
}

describe('browser-safe library surface', () => {
  it('gates every published export except the ones named as Node-only', () => {
    // Pins the derivation itself: if `exports` grows a subpath, it is gated
    // here or it is in NODE_ONLY_SUBPATHS with a reason — never neither.
    expect([...BROWSER_SAFE_ENTRIES].sort()).toEqual([
      'src/domain/ops.ts',
      'src/domain/types.ts',
      'src/render/render.ts',
      'src/semantics/semantics.ts',
      'src/store/format.ts',
    ]);
  });

  it('imports no Node builtins, transitively', () => {
    const visited = new Set<string>();
    const queue = BROWSER_SAFE_ENTRIES.map((e) => resolve(repoRoot, e));
    const offenders: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      for (const spec of importSpecifiers(source)) {
        if (spec.startsWith('node:')) {
          offenders.push(`${file} imports ${spec}`);
        } else if (spec.startsWith('.')) {
          // TS sources import with a .js extension; follow the .ts sibling.
          queue.push(join(dirname(file), spec.replace(/\.js$/, '.ts')));
        } else {
          // A bare specifier would be a dependency browsers must resolve;
          // the browser-safe closure has none today, so any appearance is a
          // deliberate decision to make here, not silently.
          offenders.push(`${file} imports bare specifier ${spec}`);
        }
      }
    }

    expect(offenders).toEqual([]);
    // The closure really covered the entries plus their shared domain deps.
    expect(visited.size).toBeGreaterThanOrEqual(BROWSER_SAFE_ENTRIES.length);
  });
});
