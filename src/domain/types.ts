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
 *   I1. Layer ids are unique; layer ranks are unique (bands are totally
 *       ordered). A rank is a Rank — a branded integer in a closed range, so
 *       "unique" and "strictly lower" are decidable; see makeRank.
 *   I2. Every node belongs to exactly one existing layer.
 *   I3. Node ids are unique.
 *   I4. An edge `from -> to` means "from USES to" and requires
 *       rank(layer(from)) > rank(layer(to)).
 *       Corollary: the graph is acyclic by construction — every edge strictly
 *       decreases rank, so no cycle detection is ever needed.
 *       Same-layer edges are rejected on purpose: if A needs a sibling B,
 *       either B is really a lower-layer concept or A and B are one node.
 *   I5. Node status is one of the closed vocabulary in NODE_STATUSES.
 *   I6. Group ids are unique; every group lives in an existing layer.
 *   I7. A node's group, when set, exists and lives in the node's own layer —
 *       a group is band-local cohesion (a labeled subsystem the far zoom can
 *       render); structure ACROSS bands is what layers and edges express.
 *   I8. Lane ids are unique. A lane is a named vertical column CROSSING all
 *       bands (a sequence participant, a swim lane); lane declaration order
 *       is left-to-right render order.
 *   I9. A node's lane, when set, exists.
 *  I10. Node ids and group ids share ONE namespace: an id names a node or a
 *       group, never both. I3 and I6 are per-set and a group is a BOX in
 *       every view that shows one — the far zoom replaces its members with
 *       it, and a detail panel resolves a hovered id against groups first.
 *       Two boxes under one id therefore make the second unreachable and
 *       the aggregated view ambiguous, which is a structural fault and not
 *       a rendering accident, so it is refused where ids are declared.
 *
 * The map kind (dev | architecture | dataflow | behavior-tree | sequence) is
 * presentation intent, not structure: every kind shares the same invariants,
 * and the renderer alone decides what the kind changes (legend, neutral
 * status skins, lane emphasis).
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
export type GroupId = string & { readonly __brand: 'GroupId' };
export type LaneId = string & { readonly __brand: 'LaneId' };
/** Open per-node vocabulary (selector, action, db …); known kinds get a glyph in the renderer. */
export type NodeKind = string & { readonly __brand: 'NodeKind' };
/**
 * Wiki-style link from a node to a child map's page. No existence invariant
 * on purpose: declaring the reference before the page is legal — the pane
 * simply has nowhere to dive until the page appears.
 */
export type SubmapRef = string & { readonly __brand: 'SubmapRef' };

/** The shared slug grammar for every id in the system (nodes, layers, groups, lanes, kinds, store pages). */
export const ID_RULE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ID_RULE_TEXT = 'lowercase letters, digits and dashes, starting with a letter or digit, 1-64 chars';

export type InvalidId = { readonly kind: 'invalid-id'; readonly raw: string; readonly rule: string };

export function makeNodeId(raw: string): Result<NodeId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as NodeId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

export function makeLayerId(raw: string): Result<LayerId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as LayerId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

export function makeGroupId(raw: string): Result<GroupId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as GroupId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

export function makeLaneId(raw: string): Result<LaneId, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as LaneId) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

export function makeNodeKind(raw: string): Result<NodeKind, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as NodeKind) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

export function makeSubmapRef(raw: string): Result<SubmapRef, InvalidId> {
  return ID_RULE.test(raw) ? ok(raw as SubmapRef) : err({ kind: 'invalid-id', raw, rule: ID_RULE_TEXT });
}

/**
 * A band's position on the vertical order — a branded integer, never a raw
 * number. The brand is what makes I1 and I4 hold: `===` dedupe (I1) and
 * `fromRank > toRank` (I4) are both silently false for NaN, so a NaN rank
 * would admit same-band and reciprocal edges and lose acyclicity. The closed
 * range is the same one every surface (tool schema, file format) states, so
 * a rank the domain accepts always survives a save/reload round trip.
 */
export type Rank = number & { readonly __brand: 'Rank' };

