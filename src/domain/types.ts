/**
 * Layer 0 — domain model of a Mellos Map.
 *
 * A Mellos Map is a layered dependency map of a system under construction:
 * horizontal layer bands ordered by rank (rank 0 = bottom = most primitive),
 * nodes living inside exactly one band, and dependency edges that may only
 * point STRICTLY DOWNWARD across bands.
 *
 * Structural invariants owned by this layer (and only these — the map is a
 * ledger, not a judge; it records work honestly and never polices workflow):
 *   I1. Layer ids are unique; layer ranks are unique (bands are totally ordered).
 *   I2. Every node belongs to exactly one existing layer.
 *   I3. Node ids are unique.
 *   I4. An edge `from -> to` means "from USES to" and requires
 *       rank(layer(from)) > rank(layer(to)).
 *       Corollary: the graph is acyclic by construction — every edge strictly
 *       decreases rank, so no cycle detection is ever needed.
 *       Same-layer edges are rejected on purpose: if A needs a sibling B,
 *       either B is really a lower-layer concept or A and B are one node.
 *   I5. Node status is one of the closed vocabulary in NODE_STATUSES.
 *
 * Everything here is immutable data plus pure types. No I/O, no clock, no
 * process state.
 */

/** Result type — expected failures are values, never exceptions. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

/** Ids are branded slugs, never raw strings, so a NodeId cannot leak into a LayerId slot. */
export type NodeId = string & { readonly __brand: 'NodeId' };
export type LayerId = string & { readonly __brand: 'LayerId' };

const ID_RULE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ID_RULE_TEXT = 'lowercase letters, digits and dashes, starting with a letter or digit, 1-64 chars';

export type InvalidId = { readonly kind: 'invalid-id'; readonly raw: string; readonly rule: string };

export function makeNodeId(raw: string): Result<NodeId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as NodeId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

export function makeLayerId(raw: string): Result<LayerId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as LayerId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

/** Closed status vocabulary. Transitions are NOT policed — see module header. */
export const NODE_STATUSES = ['planned', 'in-progress', 'done', 'regressed'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export function makeNodeStatus(raw: string): Result<NodeStatus, { kind: 'invalid-status'; raw: string }> {
  return (NODE_STATUSES as readonly string[]).includes(raw)
    ? ok(raw as NodeStatus)
    : err({ kind: 'invalid-status', raw });
}

/** A horizontal band. rank 0 is the bottom (most primitive) band. */
export interface MapLayer {
  readonly id: LayerId;
  readonly name: string;
  readonly rank: number;
}

/** A unit of work living in exactly one band. */
export interface MapNode {
  readonly id: NodeId;
  readonly label: string;
  readonly layer: LayerId;
  readonly status: NodeStatus;
  /** Verification evidence for `done`, or the observed breakage for `regressed`. */
  readonly evidence?: string;
  /** Design notes: responsibility, contract, key decisions. Free text. */
  readonly detail?: string;
}

/** `from` USES `to`. Must point strictly downward (invariant I4). */
export interface DepEdge {
  readonly from: NodeId;
  readonly to: NodeId;
}

/** The whole map. A plain immutable value — operations return new maps. */
export interface MellosMap {
  readonly title?: string;
  readonly layers: readonly MapLayer[];
  readonly nodes: readonly MapNode[];
  readonly edges: readonly DepEdge[];
}

export const EMPTY_MAP: MellosMap = { layers: [], nodes: [], edges: [] };

/** Every way an operation can be refused, as data. */
export type MapError =
  | InvalidId
  | { readonly kind: 'invalid-status'; readonly raw: string }
  | { readonly kind: 'duplicate-layer'; readonly id: LayerId }
  | { readonly kind: 'duplicate-rank'; readonly rank: number; readonly existing: LayerId }
  | { readonly kind: 'duplicate-node'; readonly id: NodeId }
  | { readonly kind: 'unknown-layer'; readonly id: LayerId }
  | { readonly kind: 'unknown-node'; readonly id: NodeId }
  | { readonly kind: 'duplicate-edge'; readonly from: NodeId; readonly to: NodeId }
  | { readonly kind: 'unknown-edge'; readonly from: NodeId; readonly to: NodeId }
  | { readonly kind: 'self-edge'; readonly id: NodeId }
  | { readonly kind: 'layer-not-empty'; readonly id: LayerId; readonly occupant: NodeId }
  | {
      readonly kind: 'edge-not-downward';
      readonly from: NodeId;
      readonly fromRank: number;
      readonly to: NodeId;
      readonly toRank: number;
    };

/** Human-readable rendering of a MapError, for tool results and logs. */
export function describeMapError(e: MapError): string {
  switch (e.kind) {
    case 'invalid-id':
      return `invalid id "${e.raw}" (rule: ${e.rule})`;
    case 'invalid-status':
      return `invalid status "${e.raw}" (expected: ${NODE_STATUSES.join(' | ')})`;
    case 'duplicate-layer':
      return `layer "${e.id}" already exists`;
    case 'duplicate-rank':
      return `rank ${e.rank} is already taken by layer "${e.existing}"`;
    case 'duplicate-node':
      return `node "${e.id}" already exists`;
    case 'unknown-layer':
      return `layer "${e.id}" does not exist`;
    case 'unknown-node':
      return `node "${e.id}" does not exist`;
    case 'duplicate-edge':
      return `edge ${e.from} -> ${e.to} already exists`;
    case 'unknown-edge':
      return `edge ${e.from} -> ${e.to} does not exist`;
    case 'self-edge':
      return `node "${e.id}" cannot depend on itself`;
    case 'layer-not-empty':
      return `layer "${e.id}" still holds node "${e.occupant}"; move or remove its nodes first`;
    case 'edge-not-downward':
      return (
        `edge ${e.from} (rank ${e.fromRank}) -> ${e.to} (rank ${e.toRank}) is not strictly downward; ` +
        `dependencies may only point to a lower layer`
      );
  }
}
