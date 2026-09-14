import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { z } from 'zod';
import type { MellosMap, MapNode } from '../domain/types.js';
import { loadMapFile } from '../store/maps.js';
import { listPageFiles, pageFilePath, pageIdOfFile } from '../store/pages.js';
import { describeStoreError, type PageId } from '../store/format.js';
import { LedgerError, revisionOf } from '../store/transaction.js';
import { readTool } from './tool-definitions.js';

export type ReadInput = z.infer<ReturnType<typeof readTool>['inputSchema']>;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireMap(file: string): MellosMap {
  const result = loadMapFile(file);
  if (!result.ok) throw new LedgerError(result.error.kind === 'not-found' ? 'NOT_FOUND' : 'INVALID_STORE', describeStoreError(result.error));
  return result.value;
}
function summary(map: MellosMap, page?: string): Record<string, unknown> {
  return { id: page ?? '_default', title: map.title ?? page ?? 'Default map', kind: map.kind ?? 'dev', context: map.context ?? null, revision: revisionOf(map), counts: { nodes: map.nodes.length, edges: map.edges.length, layers: map.layers.length, groups: map.groups.length, lanes: map.lanes.length, ...Object.fromEntries(['planned', 'in-progress', 'done', 'regressed'].map(s => [s, map.nodes.filter(n => n.status === s).length])) } };
}
function related(map: MellosMap, seeds: string[], direction: string, depth: number): Set<string> {
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string): void => { const row = adjacency.get(from) ?? []; row.push(to); adjacency.set(from, row); };
  for (const edge of map.edges) {
    if (direction !== 'consumers') add(edge.from, edge.to);
    if (direction !== 'dependencies') add(edge.to, edge.from);
  }
  const found = new Set(seeds);
  let frontier = seeds;
  for (let step = 0; step < depth; step++) {
    const next = new Set<string>();
    for (const id of frontier) for (const neighbor of adjacency.get(id) ?? []) if (!found.has(neighbor)) next.add(neighbor);
    for (const id of next) found.add(id);
    frontier = [...next];
    if (!frontier.length) break;
  }
  return found;
}
function changes(node: MapNode, project: string, map: MellosMap): Record<string, unknown> {
  const sources = (node.sources ?? []).map(source => {
    try {
      const root = realpathSync(project), target = realpathSync(resolve(root, source.path));
      const rel = relative(root, target);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) return { ...source, state: 'outside-project' };
      const stat = statSync(target);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return { ...source, state: 'unreadable' };
      const currentSha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
      return { ...source, currentSha256, state: source.sha256 === undefined ? 'unverified' : source.sha256 === currentSha256 ? 'unchanged' : 'changed' };
    } catch (e) { return { ...source, state: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' }; }
  });
  const changed = sources.some(s => s.state === 'changed' || s.state === 'missing');
  const affected = changed ? [...related(map, [node.id], 'consumers', map.nodes.length)].filter(id => id !== node.id) : [];
  return { id: node.id, label: node.label, state: changed ? 'changed' : sources.length && sources.every(s => s.state === 'unchanged') ? 'unchanged' : 'unknown', sources, affectedConsumers: affected.slice(0, 100), affectedConsumersTruncated: affected.length > 100 };
}

export function readMaps(stateFile: string, input: ReadInput): Record<string, unknown> {
  const resource = input.resource ?? 'pages';
  const project = dirname(dirname(stateFile));
  let records: Record<string, unknown>[];
  let revision: string;
  let map: MellosMap | undefined;
  if (resource === 'pages') {
    records = listPageFiles(stateFile).map(file => {
      const page = pageIdOfFile(stateFile, file);
      try { return summary(requireMap(file), page); }
      catch (error) { return { id: page ?? '_default', error: (error as Error).message }; }
    });
    revision = hash(records);
  } else {
    map = requireMap(pageFilePath(stateFile, input.page as PageId | undefined));
    revision = revisionOf(map);
    if (resource === 'map') records = [summary(map, input.page)];
    else if (resource === 'neighborhood') {
      const seeds = input.id !== undefined ? [input.id] : input.ids ?? [];
      if (!seeds.length) throw new LedgerError('INVALID_QUERY', 'neighborhood requires id or ids');
      const missing = seeds.filter(id => !map!.nodes.some(n => n.id === id));
      if (missing.length) throw new LedgerError('NOT_FOUND', 'Unknown neighborhood roots', { ids: missing });
      const selected = related(map, seeds, input.direction ?? 'both', input.depth ?? 1);
      records = map.nodes.filter(n => selected.has(n.id)).map(n => ({ ...n }));
    } else if (resource === 'changes') records = map.nodes.map(n => ({ ...n }));
    else records = map[resource].map(row => ({ ...row, ...(resource === 'edges' ? { id: `${'from' in row ? row.from : ''}->${'to' in row ? row.to : ''}` } : {}) }));
  }
  if (resource !== 'neighborhood') {
    if (input.id !== undefined) {
      records = records.filter(r => r.id === input.id);
      if (!records.length) throw new LedgerError('NOT_FOUND', `No ${resource} record with ID ${input.id}`);
    }
    if (input.ids !== undefined) records = records.filter(r => input.ids!.includes(String(r.id)));
  }
  for (const field of ['status', 'layer', 'group', 'lane'] as const) if (input[field] !== undefined) records = records.filter(r => r[field] === input[field]);
  if (input.query) { const query = input.query.toLowerCase(); records = records.filter(r => JSON.stringify(r).toLowerCase().includes(query)); }
  const { cursor: _cursor, ifRevision: _ifRevision, ...query } = input;
  const queryHash = hash(query);
  let offset = 0;
  if (input.cursor !== undefined) {
    let cursor: { revision: string; query: string; offset: number };
    try { cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as typeof cursor; }
    catch { throw new LedgerError('INVALID_CURSOR', 'Malformed cursor'); }
    if (!cursor || cursor.query !== queryHash || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new LedgerError('INVALID_CURSOR', 'Cursor does not belong to this query');
    if (cursor.revision !== revision) throw new LedgerError('CONFLICT', 'Map changed during pagination; restart this query.', { actualRevision: revision });
    offset = cursor.offset;
  }
  if (input.ifRevision === revision && resource !== 'changes') return { resource, project, page: input.page ?? null, revision, notModified: true };
  const limit = input.limit ?? 30, total = records.length;
  records = records.slice(offset, offset + limit);
  if (resource === 'changes') records = records.map(r => changes(r as unknown as MapNode, project, map!));
  // IDs and edge endpoints are always available even with field projection.
  records = records.map(r => {
    const fields = input.fields ?? (resource === 'nodes' || resource === 'neighborhood' ? ['id', 'label', 'layer', 'status', 'group', 'lane', 'kind', 'submap'] : Object.keys(r));
    return Object.fromEntries([...new Set(['id', ...('from' in r ? ['from', 'to'] : []), ...fields])].filter(f => f in r).map(f => [f, r[f]]));
  });
  return { resource, project, page: input.page ?? null, revision, total, items: records, nextCursor: offset + limit < total ? Buffer.from(JSON.stringify({ revision, query: queryHash, offset: offset + limit })).toString('base64url') : null };
}
