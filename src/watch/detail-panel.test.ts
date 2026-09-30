import { describe, expect, it } from 'vitest';
import type { MapNode, MellosMap } from '../domain/types.js';
import { parseMap } from '../store/format.js';
import { displayWidth } from '../render/width.js';
import { nodeDetailLines, nodePanel } from './detail-panel.js';

function sample(changes: Partial<MapNode> = {}): MellosMap {
  const parsed = parseMap({
    version: 1,
    layers: [{ id: 'base', name: 'Base', rank: 0 }, { id: 'middle', name: 'Middle', rank: 1 }, { id: 'top', name: 'Top', rank: 2 }],
    lanes: [{ id: 'client', label: 'Client' }],
    groups: [{ id: 'services', label: 'Services', layer: 'middle' }],
    nodes: [
      { id: 'storage', label: 'Storage', layer: 'base', status: 'done', evidence: 'storage tests pass' },
      { id: 'core', label: 'Core', layer: 'middle', status: 'done', evidence: '9 tests passed', detail: 'Holds the invariants.', group: 'services', ...changes },
      { id: 'cli', label: 'CLI', layer: 'top', status: 'in-progress' },
    ],
    edges: [{ from: 'core', to: 'storage', label: 'records' }, { from: 'cli', to: 'core', label: 'requests' }],
  }, 'detail fixture');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

const textOf = (lines: readonly { text: string }[]): string => lines.map(line => line.text).join('\n');

describe('readable compact details', () => {
  it('preserves the short, wide six-row panel and its status vocabulary', () => {
    expect(nodePanel(sample(), 'core', true, 100, false)).toEqual([
      { text: '■ Core [core] · Middle · done', sgr: '32;1' },
      { text: 'evidence: 9 tests passed', sgr: '90' },
      { text: 'uses →  ■ Storage (records)', sgr: '' },
      { text: 'used by ←  ⠿ CLI (requests)', sgr: '' },
      { text: 'Holds the invariants.', sgr: '' },
      { text: '', sgr: '' },
    ]);
  });

  it('uses spare rows for the complete name before metadata or long evidence', () => {
    const map = sample({ label: 'Readable complete node name', evidence: 'evidence '.repeat(30) });
    const panel = nodePanel(map, 'core', true, 20, false, 7)!;
    expect(panel[0]!.text).toBe('■ Readable complete');
    expect(panel[1]!.text).toContain('node name');
    expect(panel[0]!.sgr).toBe('32;1');
    expect(panel[1]!.sgr).toBe('32;1');
  });

  it('does not shave a full-width name to make room for the metadata continuation mark', () => {
    const panel = nodePanel(sample({ label: 'abcdefghijklmnopqr' }), 'core', true, 20, false)!;
    expect(panel[0]!.text).toBe('■ abcdefghijklmnopqr');
    expect(panel[1]!.sgr).toBe('32;1');
  });

  it('grows evidence and both neighbor directions into available height', () => {
    const map = sample({ evidence: 'First verification line\nSecond verification line\nFinal proof' });
    const cramped = nodePanel(map, 'core', true, 22, false, 6)!;
    const roomy = nodePanel(map, 'core', true, 22, false, 18)!;
    expect(textOf(cramped)).not.toContain('Final proof');
    expect(textOf(roomy)).toContain('Final proof');
    expect(textOf(roomy)).toContain('(records)');
    expect(textOf(roomy)).toContain('(requests)');
    expect(textOf(roomy)).toContain('Holds the invariants.');
  });

  it('marks each clipped section and indicates whole sections hidden by a tiny panel', () => {
    const map = sample({ label: 'A very long descriptive node name', evidence: 'long evidence '.repeat(20), detail: 'design notes '.repeat(20) });
    const panel = nodePanel(map, 'core', true, 15, false, 5)!;
    expect(panel).toHaveLength(5);
    expect(panel.every(line => line.text.endsWith('…'))).toBe(true);
    expect(nodePanel(map, 'core', true, 100, false, 2)![1]!.text.endsWith('…')).toBe(true);
  });

  it('returns exactly the requested rows without exceeding even tiny terminal widths', () => {
    const map = sample({ label: '数据结构 𠮷 Core verification', detail: 'notes '.repeat(30) });
    for (const width of [0, 1, 2, 8, 20, 80]) {
      for (const rows of [0, 1, 2, 6, 9, 30]) {
        const panel = nodePanel(map, 'core', true, width, false, rows)!;
        expect(panel, `width ${width}, rows ${rows}`).toHaveLength(rows);
        expect(panel.every(line => displayWidth(line.text) <= width)).toBe(true);
      }
    }
  });

  it('keeps pinned, missing-note, and unknown-focus behavior', () => {
    const map = sample();
    const withoutNotes = { ...map, nodes: map.nodes.map(({ detail: _detail, ...node }) => node) };
    const lines = nodePanel(withoutNotes, 'core', false, 100, true)!;
    expect(lines[0]!.text).toContain('* pinned');
    expect(lines[4]).toEqual({ text: '(no design notes yet)', sgr: '90' });
    expect(nodePanel(map, 'unknown', true, 80, false)).toBeUndefined();
  });

  it('retains group membership, aggregate neighbors and status coloring', () => {
    const lines = nodePanel(sample(), 'services', true, 100, true)!;
    expect(lines[0]!.text).toBe('■ Services [services] · Middle · done · 1 member(s)  ⊙ pinned');
    expect(lines[0]!.sgr).toBe('32;1');
    expect(lines[1]!.text).toBe('members: ■ Core');
    expect(lines[2]!.text).toBe('uses →  ■ Storage');
    expect(lines[3]!.text).toBe('used by ←  ⠿ CLI');
  });

  it('keeps sequence chronology and neutral header styling', () => {
    const map = sample();
    const sequence: MellosMap = { ...map, kind: 'sequence' };
    const panel = nodePanel(sequence, 'core', true, 100, false)!;
    expect(panel[0]).toEqual({ text: '· Core [core] · Middle', sgr: '1' });
    expect(panel[2]!.text).toBe('after →  ■ Storage (records)');
    expect(panel[3]!.text).toBe('before ←  ⠿ CLI (requests)');
  });
});

describe('complete scrollable details', () => {
  it('shows the full name, id, evidence, neighbors and notes under structured headings', () => {
    const label = '完整原始节点名称 with enough English words to wrap';
    const evidence = 'First proof\nSecond proof at the very end';
    const detail = 'Design rationale and the complete final note';
    const lines = nodeDetailLines(sample({ label, evidence, detail }), 'core', true, 24, true)!;
    const content = textOf(lines);
    const name = lines.filter(line => line.section === 'name').map(line => line.text).join(' ');
    expect(name.replace(/\s/g, '')).toContain(label.replace(/\s/g, ''));
    expect(content).toContain('[core]');
    expect(content).toContain('Evidence / 证据');
    expect(content).toContain('Uses / 依赖 (1)');
    expect(content).toContain('Used by / 被依赖 (1)');
    expect(content).toContain('Notes / 说明');
    expect(lines.filter(line => line.section === 'evidence').map(line => line.text).join(' ')).toContain('the very end');
    expect(lines.filter(line => line.section === 'notes').map(line => line.text).join(' ')).toContain('complete final note');
    expect(content).not.toContain('…');
    expect(lines.every(line => displayWidth(line.text) <= 24)).toBe(true);
  });

  it('preserves one correct target on every wrapped neighbor row and no heading', () => {
    const map = sample();
    const extended = {
      ...map,
      nodes: map.nodes.map(node => node.id === 'storage'
        ? { ...node, label: 'Readable complete storage service neighbor name' } : node),
    };
    const lines = nodeDetailLines(extended, 'core', true, 20)!;
    const links = lines.filter(line => line.targetId === 'storage');
    expect(links.length).toBeGreaterThan(1);
    expect(links.map(line => line.text).join(' ')).toContain('[storage] (records)');
    expect(links.every(line => line.section === 'uses')).toBe(true);
    for (const line of lines) {
      if (line.text === '' || line.sgr === '1') expect(line.targetId).toBeUndefined();
    }
  });

  it('shows group members as links and preserves aggregate neighbor destinations', () => {
    const lines = nodeDetailLines(sample(), 'services', true, 30)!;
    expect(textOf(lines)).toContain('Members / 成员 (1)');
    expect(lines.find(line => line.targetId === 'core')!.section).toBe('members');
    expect(lines.find(line => line.targetId === 'storage')!.section).toBe('uses');
    expect(lines.find(line => line.targetId === 'cli')!.section).toBe('usedBy');
    expect(nodeDetailLines(sample(), 'unknown', true, 80)).toBeUndefined();
  });

  it('uses chronological inspector section names for a sequence page', () => {
    const lines = nodeDetailLines({ ...sample(), kind: 'sequence' }, 'core', true, 80)!;
    expect(textOf(lines)).toContain('After / 之后 (1)');
    expect(textOf(lines)).toContain('Before / 之前 (1)');
    expect(lines[0]!.sgr).toBe('1');
    expect(lines.filter(line => line.section === 'metadata').map(line => line.text).join(' ')).not.toContain('done');
  });
});