/** Bottom band — "primitives are the ground". */
export const RANK_MIN = 0;
/** Highest band. A map deeper than a hundred bands is a different problem. */
export const RANK_MAX = 99;
export const RANK_RULE_TEXT = `an integer in ${RANK_MIN}..${RANK_MAX}, 0 = bottom / most primitive`;

export type InvalidRank = { readonly kind: 'invalid-rank'; readonly raw: number; readonly rule: string };

/**
 * The only way to obtain a Rank.
 * @param raw - a candidate rank; NaN, Infinity, fractions and out-of-range
 *   integers are refused.
 * @returns the branded rank, or the refusal as a value.
 */
export function makeRank(raw: number): Result<Rank, InvalidRank> {
  return Number.isInteger(raw) && raw >= RANK_MIN && raw <= RANK_MAX
    ? ok(raw as Rank)
    : err({ kind: 'invalid-rank', raw, rule: RANK_RULE_TEXT });
}

/**
 * Closed vocabulary of map kinds — the diagram's presentation intent.
 * 'dev' (the default) is the progress ledger; the rest are documentation
 * diagrams rendered with neutral skins. Structure is identical for all.
 */
export const MAP_KINDS = ['dev', 'architecture', 'dataflow', 'behavior-tree', 'sequence'] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export function makeMapKind(raw: string): Result<MapKind, { kind: 'invalid-map-kind'; raw: string }> {
  return (MAP_KINDS as readonly string[]).includes(raw) ? ok(raw as MapKind) : err({ kind: 'invalid-map-kind', raw });
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
  readonly rank: Rank;
}

/**
 * A labeled cluster of same-band nodes — a subsystem. The far zoom renders
 * groups instead of members, so the overview keeps meaningful names. A
 * group's status is always DERIVED from its members (see groupStatus),
 * never stored.
 */
export interface MapGroup {
  readonly id: GroupId;
  readonly label: string;
  readonly layer: LayerId;
}

/**
 * A named vertical column crossing all bands (I8) — a sequence participant
 * or an architecture swim lane. Declaration order is left-to-right.
 */
export interface MapLane {
  readonly id: LaneId;
  readonly label: string;
}

/** A unit of work living in exactly one band. */
export type { SourceRef, MapContext } from './context.js';
export interface MapNode {
  readonly sources?: readonly import('./context.js').SourceRef[];
  readonly id: NodeId;
  readonly label: string;
  readonly layer: LayerId;
  readonly status: NodeStatus;
  /** Verification evidence for `done`, or the observed breakage for `regressed`. */
  readonly evidence?: string;
  /** Design notes: responsibility, contract, key decisions. Free text. */
  readonly detail?: string;
  /** Membership in a same-band group (I7), for the aggregated far zoom. */
  readonly group?: GroupId;
  /** Per-node kind (selector, action, db …); known kinds render as a glyph prefix. */
  readonly kind?: NodeKind;
  /** Column membership (I9), for laned kinds such as sequence. */
  readonly lane?: LaneId;
  /** Child map page: the pane badges the node ⊞ and double-click dives in. */
  readonly submap?: SubmapRef;
}

/** `from` USES `to`. Must point strictly downward (invariant I4). */
export interface DepEdge {
  readonly from: NodeId;
  readonly to: NodeId;
  /** What flows along the edge: a protocol, a message, a data name. */
  readonly label?: string;
}

/** The whole map. A plain immutable value — operations return new maps. */
export interface MellosMap {
  readonly context?: import('./context.js').MapContext;
  readonly title?: string;
  /** Presentation intent; absent means 'dev' (the progress ledger). */
  readonly kind?: MapKind;
  readonly layers: readonly MapLayer[];
  readonly groups: readonly MapGroup[];
  readonly lanes: readonly MapLane[];
  readonly nodes: readonly MapNode[];
  readonly edges: readonly DepEdge[];
}

export const EMPTY_MAP: MellosMap = { layers: [], groups: [], lanes: [], nodes: [], edges: [] };

