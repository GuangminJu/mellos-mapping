/** Draft a whole single-page transaction, then validate its final graph once. */
import type { DeclareInput, RemoveInput, UpdateInput } from './apply.js';
import { type MellosMap, type Result, ok, err } from '../domain/types.js';
import { parseMap, serializeMap, describeStoreError } from '../store/format.js';

export type BatchOperation = { op: 'declare'; data: DeclareInput } | { op: 'update'; data: UpdateInput } | { op: 'remove'; data: RemoveInput };
type Row = Record<string, unknown>;
type Resource = 'nodes' | 'edges' | 'layers' | 'groups' | 'lanes';
type Draft = Record<Resource, Row[]> & { version: number; title?: unknown; kind?: unknown; context?: unknown };
const key = (resource: Resource, row: Row): unknown => resource === 'edges' ? `${String(row.from)}->${String(row.to)}` : row.id;
function patch(row: Row, values: Row): Row {
  const next = { ...row };
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined || field === 'id') continue;
    if (value === null) delete next[field]; else next[field] = value;
  }
  return next;
}
function update(draft: Draft, resource: Resource, locator: unknown, values: Row): void {
  const index = draft[resource].findIndex(r => key(resource, r) === locator);
  if (index < 0) throw new Error(`unknown ${resource}: ${String(locator)}`);
  draft[resource][index] = patch(draft[resource][index]!, values);
}
export function applyBatch(map: MellosMap, operations: readonly BatchOperation[], page?: string): Result<MellosMap, string> {
  if (!operations.length) return err('nothing to change: pass operations');
  const draft = JSON.parse(serializeMap(map)) as Draft;
  draft.groups ??= []; draft.lanes ??= [];
  try {
    for (const [index, operation] of operations.entries()) {
      try {
        const input = operation.data;
        if (operation.op === 'declare') {
          const data = input as DeclareInput;
          for (const resource of ['layers', 'lanes', 'groups', 'nodes', 'edges'] as const) {
            for (const item of data[resource] ?? []) {
              const row = { ...item } as Row;
              if (draft[resource].some(r => key(resource, r) === key(resource, row))) throw new Error(`${resource}: already exists ${String(key(resource, row))}`);
              if (resource === 'nodes') row.status ??= 'planned';
              draft[resource].push(row);
            }
          }
          if (data.title !== undefined) { if (data.title === null) delete draft.title; else draft.title = data.title; }
          if (data.kind !== undefined) draft.kind = data.kind;
          if (data.context !== undefined) draft.context = data.context;
        } else if (operation.op === 'update') {
          const data = input as UpdateInput;
          if (data.title !== undefined) { if (data.title === null) delete draft.title; else draft.title = data.title; }
          if (data.kind !== undefined) draft.kind = data.kind;
          if (data.context !== undefined) { if (data.context === null) delete draft.context; else draft.context = data.context; }
          for (const resource of ['layers', 'groups', 'lanes'] as const) for (const item of data[resource] ?? []) update(draft, resource, item.id, { ...item });
          for (const item of data.updates ?? []) update(draft, 'nodes', item.id, { ...item });
          for (const item of data.edges ?? []) {
            const { from, to, newFrom, newTo, ...fields } = item;
            update(draft, 'edges', `${from}->${to}`, { ...fields, ...(newFrom !== undefined ? { from: newFrom } : {}), ...(newTo !== undefined ? { to: newTo } : {}) });
          }
          if (data.laneOrder !== undefined) {
            if (data.laneOrder.length !== draft.lanes.length || new Set(data.laneOrder).size !== draft.lanes.length || data.laneOrder.some(id => !draft.lanes.some(l => l.id === id))) throw new Error('laneOrder must name every lane exactly once');
            draft.lanes = data.laneOrder.map(id => draft.lanes.find(l => l.id === id)!);
          }
        } else {
          const data = input as RemoveInput;
          for (const resource of ['edges', 'nodes', 'groups', 'lanes', 'layers'] as const) {
            for (const item of data[resource] ?? []) {
              const id = resource === 'edges' ? key('edges', item as unknown as Row) : item;
              if (!draft[resource].some(r => key(resource, r) === id)) throw new Error(`unknown ${resource}: ${String(id)}`);
              draft[resource] = draft[resource].filter(r => key(resource, r) !== id);
              if (resource === 'nodes') draft.edges = draft.edges.filter(e => e.from !== id && e.to !== id);
              if (resource === 'groups' || resource === 'lanes') {
                const field = resource === 'groups' ? 'group' : 'lane';
                draft.nodes = draft.nodes.map(n => n[field] === id ? patch(n, { [field]: null }) : n);
              }
            }
          }
        }
      } catch (error) { throw new Error(`operations[${index}]: ${(error as Error).message}`); }
    }
    if (page !== undefined && draft.nodes.some(n => n.submap === page)) return err('a node cannot dive into its own page');
    const parsed = parseMap(draft, 'transaction');
    return parsed.ok ? ok(parsed.value) : err(describeStoreError(parsed.error));
  } catch (error) { return err((error as Error).message); }
}
