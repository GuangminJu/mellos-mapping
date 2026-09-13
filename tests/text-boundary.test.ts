import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MellosMap } from '../src/domain/types.js';
import { parseMap, serializeMap } from '../src/store/format.js';
import { loadMapFile, saveMapFile } from '../src/store/store.js';
import { renderMap } from '../src/render/render.js';
import { fitWidth, wrapWidth } from '../src/render/width.js';

const parsed = parseMap({ version: 1, title: '中文 👩‍💻',
  layers: [{ id: 'base', name: 'Base', rank: 0 }, { id: 'top', name: 'Top', rank: 1 }],
  groups: [{ id: 'group', label: 'Group', layer: 'base' }], lanes: [{ id: 'lane', label: 'Lane' }],
  nodes: [{ id: 'base-node', label: 'Base node', layer: 'base', status: 'planned', group: 'group', lane: 'lane' },
    { id: 'top-node', label: 'Top node', layer: 'top', status: 'planned' }],
  edges: [{ from: 'top-node', to: 'base-node', label: 'Uses' }],
}, 'fixture');
if (!parsed.ok) throw new Error('Invalid fixture');
const map = parsed.value;
const fields: Array<[string, (value: string) => MellosMap]> = [
  ['title', value => ({ ...map, title: value })],
  ['layer', value => ({ ...map, layers: [{ ...map.layers[0]!, name: value }, map.layers[1]!] })],
  ['group', value => ({ ...map, groups: [{ ...map.groups[0]!, label: value }] })],
  ['lane', value => ({ ...map, lanes: [{ ...map.lanes[0]!, label: value }] })],
  ['node', value => ({ ...map, nodes: [{ ...map.nodes[0]!, label: value }, map.nodes[1]!] })],
  ['evidence', value => ({ ...map, nodes: [{ ...map.nodes[0]!, evidence: value }, map.nodes[1]!] })],
  ['detail', value => ({ ...map, nodes: [{ ...map.nodes[0]!, detail: value }, map.nodes[1]!] })],
  ['edge', value => ({ ...map, edges: [{ ...map.edges[0]!, label: value }] })],
];

describe('text shared by file input, persistence and terminal output', () => {
  it.each(fields)('rejects control characters in %s loaded from JSON', (field, change) => {
    for (let cp = 0; cp <= 0x9f; cp++) {
      if (cp >= 0x20 && cp < 0x7f) continue;
      if (['detail', 'evidence'].includes(field) && (cp === 9 || cp === 10)) continue;
      const raw: unknown = JSON.parse(serializeMap(change(`before${String.fromCharCode(cp)}after`)));
      expect(parseMap(raw, 'map.json').ok, `${field}: U+${cp.toString(16)}`).toBe(false);
    }
  });

  it('preserves multilingual labels and the supported note whitespace', () => {
    const note = { ...map, nodes: [{ ...map.nodes[0]!, detail: '第一行\n\t第二行 👩‍💻', evidence: 'passed\n\tdetails' }, map.nodes[1]!] };
    const result = parseMap(JSON.parse(serializeMap(note)), 'map.json');
    expect(result).toEqual({ ok: true, value: note });
    expect(wrapWidth('first\n\tsecond', 30)).toEqual(['first', '  second']);
  });

  it('rejects an unsafe library save while preserving the last valid file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mellos-text-'));
    try {
      const file = join(directory, 'map.json');
      expect(saveMapFile(file, map).ok).toBe(true);
      const previous = readFileSync(file);
      for (const [, change] of fields) {
        expect(saveMapFile(file, change('\x1b[2J')).ok).toBe(false);
        expect(readFileSync(file).equals(previous)).toBe(true);
      }
      expect(loadMapFile(file)).toEqual({ ok: true, value: map });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('keeps direct library rendering and pane text free of terminal commands', () => {
    const payload = '\x1b]52;c;payload\x07\x9b2J';
    for (const [, change] of fields) {
      const output = renderMap(change(payload), { color: false, unicode: false, spinnerFrame: 0 }).join('\n');
      expect(output).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    }
    expect(fitWidth(payload, 80)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(wrapWidth(payload, 80).join('')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });
});
