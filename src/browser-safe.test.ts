/**
 * Gate: the library's browser-safe entry points must stay free of Node
 * builtins, transitively. These are the modules the package exports for
 * browser consumption (a web map panel imports format + semantics + domain,
 * and the shared glyph vocabulary through the semantics entry); a `node:*`
 * import anywhere in their closure would break that consumer at bundle time.
 *
 * ./store is deliberately absent: it is the Node half by contract.
 *
 * ./render is here for a different promise than the others. Nothing
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

const BROWSER_SAFE_ENTRIES = [
  'src/domain/types.ts',
  'src/domain/ops.ts',
  'src/store/format.ts',
  'src/semantics/semantics.ts',
  'src/render/render.ts',
];

/** Static import/export-from specifiers of one TypeScript module. */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/g)) {
    out.push(m[1]!);
  }
  return out;
}

describe('browser-safe library surface', () => {
  it('imports no Node builtins, transitively', () => {
    const root = resolve(import.meta.dirname, '..');
    const visited = new Set<string>();
    const queue = BROWSER_SAFE_ENTRIES.map((e) => resolve(root, e));
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