/** Every way an operation can be refused, as data. */
export type MapError =
  | InvalidId
  | InvalidRank
  | { readonly kind: 'invalid-status'; readonly raw: string }
  | { readonly kind: 'duplicate-layer'; readonly id: LayerId }
  | { readonly kind: 'duplicate-rank'; readonly rank: Rank; readonly existing: LayerId }
  | { readonly kind: 'duplicate-node'; readonly id: NodeId }
  | { readonly kind: 'unknown-layer'; readonly id: LayerId }
  | { readonly kind: 'unknown-node'; readonly id: NodeId }
  | { readonly kind: 'duplicate-edge'; readonly from: NodeId; readonly to: NodeId }
  | { readonly kind: 'unknown-edge'; readonly from: NodeId; readonly to: NodeId }
  | { readonly kind: 'self-edge'; readonly id: NodeId }
  | { readonly kind: 'duplicate-group'; readonly id: GroupId }
  | { readonly kind: 'id-collision'; readonly id: NodeId | GroupId; readonly taken: 'node' | 'group' }
  | { readonly kind: 'unknown-group'; readonly id: GroupId }
  | { readonly kind: 'invalid-map-kind'; readonly raw: string }
  | { readonly kind: 'duplicate-lane'; readonly id: LaneId }
  | { readonly kind: 'unknown-lane'; readonly id: LaneId }
  | {
      readonly kind: 'group-layer-mismatch';
      readonly node: NodeId;
      readonly nodeLayer: LayerId;
      readonly group: GroupId;
      readonly groupLayer: LayerId;
    }
  | { readonly kind: 'layer-not-empty'; readonly id: LayerId; readonly occupant: NodeId }
  | { readonly kind: 'layer-holds-group'; readonly id: LayerId; readonly occupant: GroupId }
  | {
      readonly kind: 'edge-not-downward';
      readonly from: NodeId;
      readonly fromRank: Rank;
      readonly to: NodeId;
      readonly toRank: Rank;
    };

/** Human-readable rendering of a MapError, for tool results and logs. */
export function describeMapError(e: MapError): string {
  switch (e.kind) {
    case 'invalid-id':
      return `invalid id "${e.raw}" (rule: ${e.rule})`;
    case 'invalid-rank':
      return `invalid rank ${e.raw} (rule: ${e.rule})`;
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
    case 'duplicate-group':
      return `group "${e.id}" already exists`;
    case 'id-collision':
      return (
        `id "${e.id}" already names a ${e.taken} on this map; nodes and groups share one id namespace ` +
        `(both render as boxes, so one id must mean one box) — rename "${e.id}"`
      );
    case 'unknown-group':
      return `group "${e.id}" does not exist`;
    case 'invalid-map-kind':
      return `invalid map kind "${e.raw}" (expected: ${MAP_KINDS.join(' | ')})`;
    case 'duplicate-lane':
      return `lane "${e.id}" already exists`;
    case 'unknown-lane':
      return `lane "${e.id}" does not exist`;
    case 'group-layer-mismatch':
      return (
        `node "${e.node}" (layer ${e.nodeLayer}) cannot join group "${e.group}" (layer ${e.groupLayer}); ` +
        `groups cluster nodes within one band`
      );
    case 'layer-not-empty':
      return (
        `layer "${e.id}" still holds node "${e.occupant}"; move its nodes to another band (moveNode) ` +
        `or remove them (removeNode) first`
      );
    case 'layer-holds-group':
      return `layer "${e.id}" still holds group "${e.occupant}"; remove its groups (removeGroup) first`;
    case 'edge-not-downward':
      // The fault is one invariant (I4) but the remedy is not: a same-band
      // edge is a modeling error the caller fixes by restructuring, an
      // upward edge is usually a reversed arrow. The refusal is the moment
      // the caller needs the remedy, so it is spelled out here, not only in
      // the skill text they read before the batch was composed.
      return (
        `edge ${e.from} (rank ${e.fromRank}) -> ${e.to} (rank ${e.toRank}) is not strictly downward; ` +
        (e.fromRank === e.toRank
          ? `same-band siblings may not depend on each other — either "${e.to}" is really a lower concept ` +
            `(declare it on a lower band) or "${e.from}" and "${e.to}" are one node (merge them)`
          : `"${e.from}" would USE "${e.to}" from a lower band — reverse the edge if "${e.to}" is the user, ` +
            `otherwise move or re-rank so "${e.from}" sits above "${e.to}"`)
      );
  }
}
