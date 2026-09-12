import { describe, expect, it } from 'vitest';
import { parseMap } from '../store/format.js';
import { renderMapMarkdown } from './markdown.js';
import { renderMapSvg } from './svg.js';

function example(kind = 'dev') {
  const parsed = parseMap({ version: 1, kind, title: '地图 <script> & "示例"',
    layers: [{ id: 'base', name: '基础', rank: 0 }, { id: 'top', name: '组合', rank: 1 }],
    nodes: [
      { id: 'core', label: '核心', layer: 'base', status: 'done', evidence: '校验通过 | <ok>\n第二行' },
      { id: 'unknown', label: '缺少证据', layer: 'base', status: 'done' },
      { id: 'export', label: '导出 [click](javascript:alert(1))', layer: 'top', status: 'in-progress', detail: '<img src=x onerror=alert(1)>', submap: 'child' },
      { id: 'ghost', label: '幽灵', layer: 'top', status: 'planned' },
      { id: 'broken', label: '回归模块', layer: 'base', status: 'regressed', evidence: '失败' },
    ], edges: [{ from: 'export', to: 'core', label: '数据 | 契约' }],
  }, 'fixture');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
}

describe('document and vector views of the same map', () => {
  it('escapes user content, preserves details and distinguishes unverified done', () => {
    const map = example();
    const doc = renderMapMarkdown(map, 'images/map.svg', [{ page: 'child', map }]);
    expect(doc).toContain('已验证 **1 / 5**');
    expect(doc).toContain('□ 完成但缺少证据');
    expect(doc).toContain('数据 \\| 契约');
    expect(doc).toContain('校验通过 \\| &lt;ok&gt;<br>第二行');
    expect(doc).toContain('(page-child.md)');
    expect(doc).not.toContain('<img');
    expect(doc).not.toContain('[click](javascript:');
    const svg = renderMapSvg(map);
    expect(svg).toContain('&lt;script&gt; &amp; &quot;示例&quot;');
    expect(svg).not.toMatch(/<script|<foreignObject|<image|href=/);
    for (const node of map.nodes) expect(svg).toContain(`data-node="${node.id}"`);
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain('完成但缺少证据');
    expect(svg).toBe(renderMapSvg(map));
  });

  it('keeps documentation diagrams neutral and sequence order chronological', () => {
    const map = example('sequence');
    const svg = renderMapSvg(map);
    const doc = renderMapMarkdown(map, 'images/map.svg', []);
    expect(doc).not.toContain('已验证 **');
    expect(doc).not.toContain('## 验证记录');
    expect(doc.indexOf('### 基础')).toBeLessThan(doc.indexOf('### 组合'));
    const y = (id: string): number => Number(new RegExp(`data-node="${id}"[\\s\\S]*?<rect x="[^"]+" y="([^"]+)"`).exec(svg)?.[1]);
    expect(y('core')).toBeLessThan(y('export'));
    expect(svg).not.toContain('出现回归');
    expect(doc).toContain('子图尚未创建：child');
  });

  it('does not invent progress or nodes for a standby map', () => {
    const parsed = parseMap({ version: 1, layers: [], nodes: [], edges: [] }, 'fixture');
    if (!parsed.ok) throw new Error('bad fixture');
    expect(renderMapSvg(parsed.value)).toContain('尚未声明模块');
    expect(renderMapMarkdown(parsed.value, 'empty.svg', [])).toContain('已验证 **0 / 0**');
  });
});
