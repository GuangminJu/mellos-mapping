/** Preview vocabulary; shares status glyphs with every existing map surface. */
import type { MapNode } from '../domain/types.js';
import { statusGlyph, unverifiedDoneGlyph } from '../semantics/semantics.js';

const LABELS = { planned: '待开发', 'in-progress': '开发中', done: '已验证', regressed: '出现回归' } as const;

export function isVerified(node: MapNode): boolean {
  return node.status === 'done' && node.evidence !== undefined;
}

export function statusText(node: MapNode): string {
  return node.status === 'done' && !isVerified(node)
    ? `${unverifiedDoneGlyph(true)} 完成但缺少证据`
    : `${statusGlyph(node.status, true)} ${LABELS[node.status]}`;
}

/** Default and named pages never collide, including a named page called map. */
export function documentName(page: string | undefined): string {
  return page === undefined ? 'map.md' : `page-${page}.md`;
}
