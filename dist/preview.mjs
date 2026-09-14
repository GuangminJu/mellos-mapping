#!/usr/bin/env node

// src/preview/cli.ts
import { existsSync as existsSync3, statSync } from "node:fs";
import { join as join4, resolve as resolve2 } from "node:path";
import { pathToFileURL } from "node:url";

// src/domain/types.ts
var ok = (value) => ({ ok: true, value });
var err = (error) => ({ ok: false, error });
var ID_RULE = /^[a-z0-9][a-z0-9-]{0,63}$/;
var ID_RULE_TEXT = "lowercase letters, digits and dashes, starting with a letter or digit, 1-64 chars";
function makeNodeId(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}
function makeLayerId(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}
function makeGroupId(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}
function makeLaneId(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}
function makeNodeKind(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}
function makeSubmapRef(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}
var RANK_MIN = 0;
var RANK_MAX = 99;
var RANK_RULE_TEXT = `an integer in ${RANK_MIN}..${RANK_MAX}, 0 = bottom / most primitive`;
function makeRank(raw) {
  return Number.isInteger(raw) && raw >= RANK_MIN && raw <= RANK_MAX ? ok(raw) : err({ kind: "invalid-rank", raw, rule: RANK_RULE_TEXT });
}
var MAP_KINDS = ["dev", "architecture", "dataflow", "behavior-tree", "sequence"];
function makeMapKind(raw) {
  return MAP_KINDS.includes(raw) ? ok(raw) : err({ kind: "invalid-map-kind", raw });
}
var NODE_STATUSES = ["planned", "in-progress", "done", "regressed"];
function makeNodeStatus(raw) {
  return NODE_STATUSES.includes(raw) ? ok(raw) : err({ kind: "invalid-status", raw });
}
var EMPTY_MAP = { layers: [], groups: [], lanes: [], nodes: [], edges: [] };
function describeMapError(e) {
  switch (e.kind) {
    case "invalid-id":
      return `invalid id "${e.raw}" (rule: ${e.rule})`;
    case "invalid-rank":
      return `invalid rank ${e.raw} (rule: ${e.rule})`;
    case "invalid-status":
      return `invalid status "${e.raw}" (expected: ${NODE_STATUSES.join(" | ")})`;
    case "duplicate-layer":
      return `layer "${e.id}" already exists`;
    case "duplicate-rank":
      return `rank ${e.rank} is already taken by layer "${e.existing}"`;
    case "duplicate-node":
      return `node "${e.id}" already exists`;
    case "unknown-layer":
      return `layer "${e.id}" does not exist`;
    case "unknown-node":
      return `node "${e.id}" does not exist`;
    case "duplicate-edge":
      return `edge ${e.from} -> ${e.to} already exists`;
    case "unknown-edge":
      return `edge ${e.from} -> ${e.to} does not exist`;
    case "self-edge":
      return `node "${e.id}" cannot depend on itself`;
    case "duplicate-group":
      return `group "${e.id}" already exists`;
    case "id-collision":
      return `id "${e.id}" already names a ${e.taken} on this map; nodes and groups share one id namespace (both render as boxes, so one id must mean one box) \u2014 rename "${e.id}"`;
    case "unknown-group":
      return `group "${e.id}" does not exist`;
    case "invalid-map-kind":
      return `invalid map kind "${e.raw}" (expected: ${MAP_KINDS.join(" | ")})`;
    case "duplicate-lane":
      return `lane "${e.id}" already exists`;
    case "unknown-lane":
      return `lane "${e.id}" does not exist`;
    case "group-layer-mismatch":
      return `node "${e.node}" (layer ${e.nodeLayer}) cannot join group "${e.group}" (layer ${e.groupLayer}); groups cluster nodes within one band`;
    case "layer-not-empty":
      return `layer "${e.id}" still holds node "${e.occupant}"; move its nodes to another band (moveNode) or remove them (removeNode) first`;
    case "layer-holds-group":
      return `layer "${e.id}" still holds group "${e.occupant}"; remove its groups (removeGroup) first`;
    case "edge-not-downward":
      return `edge ${e.from} (rank ${e.fromRank}) -> ${e.to} (rank ${e.toRank}) is not strictly downward; ` + (e.fromRank === e.toRank ? `same-band siblings may not depend on each other \u2014 either "${e.to}" is really a lower concept (declare it on a lower band) or "${e.from}" and "${e.to}" are one node (merge them)` : `"${e.from}" would USE "${e.to}" from a lower band \u2014 reverse the edge if "${e.to}" is the user, otherwise move or re-rank so "${e.from}" sits above "${e.to}"`);
  }
}

// src/domain/ops.ts
function findLayer(map, id) {
  return map.layers.find((l) => l.id === id);
}
function findNode(map, id) {
  return map.nodes.find((n) => n.id === id);
}
function findGroup(map, id) {
  return map.groups.find((g) => g.id === id);
}
function checkMembership(map, node, nodeLayer, group) {
  const g = findGroup(map, group);
  if (!g) return { kind: "unknown-group", id: group };
  if (g.layer !== nodeLayer)
    return { kind: "group-layer-mismatch", node, nodeLayer, group, groupLayer: g.layer };
  return void 0;
}
function hasEdge(map, from, to) {
  return map.edges.some((e) => e.from === from && e.to === to);
}
function checkIdSpace(map, id, declaring) {
  const taken = declaring === "node" ? map.groups.some((g) => g.id === id) : map.nodes.some((n) => n.id === id);
  return taken ? { kind: "id-collision", id, taken: declaring === "node" ? "group" : "node" } : void 0;
}
function setTitle(map, title) {
  if (title === null || title === void 0) {
    const { title: _dropped, ...rest } = map;
    return rest;
  }
  return { ...map, title };
}
function setKind(map, kind) {
  return { ...map, kind };
}
function findLane(map, id) {
  return map.lanes.find((l) => l.id === id);
}
function declareLane(map, input) {
  if (findLane(map, input.id)) return err({ kind: "duplicate-lane", id: input.id });
  return ok({ ...map, lanes: [...map.lanes, { id: input.id, label: input.label }] });
}
function declareLayer(map, input) {
  if (findLayer(map, input.id)) return err({ kind: "duplicate-layer", id: input.id });
  const rankHolder = map.layers.find((l) => l.rank === input.rank);
  if (rankHolder) return err({ kind: "duplicate-rank", rank: input.rank, existing: rankHolder.id });
  return ok({ ...map, layers: [...map.layers, { id: input.id, name: input.name, rank: input.rank }] });
}
function declareGroup(map, input) {
  if (findGroup(map, input.id)) return err({ kind: "duplicate-group", id: input.id });
  const collision = checkIdSpace(map, input.id, "group");
  if (collision) return err(collision);
  if (!findLayer(map, input.layer)) return err({ kind: "unknown-layer", id: input.layer });
  return ok({ ...map, groups: [...map.groups, { id: input.id, label: input.label, layer: input.layer }] });
}
function declareNode(map, input) {
  if (findNode(map, input.id)) return err({ kind: "duplicate-node", id: input.id });
  const collision = checkIdSpace(map, input.id, "node");
  if (collision) return err(collision);
  if (!findLayer(map, input.layer)) return err({ kind: "unknown-layer", id: input.layer });
  if (input.group !== void 0) {
    const bad = checkMembership(map, input.id, input.layer, input.group);
    if (bad) return err(bad);
  }
  if (input.lane !== void 0 && !findLane(map, input.lane)) return err({ kind: "unknown-lane", id: input.lane });
  const node = {
    id: input.id,
    label: input.label,
    layer: input.layer,
    status: input.status ?? "planned",
    ...input.evidence !== void 0 ? { evidence: input.evidence } : {},
    ...input.detail !== void 0 ? { detail: input.detail } : {},
    ...input.group !== void 0 ? { group: input.group } : {},
    ...input.kind !== void 0 ? { kind: input.kind } : {},
    ...input.lane !== void 0 ? { lane: input.lane } : {},
    ...input.submap !== void 0 ? { submap: input.submap } : {}
  };
  return ok({ ...map, nodes: [...map.nodes, node] });
}
function linkNodes(map, from, to, label) {
  if (from === to) return err({ kind: "self-edge", id: from });
  const fromNode = findNode(map, from);
  if (!fromNode) return err({ kind: "unknown-node", id: from });
  const toNode = findNode(map, to);
  if (!toNode) return err({ kind: "unknown-node", id: to });
  if (hasEdge(map, from, to)) return err({ kind: "duplicate-edge", from, to });
  const fromRank = findLayer(map, fromNode.layer).rank;
  const toRank = findLayer(map, toNode.layer).rank;
  if (fromRank <= toRank) return err({ kind: "edge-not-downward", from, fromRank, to, toRank });
  return ok({ ...map, edges: [...map.edges, { from, to, ...label !== void 0 ? { label } : {} }] });
}
function resolveOptional(input, current) {
  return input === void 0 ? current : input === null ? void 0 : input;
}
function updateNode(map, input) {
  const node = findNode(map, input.id);
  if (!node) return err({ kind: "unknown-node", id: input.id });
  if (input.group !== void 0 && input.group !== null) {
    const bad = checkMembership(map, node.id, node.layer, input.group);
    if (bad) return err(bad);
  }
  if (input.lane !== void 0 && input.lane !== null && !findLane(map, input.lane)) {
    return err({ kind: "unknown-lane", id: input.lane });
  }
  const {
    group: currentGroup,
    kind: currentKind,
    lane: currentLane,
    submap: currentSubmap,
    evidence: currentEvidence,
    detail: currentDetail,
    ...bare
  } = node;
  const nextGroup = resolveOptional(input.group, currentGroup);
  const nextKind = resolveOptional(input.kind, currentKind);
  const nextLane = resolveOptional(input.lane, currentLane);
  const nextSubmap = resolveOptional(input.submap, currentSubmap);
  const nextEvidence = resolveOptional(input.evidence, currentEvidence);
  const nextDetail = resolveOptional(input.detail, currentDetail);
  const updated = {
    ...bare,
    ...nextEvidence !== void 0 ? { evidence: nextEvidence } : {},
    ...nextDetail !== void 0 ? { detail: nextDetail } : {},
    ...nextGroup !== void 0 ? { group: nextGroup } : {},
    ...nextKind !== void 0 ? { kind: nextKind } : {},
    ...nextLane !== void 0 ? { lane: nextLane } : {},
    ...nextSubmap !== void 0 ? { submap: nextSubmap } : {},
    ...input.status !== void 0 ? { status: input.status } : {},
    ...input.label !== void 0 ? { label: input.label } : {}
  };
  return ok({ ...map, nodes: map.nodes.map((n) => n.id === input.id ? updated : n) });
}

// src/domain/context.ts
function sourceError(raw) {
  if (!Array.isArray(raw) || raw.length > 100) return "sources must be an array of at most 100 file references";
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "source must be an object";
    const s = item;
    if (Object.keys(s).some((k) => k !== "path" && k !== "sha256")) return "unknown source field";
    if (typeof s.path !== "string" || s.path.length > 1024 || !s.path || /[\u0000-\u001f\u007f-\u009f\\:]/.test(s.path) || s.path.startsWith("/") || s.path.split("/").some((p) => !p || p === "." || p === "..")) return "source path must be relative to the project, with forward slashes and no traversal";
    if (s.sha256 !== void 0 && (typeof s.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.sha256))) return "source sha256 must be a lowercase SHA256 hash";
  }
  return void 0;
}
function contextError(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "context must be an object";
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "summary" && key !== "next") return "unknown context field";
    if (typeof value !== "string" || value.length > 2e3 || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value)) return "context fields must be text of at most 2000 characters";
  }
  return void 0;
}

// src/domain/text.ts
var NO_CONTROLS = /^[^\u0000-\u001f\u007f-\u009f]*$/;
var NO_CONTROLS_TEXT = "one line of text; control characters (ESC, newline, tab) are not allowed";
var NO_CONTROLS_BUT_BREAKS = /^[^\u0000-\u0008\u000b-\u001f\u007f-\u009f]*$/;
var NO_CONTROLS_BUT_BREAKS_TEXT = "text with optional newlines (\\n) and tabs; other control characters (ESC, BEL, CR) are not allowed";
function mapTextError(map) {
  if (map.context !== void 0) {
    const error2 = contextError(map.context);
    if (error2) return error2;
  }
  const check = (field, value, multiline = false) => value === void 0 || (multiline ? NO_CONTROLS_BUT_BREAKS : NO_CONTROLS).test(value) ? void 0 : `${field}: ${multiline ? NO_CONTROLS_BUT_BREAKS_TEXT : NO_CONTROLS_TEXT}`;
  let error = check("title", map.title);
  if (error) return error;
  for (const [i, layer] of map.layers.entries()) {
    error = check(`layers[${i}].name`, layer.name);
    if (error) return error;
  }
  for (const name of ["lanes", "groups"]) {
    for (const [i, item] of map[name].entries()) {
      error = check(`${name}[${i}].label`, item.label);
      if (error) return error;
    }
  }
  for (const [i, node] of map.nodes.entries()) {
    if (node.sources !== void 0) {
      const error2 = sourceError(node.sources);
      if (error2) return `nodes[${i}]: ${error2}`;
    }
    for (const name of ["label", "evidence", "detail"]) {
      error = check(`nodes[${i}].${name}`, node[name], name !== "label");
      if (error) return error;
    }
  }
  for (const [i, edge] of map.edges.entries()) {
    error = check(`edges[${i}].label`, edge.label);
    if (error) return error;
  }
  return void 0;
}
function terminalText(text, multiline = false) {
  return text.replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g, "?");
}

// src/store/format.ts
var STATE_FILE_VERSION = 1;
function makePageId(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}
function describeStoreError(e) {
  switch (e.kind) {
    case "not-found":
      return `no map file at ${e.path}`;
    case "malformed-json":
      return `map file ${e.path} is not valid JSON: ${e.detail}`;
    case "bad-shape":
      return `map file ${e.path} has an unexpected shape: ${e.detail}`;
    case "invariant-violation":
      return `map file ${e.path} violates a structural invariant: ${describeMapError(e.violation)}`;
    case "save-failed":
      return `could not write ${e.path}: ${e.detail}`;
    case "delete-failed":
      return `could not delete ${e.path}: ${e.detail}`;
  }
}
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function describeValue(v) {
  if (v === void 0) return "missing";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}
function badShape(path, where, expected, got) {
  return err({ kind: "bad-shape", path, detail: `${where} is ${describeValue(got)}, expected ${expected}` });
}
function arrayField(raw, key, path, presence) {
  const v = raw[key];
  if (Array.isArray(v)) return ok(v);
  if (v === void 0 && presence === "optional") return ok([]);
  return badShape(path, `"${key}"`, "an array", v);
}
function requiredString(rec, key, where, path) {
  const v = rec[key];
  return typeof v === "string" ? ok(v) : badShape(path, `${where}.${key}`, "a string", v);
}
function optionalString(rec, key, where, path) {
  const v = rec[key];
  if (v === void 0) return ok(void 0);
  return typeof v === "string" ? ok(v) : badShape(path, `${where}.${key}`, "a string", v);
}
function parseMap(raw, path) {
  if (!isRecord(raw)) return err({ kind: "bad-shape", path, detail: "root is not an object" });
  if (raw["version"] !== STATE_FILE_VERSION && raw["version"] !== 2) {
    return err({ kind: "bad-shape", path, detail: `version is ${String(raw["version"])}, expected ${STATE_FILE_VERSION} or 2` });
  }
  const layers = arrayField(raw, "layers", path, "required");
  if (!layers.ok) return layers;
  const nodes = arrayField(raw, "nodes", path, "required");
  if (!nodes.ok) return nodes;
  const edges = arrayField(raw, "edges", path, "required");
  if (!edges.ok) return edges;
  const lanes = arrayField(raw, "lanes", path, "optional");
  if (!lanes.ok) return lanes;
  const groups = arrayField(raw, "groups", path, "optional");
  if (!groups.ok) return groups;
  let map = EMPTY_MAP;
  if (raw["context"] !== void 0) {
    const error = contextError(raw["context"]);
    if (error) return err({ kind: "bad-shape", path, detail: error });
    map = { ...map, context: raw["context"] };
  }
  const title = optionalString(raw, "title", "map", path);
  if (!title.ok) return title;
  if (title.value !== void 0) map = setTitle(map, title.value);
  const rawKind = optionalString(raw, "kind", "map", path);
  if (!rawKind.ok) return rawKind;
  if (rawKind.value !== void 0) {
    const kind = makeMapKind(rawKind.value);
    if (!kind.ok) return err({ kind: "invariant-violation", path, violation: kind.error });
    map = setKind(map, kind.value);
  }
  for (const [i, rawLayer] of layers.value.entries()) {
    const where = `layers[${i}]`;
    if (!isRecord(rawLayer)) return badShape(path, where, "an object", rawLayer);
    const rawId = requiredString(rawLayer, "id", where, path);
    if (!rawId.ok) return rawId;
    const id = makeLayerId(rawId.value);
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const name = requiredString(rawLayer, "name", where, path);
    if (!name.ok) return name;
    const rawRank = rawLayer["rank"];
    if (typeof rawRank !== "number") return badShape(path, `${where}.rank`, "a number", rawRank);
    const rank = makeRank(rawRank);
    if (!rank.ok) return err({ kind: "invariant-violation", path, violation: rank.error });
    const next = declareLayer(map, { id: id.value, name: name.value, rank: rank.value });
    if (!next.ok) return err({ kind: "invariant-violation", path, violation: next.error });
    map = next.value;
  }
  for (const [i, rawLane] of lanes.value.entries()) {
    const where = `lanes[${i}]`;
    if (!isRecord(rawLane)) return badShape(path, where, "an object", rawLane);
    const rawId = requiredString(rawLane, "id", where, path);
    if (!rawId.ok) return rawId;
    const id = makeLaneId(rawId.value);
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const label = requiredString(rawLane, "label", where, path);
    if (!label.ok) return label;
    const declared = declareLane(map, { id: id.value, label: label.value });
    if (!declared.ok) return err({ kind: "invariant-violation", path, violation: declared.error });
    map = declared.value;
  }
  for (const [i, rawGroup] of groups.value.entries()) {
    const where = `groups[${i}]`;
    if (!isRecord(rawGroup)) return badShape(path, where, "an object", rawGroup);
    const rawId = requiredString(rawGroup, "id", where, path);
    if (!rawId.ok) return rawId;
    const id = makeGroupId(rawId.value);
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const rawLayer = requiredString(rawGroup, "layer", where, path);
    if (!rawLayer.ok) return rawLayer;
    const layer = makeLayerId(rawLayer.value);
    if (!layer.ok) return err({ kind: "invariant-violation", path, violation: layer.error });
    const label = requiredString(rawGroup, "label", where, path);
    if (!label.ok) return label;
    const declared = declareGroup(map, { id: id.value, label: label.value, layer: layer.value });
    if (!declared.ok) return err({ kind: "invariant-violation", path, violation: declared.error });
    map = declared.value;
  }
  for (const [i, rawNode] of nodes.value.entries()) {
    const where = `nodes[${i}]`;
    if (!isRecord(rawNode)) return badShape(path, where, "an object", rawNode);
    const rawId = requiredString(rawNode, "id", where, path);
    if (!rawId.ok) return rawId;
    const id = makeNodeId(rawId.value);
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const rawLayer = requiredString(rawNode, "layer", where, path);
    if (!rawLayer.ok) return rawLayer;
    const layer = makeLayerId(rawLayer.value);
    if (!layer.ok) return err({ kind: "invariant-violation", path, violation: layer.error });
    const rawStatus = requiredString(rawNode, "status", where, path);
    if (!rawStatus.ok) return rawStatus;
    const status = makeNodeStatus(rawStatus.value);
    if (!status.ok) return err({ kind: "invariant-violation", path, violation: status.error });
    const label = requiredString(rawNode, "label", where, path);
    if (!label.ok) return label;
    const detail = optionalString(rawNode, "detail", where, path);
    if (!detail.ok) return detail;
    const rawGroup = optionalString(rawNode, "group", where, path);
    if (!rawGroup.ok) return rawGroup;
    let group;
    if (rawGroup.value !== void 0) {
      const made = makeGroupId(rawGroup.value);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      group = made.value;
    }
    const rawNodeKind = optionalString(rawNode, "kind", where, path);
    if (!rawNodeKind.ok) return rawNodeKind;
    let nodeKind;
    if (rawNodeKind.value !== void 0) {
      const made = makeNodeKind(rawNodeKind.value);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      nodeKind = made.value;
    }
    const rawLane = optionalString(rawNode, "lane", where, path);
    if (!rawLane.ok) return rawLane;
    let lane;
    if (rawLane.value !== void 0) {
      const made = makeLaneId(rawLane.value);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      lane = made.value;
    }
    const rawSubmap = optionalString(rawNode, "submap", where, path);
    if (!rawSubmap.ok) return rawSubmap;
    let submap;
    if (rawSubmap.value !== void 0) {
      const made = makeSubmapRef(rawSubmap.value);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      submap = made.value;
    }
    const declared = declareNode(map, {
      id: id.value,
      label: label.value,
      layer: layer.value,
      status: status.value,
      ...detail.value !== void 0 ? { detail: detail.value } : {},
      ...group !== void 0 ? { group } : {},
      ...nodeKind !== void 0 ? { kind: nodeKind } : {},
      ...lane !== void 0 ? { lane } : {},
      ...submap !== void 0 ? { submap } : {}
    });
    if (!declared.ok) return err({ kind: "invariant-violation", path, violation: declared.error });
    map = declared.value;
    const evidence = optionalString(rawNode, "evidence", where, path);
    if (!evidence.ok) return evidence;
    if (evidence.value !== void 0) {
      const updated = updateNode(map, { id: id.value, evidence: evidence.value });
      if (!updated.ok) return err({ kind: "invariant-violation", path, violation: updated.error });
      map = updated.value;
    }
    if (rawNode["sources"] !== void 0) {
      const error = sourceError(rawNode["sources"]);
      if (error) return err({ kind: "bad-shape", path, detail: `${where}: ${error}` });
      map = { ...map, nodes: map.nodes.map((n) => n.id === id.value ? { ...n, sources: rawNode["sources"] } : n) };
    }
  }
  for (const [i, rawEdge] of edges.value.entries()) {
    const where = `edges[${i}]`;
    if (!isRecord(rawEdge)) return badShape(path, where, "an object", rawEdge);
    const rawFrom = requiredString(rawEdge, "from", where, path);
    if (!rawFrom.ok) return rawFrom;
    const from = makeNodeId(rawFrom.value);
    if (!from.ok) return err({ kind: "invariant-violation", path, violation: from.error });
    const rawTo = requiredString(rawEdge, "to", where, path);
    if (!rawTo.ok) return rawTo;
    const to = makeNodeId(rawTo.value);
    if (!to.ok) return err({ kind: "invariant-violation", path, violation: to.error });
    const label = optionalString(rawEdge, "label", where, path);
    if (!label.ok) return label;
    const linked = linkNodes(map, from.value, to.value, label.value);
    if (!linked.ok) return err({ kind: "invariant-violation", path, violation: linked.error });
    map = linked.value;
  }
  const textError = mapTextError(map);
  return textError ? err({ kind: "bad-shape", path, detail: textError }) : ok(map);
}

// src/store/atomic.ts
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
var RENAME_MAX_ATTEMPTS = 10;
var RENAME_BACKOFF_STEP_MS = 10;
var TRANSIENT_RENAME_CODES = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES", "ENOENT"]);
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function discardTemp(tmp) {
  try {
    rmSync(tmp, { force: true });
  } catch {
  }
}
function errnoOf(e) {
  return e.code ?? e.message;
}
function writeFileAtomic(path, contents) {
  return writeAtomic(path, contents, RENAME_MAX_ATTEMPTS);
}
function writeAtomic(path, contents, maxAttempts) {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, contents, "utf8");
  } catch (e) {
    discardTemp(tmp);
    return err({ kind: "save-failed", path, detail: `writing the temp file failed: ${errnoOf(e)}` });
  }
  let attempt = 1;
  for (; ; ) {
    try {
      renameSync(tmp, path);
      return ok(void 0);
    } catch (e) {
      const code = errnoOf(e);
      if (!TRANSIENT_RENAME_CODES.has(code) || attempt >= maxAttempts) {
        discardTemp(tmp);
        return err({ kind: "save-failed", path, detail: `${code} after ${attempt} attempt(s)` });
      }
      sleepSync(attempt * RENAME_BACKOFF_STEP_MS);
      attempt += 1;
    }
  }
}

// src/store/pages.ts
import { existsSync, readdirSync, rmSync as rmSync2 } from "node:fs";
import { basename, dirname as dirname2, join } from "node:path";
var STORE_DIR_NAME = ".mellos";
var STATE_FILE_RELATIVE_PATH = join(STORE_DIR_NAME, "map.json");
var PAGES_DIR_NAME = "pages";
function pageIdOfFile(defaultFile, path) {
  if (path === defaultFile) return void 0;
  const name = basename(path);
  return name.endsWith(".json") ? name.slice(0, -".json".length) : name;
}
function listPageFiles(defaultFile) {
  const out = [];
  if (existsSync(defaultFile)) out.push(defaultFile);
  let entries = [];
  try {
    entries = readdirSync(join(dirname2(defaultFile), PAGES_DIR_NAME));
  } catch {
  }
  for (const e of entries.sort()) {
    if (e.endsWith(".json")) out.push(join(dirname2(defaultFile), PAGES_DIR_NAME, e));
  }
  return out;
}

// src/store/json-text.ts
function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}

// src/store/migration.ts
import { dirname as dirname3, join as join2 } from "node:path";
var LEGACY_STATE_FILE_RELATIVE_PATH = join2(".claude", "mellos-mapping.json");

// src/store/maps.ts
import { readFileSync } from "node:fs";
function loadMapFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const code = e.code;
    if (code === "ENOENT") return err({ kind: "not-found", path });
    throw e;
  }
  let raw;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (e) {
    return err({ kind: "malformed-json", path, detail: e.message });
  }
  return parseMap(raw, path);
}

// src/preview/publisher.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync as readdirSync2, realpathSync, rmdirSync } from "node:fs";
import { dirname as dirname4, join as join3, resolve } from "node:path";

// src/semantics/vocabulary.ts
var STATUS_GLYPHS = {
  planned: ["\xB7", "."],
  "in-progress": ["\u283F", "*"],
  done: ["\u25A0", "#"],
  regressed: ["\u2717", "X"]
};
function statusGlyph(status, unicode) {
  const [uni, ascii] = STATUS_GLYPHS[status];
  return unicode ? uni : ascii;
}
var UNVERIFIED_DONE_GLYPHS = ["\u25A1", "o"];
function unverifiedDoneGlyph(unicode) {
  const [uni, ascii] = UNVERIFIED_DONE_GLYPHS;
  return unicode ? uni : ascii;
}
var NODE_KIND_GLYPHS = {
  selector: ["?", "?"],
  sequence: ["\xBB", ">"],
  parallel: ["\u2016", "="],
  decorator: ["\u25CC", "o"],
  condition: ["\u25C7", "c"],
  action: ["\xB7", "."],
  source: ["\u25CB", "o"],
  transform: ["\u25D0", "%"],
  sink: ["\u25CF", "*"],
  service: ["\u25C6", "S"],
  db: ["\u25A4", "D"],
  queue: ["\u2263", "Q"],
  ui: ["\u25A3", "U"]
};
function kindGlyph(kind, unicode) {
  const pair = NODE_KIND_GLYPHS[kind];
  return pair === void 0 ? void 0 : unicode ? pair[0] : pair[1];
}

// src/semantics/semantics.ts
function zoomMode(zoom) {
  if (zoom >= 1) return "detail";
  if (zoom <= -4) return "overview";
  return "boxes";
}
function isNeutralKind(map) {
  return map.kind !== void 0 && map.kind !== "dev";
}
function flipForSequence(map) {
  if (map.kind !== "sequence") return map;
  return {
    ...map,
    // VIOLATION: state-explicit-in-types - `-l.rank as Rank` produces a value
    // the Rank brand promises cannot exist: mirroring 0..99 gives -99..0, and
    // makeRank would refuse every one of them. The alternative is a second
    // ordered-position type (an unbranded `order` field) threaded through the
    // renderer's whole layout stage purely so this one derived map can be
    // typed — a large change to express "these ranks are an order, not a
    // stored value". What makes it safe is the same thing that makes it
    // wrong: this map only ever reaches a renderer, which compares ranks and
    // never writes them (same contract as aggregateMap).
    layers: map.layers.map((l) => ({ ...l, rank: -l.rank })),
    edges: map.edges.map((e) => ({ from: e.to, to: e.from, ...e.label !== void 0 ? { label: e.label } : {} }))
  };
}

// src/preview/presentation.ts
var LABELS = { planned: "\u5F85\u5F00\u53D1", "in-progress": "\u5F00\u53D1\u4E2D", done: "\u5DF2\u9A8C\u8BC1", regressed: "\u51FA\u73B0\u56DE\u5F52" };
function isVerified(node) {
  return node.status === "done" && node.evidence !== void 0;
}
function statusText(node) {
  return node.status === "done" && !isVerified(node) ? `${unverifiedDoneGlyph(true)} \u5B8C\u6210\u4F46\u7F3A\u5C11\u8BC1\u636E` : `${statusGlyph(node.status, true)} ${LABELS[node.status]}`;
}
function documentName(page) {
  return page === void 0 ? "map.md" : `page-${page}.md`;
}

// src/preview/text.ts
function xml(text) {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function markdown(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_[\]{}()#+.!|~-])/g, "\\$1").replace(/\r?\n/g, "  \n");
}
function cell(text) {
  return markdown(text).replace(/  \n/g, "<br>");
}

// src/preview/markdown.ts
function renderMapMarkdown(map, image, pages) {
  const neutral = isNeutralKind(map);
  const rows = [
    `# ${markdown(map.title ?? "\u6885\u52D2\u65AF\u5730\u56FE")}`,
    "",
    "[\u6240\u6709\u5730\u56FE](index.md)",
    "",
    "> \u81EA\u52A8\u751F\u6210\u7684\u5730\u56FE\u9884\u89C8\uFF1B\u4FEE\u6539\u5730\u56FE\u6570\u636E\u540E\u91CD\u65B0\u751F\u6210\u3002",
    ""
  ];
  if (!neutral) {
    const active = map.nodes.filter((n) => n.status === "in-progress");
    rows.push(
      `**\u5F53\u524D\uFF1A** ${active.length ? active.map((n) => markdown(n.label)).join("\u3001") : "\u6682\u65E0\u8FDB\u884C\u4E2D\u7684\u6A21\u5757"}`,
      "",
      `\u5DF2\u9A8C\u8BC1 **${map.nodes.filter(isVerified).length} / ${map.nodes.length}**\u3000\uFF5C\u3000\u56DE\u5F52 **${map.nodes.filter((n) => n.status === "regressed").length}**`,
      ""
    );
  }
  rows.push("## \u5206\u5C42\u4F9D\u8D56", "", `![\u5206\u5C42\u4F9D\u8D56\u5730\u56FE](${image})`, "");
  if (!neutral) rows.push("\xB7 \u5F85\u5F00\u53D1\u3000\u283F \u5F00\u53D1\u4E2D\u3000\u25A0 \u5DF2\u9A8C\u8BC1\u3000\u2717 \u51FA\u73B0\u56DE\u5F52\u3000\u25A1 \u5B8C\u6210\u4F46\u7F3A\u5C11\u8BC1\u636E", "");
  rows.push(map.kind === "sequence" ? "\u65F6\u95F4\u4ECE\u4E0A\u5411\u4E0B\u63A8\u8FDB\uFF1B\u7BAD\u5934\u4FDD\u7559\u5730\u56FE\u4E2D\u7684\u4F9D\u8D56\u65B9\u5411\u3002" : "\u7BAD\u5934\u7531\u4F7F\u7528\u65B9\u6307\u5411\u5B83\u4F9D\u8D56\u7684\u6A21\u5757\uFF1B\u57FA\u7840\u5C42\u4F4D\u4E8E\u4E0B\u65B9\u3002", "", "## \u6A21\u5757\u8BE6\u60C5", "");
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const layers = [...map.layers].sort((a, b) => map.kind === "sequence" ? a.rank - b.rank : b.rank - a.rank);
  for (const layer of layers) {
    rows.push(`### ${markdown(layer.name)}`, "");
    const members = map.nodes.filter((n) => n.layer === layer.id);
    if (!members.length) rows.push("\u5C1A\u672A\u58F0\u660E\u6A21\u5757\u3002", "");
    for (const node of members) {
      rows.push(`#### ${markdown(node.label)}${neutral ? "" : `\u3000${statusText(node)}`}`, "");
      if (node.detail !== void 0) rows.push(markdown(node.detail), "");
      const used = map.edges.filter((e) => e.from === node.id);
      rows.push(`**\u4F9D\u8D56\uFF1A** ${used.length ? used.map((e) => `${markdown(nodes.get(e.to).label)}${e.label !== void 0 ? `\uFF08${markdown(e.label)}\uFF09` : ""}`).join("\u3001") : "\u65E0"}`, "");
      const meta = [
        node.group === void 0 ? void 0 : map.groups.find((g) => g.id === node.group)?.label,
        node.lane === void 0 ? void 0 : map.lanes.find((l) => l.id === node.lane)?.label,
        node.kind
      ].filter((v) => v !== void 0);
      if (meta.length) rows.push(`**\u5F52\u5C5E / \u7C7B\u578B\uFF1A** ${meta.map(markdown).join(" \xB7 ")}`, "");
      if (node.evidence !== void 0) rows.push(`**\u9A8C\u8BC1\u8BB0\u5F55\uFF1A** ${markdown(node.evidence)}`, "");
      if (node.submap !== void 0) rows.push(pages.some((p) => p.page === node.submap) ? `[\u6253\u5F00\u5B50\u56FE\uFF1A${markdown(node.submap)}](${documentName(node.submap)})` : `\u5B50\u56FE\u5C1A\u672A\u521B\u5EFA\uFF1A${markdown(node.submap)}`, "");
    }
  }
  if (!neutral) {
    rows.push("## \u9A8C\u8BC1\u8BB0\u5F55", "", "| \u6A21\u5757 | \u72B6\u6001 | \u6700\u8FD1\u8BC1\u636E |", "| --- | --- | --- |");
    for (const node of map.nodes) rows.push(`| ${cell(node.label)} | ${statusText(node)} | ${node.evidence === void 0 ? "\u5C1A\u672A\u8BB0\u5F55" : cell(node.evidence)} |`);
    rows.push("");
  }
  rows.push("---", "", "\u9759\u6001\u6587\u6863\uFF1A\u66F4\u65B0\u65F6\u91CD\u65B0\u751F\u6210\u5730\u56FE\u56FE\u7247\u4E0E\u6587\u5B57\u3002\u56FE\u4E2D\u8282\u70B9\u4E0D\u652F\u6301\u62D6\u62FD\u3001\u60AC\u505C\u5C55\u5F00\u6216\u52A8\u753B\u3002", "");
  return rows.join("\n");
}
function renderPreviewIndex(pages) {
  return [
    "# \u6885\u52D2\u65AF\u5730\u56FE \xB7 \u9875\u9762\u76EE\u5F55",
    "",
    ...pages.map((p) => `- [${markdown(p.map.title ?? p.page ?? "\u9ED8\u8BA4\u5730\u56FE")}](${documentName(p.page)})`),
    "",
    "\u5730\u56FE\u9884\u89C8\u7531\u9879\u76EE\u5185\u7684\u5730\u56FE\u6570\u636E\u751F\u6210\u3002",
    ""
  ].join("\n");
}

// src/render/zoom-geometry.ts
var BOX_H = 3;
var BOX_GAP = 2;
var LEFT_MARGIN = 2;
var BAR_MIN_RUN = 7;
var DETAIL_BUDGET = { innerMin: 22, innerMax: 32, noteRows: 3 };
var DETAIL_PLUS_BUDGET = { innerMin: 30, innerMax: 48, noteRows: 12 };
function zoomGeometry(zoom) {
  const m = zoomMode(zoom);
  const mode = m === "overview" ? "constellation" : m;
  switch (zoom) {
    case 2:
      return { mode, scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false, detail: DETAIL_PLUS_BUDGET };
    case 1:
      return { mode, scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false, detail: DETAIL_BUDGET };
    case 0:
      return { mode, scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -1:
      return { mode, scale: 0.85, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -2:
      return { mode, scale: 0.7, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: false };
    case -3:
      return { mode, scale: 0.55, pad: 0, boxGap: 1, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
    case -4:
      return { mode, scale: 0, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
  }
}

// src/render/width.ts
var WIDE_RANGES = [
  [4352, 4447],
  // Hangul Jamo
  // Wide symbols scattered through the BMP — mostly emoji that predate the
  // emoji planes (⌚ ⏰ ⚡ ✅ ✨ ❌ ❓ ⭐ ⬛ …).
  [8986, 8987],
  [9001, 9002],
  [9193, 9196],
  [9200, 9200],
  [9203, 9203],
  [9725, 9726],
  [9748, 9749],
  [9800, 9811],
  [9855, 9855],
  [9875, 9875],
  [9889, 9889],
  [9898, 9899],
  [9917, 9918],
  [9924, 9925],
  [9934, 9934],
  [9940, 9940],
  [9962, 9962],
  [9970, 9971],
  [9973, 9973],
  [9978, 9978],
  [9981, 9981],
  [9989, 9989],
  [9994, 9995],
  [10024, 10024],
  [10060, 10060],
  [10062, 10062],
  [10067, 10069],
  [10071, 10071],
  [10133, 10135],
  [10160, 10160],
  [10175, 10175],
  [11035, 11036],
  [11088, 11088],
  [11093, 11093],
  [11904, 42191],
  // CJK radicals .. Yi (covers CJK Unified Ideographs)
  [43360, 43391],
  [44032, 55203],
  // Hangul syllables
  [63744, 64255],
  // CJK compatibility ideographs
  [65040, 65049],
  [65072, 65135],
  [65280, 65376],
  // fullwidth forms
  [65504, 65510],
  [127744, 128591],
  // pictographs, transport, emoticons (🚀 🎯 😀 …)
  [128640, 128767],
  [129280, 129535],
  // supplemental symbols (🤖 🧱 …)
  [129648, 129791],
  // symbols extended-A
  [131072, 262141]
  // CJK extension planes
];
var ZERO_WIDTH_RANGES = [
  [768, 879],
  // combining diacritical marks (decomposed 'e' + ´)
  [6832, 6911],
  [7616, 7679],
  [8203, 8207],
  // zero-width space .. RLM, zero-width joiner among them
  [8400, 8432],
  // combining marks for symbols
  [65024, 65039],
  // variation selectors, VS16 (emoji presentation) included
  [65056, 65071],
  // combining half marks
  [127995, 127999]
  // emoji skin tone modifiers — always applied to a base
];
function inRanges(cp, ranges) {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}
function charWidth(cp) {
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0;
  return inRanges(cp, WIDE_RANGES) ? 2 : 1;
}
function displayWidth(text) {
  let w = 0;
  for (const ch of text) w += charWidth(ch.codePointAt(0));
  return w;
}
function fitWidth(s, width) {
  s = terminalText(s);
  if (displayWidth(s) <= width) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + "\u2026";
}
function wrapWidth(s, width) {
  const lines = [];
  let line = "";
  let w = 0;
  for (const ch of terminalText(s.replace(/\r/g, "").replace(/\t/g, "  "), true)) {
    if (ch === "\n") {
      lines.push(line);
      line = "";
      w = 0;
      continue;
    }
    const cw = displayWidth(ch);
    if (w + cw > width) {
      lines.push(line);
      line = "";
      w = 0;
    }
    line += ch;
    w += cw;
  }
  if (line !== "") lines.push(line);
  return lines;
}

// src/render/layout.ts
var LABEL_BUDGET_MIN = 4;
function boxSpec(node, geo, unicode, neutral) {
  const glyph = node.kind !== void 0 ? kindGlyph(node.kind, unicode) : void 0;
  const badge = node.submap !== void 0 ? unicode ? " \u229E" : " +" : "";
  const badgeW = displayWidth(badge);
  const text = !neutral && glyph !== void 0 ? `${glyph} ${node.label}` : node.label;
  if (geo.mode === "constellation") {
    return { w: 3, h: 1, label: "", pad: 0, borderless: true, extra: [] };
  }
  if (geo.mode === "detail" && geo.detail !== void 0) {
    const budget2 = geo.detail;
    const innerW = Math.min(Math.max(displayWidth(text) + badgeW + 4, budget2.innerMin), budget2.innerMax);
    const extra = [];
    if (node.evidence !== void 0) extra.push({ text: fitWidth(` ${node.evidence}`, innerW), style: "faint" });
    if (node.detail !== void 0) {
      const wrapped = wrapWidth(node.detail, innerW - 2);
      for (let i = 0; i < Math.min(wrapped.length, budget2.noteRows); i++) {
        const cut = i === budget2.noteRows - 1 && wrapped.length > budget2.noteRows;
        extra.push({ text: ` ${cut ? fitWidth(wrapped[i] + "\u2026", innerW - 2) : wrapped[i]}`, style: "none" });
      }
    }
    return {
      w: innerW + 2,
      h: BOX_H + extra.length,
      label: fitWidth(text, innerW - 4 - badgeW) + badge,
      pad: 1,
      borderless: false,
      extra
    };
  }
  const budget = Math.max(LABEL_BUDGET_MIN, Math.ceil(displayWidth(text) * geo.scale));
  const label = fitWidth(text, budget) + badge;
  return {
    w: displayWidth(label) + 4 + 2 * geo.pad,
    h: BOX_H,
    label,
    pad: geo.pad,
    borderless: false,
    extra: []
  };
}
function layoutColumns(map, geo, unicode, neutral) {
  const bands = [...map.layers].sort((a, b) => b.rank - a.rank);
  const bandIndexOf = new Map(bands.map((l, i) => [l.id, i]));
  const sized = /* @__PURE__ */ new Map();
  const bandSized = bands.map(() => []);
  for (const node of map.nodes) {
    const spec = { node, ...boxSpec(node, geo, unicode, neutral) };
    bandSized[bandIndexOf.get(node.layer)].push(spec);
    sized.set(node.id, spec);
  }
  const columnOf = /* @__PURE__ */ new Map();
  const lanes = [];
  if (map.lanes.length === 0) {
    for (const row of bandSized) {
      let x = LEFT_MARGIN;
      for (const spec of row) {
        columnOf.set(spec, x);
        x += spec.w + geo.boxGap;
      }
    }
  } else {
    const laneCount = map.lanes.length;
    const laneGap = geo.boxGap + 2;
    const laneIndexOf = new Map(map.lanes.map((l, i) => [l.id, i]));
    const regions = laneCount + 1;
    const grouped = bandSized.map((row) => {
      const cells = Array.from({ length: regions }, () => []);
      for (const spec of row) {
        const lane = spec.node.lane;
        cells[lane !== void 0 ? laneIndexOf.get(lane) : regions - 1].push(spec);
      }
      return cells;
    });
    const regionW = Array.from({ length: regions }, () => 0);
    for (const cells of grouped) {
      for (let i = 0; i < regions; i++) {
        const rowW = cells[i].reduce((sum, b, k) => sum + b.w + (k > 0 ? geo.boxGap : 0), 0);
        regionW[i] = Math.max(regionW[i], rowW);
      }
    }
    for (let i = 0; i < laneCount; i++) regionW[i] = Math.max(regionW[i], displayWidth(map.lanes[i].label) + 2);
    let x0 = LEFT_MARGIN;
    for (let i = 0; i < regions; i++) {
      lanes.push({ x: x0, w: regionW[i] });
      x0 += regionW[i] + laneGap;
    }
    for (const cells of grouped) {
      for (let i = 0; i < regions; i++) {
        let x = lanes[i].x;
        for (const spec of cells[i]) {
          columnOf.set(spec, x);
          x += spec.w + geo.boxGap;
        }
      }
    }
  }
  const placed = /* @__PURE__ */ new Map();
  for (const [, spec] of sized) placed.set(spec, { ...spec, x: columnOf.get(spec) ?? LEFT_MARGIN });
  const bandBoxes = bandSized.map((row) => row.map((spec) => placed.get(spec)));
  const boxOf = /* @__PURE__ */ new Map();
  for (const node of map.nodes) boxOf.set(node.id, placed.get(sized.get(node.id)));
  const bandLabel = bands.map((l, i) => {
    const row = bandBoxes[i];
    const done = row.filter((b) => b.node.status === "done").length;
    return geo.bandCounts && row.length > 0 && !neutral ? ` ${l.name} ${done}/${row.length}` : ` ${l.name}`;
  });
  let contentWidth = LEFT_MARGIN + BAR_MIN_RUN;
  for (const row of bandBoxes) for (const box of row) contentWidth = Math.max(contentWidth, box.x + box.w);
  for (const lane of lanes) contentWidth = Math.max(contentWidth, lane.x + lane.w);
  return { bands, bandIndexOf, bandBoxes, boxOf, lanes, bandLabel, contentWidth };
}
function layoutRows(columns, geo, gapRowCount, hasTitle, hasLanes) {
  let y = 0;
  if (hasTitle) y += 1 + geo.titleGap;
  let laneHeaderY;
  if (hasLanes) {
    laneHeaderY = y;
    y += 1 + geo.barGap;
  }
  const barY = [];
  const gapTrackStartY = [];
  const bandBoxes = [];
  const placed = /* @__PURE__ */ new Map();
  const gapCount = columns.bands.length - 1;
  for (let b = 0; b < columns.bands.length; b++) {
    barY.push(y);
    y += 1 + geo.barGap;
    const row = columns.bandBoxes[b];
    for (const box of row) placed.set(box, { ...box, y });
    bandBoxes.push(row.map((box) => placed.get(box)));
    y += row.reduce((max, box) => Math.max(max, box.h), geo.mode === "constellation" ? 1 : BOX_H);
    if (b < gapCount) {
      y += geo.breathe;
      gapTrackStartY.push(y);
      y += gapRowCount[b];
      y += geo.breathe;
    }
  }
  const boxOf = /* @__PURE__ */ new Map();
  for (const [id, box] of columns.boxOf) boxOf.set(id, placed.get(box));
  return { boxOf, bandBoxes, barY, gapTrackStartY, laneHeaderY, legendY: y + 1 };
}

// src/render/routing.ts
function routeEdges(map, columns) {
  const { bandIndexOf, bandBoxes, boxOf, contentWidth } = columns;
  const pending = map.edges.map((e) => {
    const from = boxOf.get(e.from);
    const to = boxOf.get(e.to);
    return {
      from,
      to,
      fromBand: bandIndexOf.get(from.node.layer),
      toBand: bandIndexOf.get(to.node.layer)
    };
  });
  const gapVerticals = Array.from(
    { length: Math.max(0, columns.bands.length - 1) },
    () => /* @__PURE__ */ new Map()
  );
  const verticalFree = (gap, x, edge) => {
    const owner = gapVerticals[gap]?.get(x);
    return owner === void 0 || owner === edge;
  };
  const takeVertical = (gap, x, edge) => {
    gapVerticals[gap]?.set(x, edge);
  };
  const claimedColumns = /* @__PURE__ */ new Map();
  const isFree = (box, x) => !(claimedColumns.get(box)?.has(x) ?? false);
  const claim = (box, x) => {
    let set = claimedColumns.get(box);
    if (!set) claimedColumns.set(box, set = /* @__PURE__ */ new Set());
    set.add(x);
    return x;
  };
  for (const r of pending) {
    if (r.toBand - r.fromBand !== 1) continue;
    const lo = Math.max(r.from.x + 1, r.to.x + 1);
    const hi = Math.min(r.from.x + r.from.w - 2, r.to.x + r.to.w - 2);
    if (lo > hi) continue;
    const mid = Math.floor((lo + hi) / 2);
    for (let d = 0; d <= hi - lo && r.straightX === void 0; d++) {
      for (const x of d === 0 ? [mid] : [mid - d, mid + d]) {
        if (x >= lo && x <= hi && isFree(r.from, x) && isFree(r.to, x) && verticalFree(r.fromBand, x, r)) {
          r.straightX = claim(r.to, claim(r.from, x));
          takeVertical(r.fromBand, x, r);
          break;
        }
      }
    }
  }
  const bent = pending.filter((r) => r.straightX === void 0);
  const outgoing = /* @__PURE__ */ new Map();
  const incoming = /* @__PURE__ */ new Map();
  for (const r of bent) {
    outgoing.set(r.from, [...outgoing.get(r.from) ?? [], r]);
    incoming.set(r.to, [...incoming.get(r.to) ?? [], r]);
  }
  const freeSlot = (box, k, n, edge, gap) => {
    const lo = box.x + 1;
    const hi = box.x + box.w - 2;
    const ideal = box.x + Math.min(box.w - 2, Math.max(1, Math.round((k + 1) * (box.w - 1) / (n + 1))));
    for (let d = 0; d <= hi - lo; d++) {
      for (const x of d === 0 ? [ideal] : [ideal - d, ideal + d]) {
        if (x >= lo && x <= hi && isFree(box, x) && verticalFree(gap, x, edge)) {
          takeVertical(gap, x, edge);
          return claim(box, x);
        }
      }
    }
    return ideal;
  };
  for (const r of bent) {
    const outs = outgoing.get(r.from);
    const ins = incoming.get(r.to);
    r.exitX = freeSlot(r.from, outs.indexOf(r), outs.length, r, r.fromBand);
    r.entryX = freeSlot(r.to, ins.indexOf(r), ins.length, r, r.toBand - 1);
  }
  const usedDescent = /* @__PURE__ */ new Set();
  let fallbackCount = 0;
  const blockedByBox = (band, x) => bandBoxes[band].some((b) => x >= b.x && x <= b.x + b.w - 1);
  const descentGapsFree = (r, c) => {
    for (let g = r.fromBand; g <= r.toBand - 1; g++) {
      if (!verticalFree(g, c, r)) return false;
    }
    return true;
  };
  for (const r of bent.filter((e) => e.toBand - e.fromBand > 1)) {
    const ex = r.entryX;
    let chosen;
    for (let d = 0; d <= contentWidth && chosen === void 0; d++) {
      for (const c of d === 0 ? [ex] : [ex - d, ex + d]) {
        if (c < LEFT_MARGIN || c > contentWidth + 1 || usedDescent.has(c)) continue;
        if (!descentGapsFree(r, c)) continue;
        let blocked = false;
        for (let b = r.fromBand + 1; b < r.toBand && !blocked; b++) blocked = blockedByBox(b, c);
        if (!blocked) {
          chosen = c;
          break;
        }
      }
    }
    if (chosen === void 0) chosen = contentWidth + 2 + fallbackCount++ * 2;
    usedDescent.add(chosen);
    for (let g = r.fromBand; g <= r.toBand - 1; g++) takeVertical(g, chosen, r);
    r.descentX = chosen;
  }
  const gapCount = Math.max(0, columns.bands.length - 1);
  const gapSegments = Array.from(
    { length: gapCount },
    () => []
  );
  for (const r of bent) {
    const sx = r.exitX;
    const ex = r.entryX;
    if (r.descentX === void 0) {
      gapSegments[r.toBand - 1].push({
        edge: r,
        kind: "landing",
        segment: { lo: Math.min(sx, ex), hi: Math.max(sx, ex) }
      });
    } else {
      const c = r.descentX;
      gapSegments[r.fromBand].push({ edge: r, kind: "exit", segment: { lo: Math.min(sx, c), hi: Math.max(sx, c) } });
      gapSegments[r.toBand - 1].push({
        edge: r,
        kind: "landing",
        segment: { lo: Math.min(c, ex), hi: Math.max(c, ex) }
      });
    }
  }
  const exitRow = /* @__PURE__ */ new Map();
  const landingRow = /* @__PURE__ */ new Map();
  const gapRowCount = gapSegments.map((entries) => {
    const rowEnds = [];
    for (const e of [...entries].sort((a, b) => a.segment.lo - b.segment.lo)) {
      let row = rowEnds.findIndex((end) => e.segment.lo > end + 1);
      if (row === -1) {
        rowEnds.push(e.segment.hi);
        row = rowEnds.length - 1;
      } else {
        rowEnds[row] = Math.max(rowEnds[row], e.segment.hi);
      }
      (e.kind === "exit" ? exitRow : landingRow).set(e.edge, row);
    }
    return rowEnds.length;
  });
  const edges = pending.map((r) => {
    const common = { from: r.from, to: r.to, fromBand: r.fromBand, toBand: r.toBand };
    if (r.straightX !== void 0) return { ...common, kind: "straight", x: r.straightX };
    if (r.descentX === void 0) {
      return { ...common, kind: "dogleg", exitX: r.exitX, entryX: r.entryX, landingRow: landingRow.get(r) };
    }
    return {
      ...common,
      kind: "thread",
      exitX: r.exitX,
      entryX: r.entryX,
      descentX: r.descentX,
      exitRow: exitRow.get(r),
      landingRow: landingRow.get(r)
    };
  });
  return { edges, gapRowCount, fallbackCount };
}
function edgePolyline(edge, rows) {
  const from = rows.boxOf.get(edge.from.node.id);
  const to = rows.boxOf.get(edge.to.node.id);
  const sy = from.y + from.h - 1;
  const ey = to.y;
  if (edge.kind === "straight") {
    return [
      [edge.x, sy],
      [edge.x, ey]
    ];
  }
  const landingY = rows.gapTrackStartY[edge.toBand - 1] + edge.landingRow;
  if (edge.kind === "dogleg") {
    return [
      [edge.exitX, sy],
      [edge.exitX, landingY],
      [edge.entryX, landingY],
      [edge.entryX, ey]
    ];
  }
  const exitY = rows.gapTrackStartY[edge.fromBand] + edge.exitRow;
  return [
    [edge.exitX, sy],
    [edge.exitX, exitY],
    [edge.descentX, exitY],
    [edge.descentX, landingY],
    [edge.entryX, landingY],
    [edge.entryX, ey]
  ];
}

// src/preview/svg.ts
var X = 8;
var Y = 26;
var TOP = 20;
var PALETTES = {
  planned: ["#f5f7fa", "#98a3b2", "#566477"],
  "in-progress": ["#fff4d9", "#c48c24", "#805910"],
  done: ["#e9f5ee", "#67a883", "#286247"],
  regressed: ["#fdecec", "#cc7575", "#923d3d"],
  unverified: ["#fff6e8", "#b49a77", "#785e3e"],
  neutral: ["#f2f5f9", "#a1adbc", "#364558"]
};
function renderMapSvg(map) {
  const neutral = isNeutralKind(map);
  const originals = new Map(map.nodes.map((n) => [n.id, n]));
  const oriented = flipForSequence(map);
  const shaped = { ...oriented, nodes: oriented.nodes.map((n) => {
    const label = fitWidth(n.label, 32);
    return { ...n, label: label + " ".repeat(Math.max(0, 20 - displayWidth(label))) };
  }) };
  const geo = { ...zoomGeometry(0), boxGap: 6 };
  const columns = layoutColumns(shaped, geo, true, neutral);
  const routing = routeEdges(shaped, columns);
  const rows = layoutRows(columns, geo, routing.gapRowCount, false, map.lanes.length > 0);
  const width = Math.max(440, (columns.contentWidth + 4 + routing.fallbackCount * 2) * X);
  const height = Math.max(100, TOP + rows.legendY * Y);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="map-title map-desc">`,
    `<title id="map-title">${xml(map.title ?? "\u6885\u52D2\u65AF\u5730\u56FE")}</title>`,
    `<desc id="map-desc">${map.nodes.length} \u4E2A\u8282\u70B9\uFF0C${map.edges.length} \u6761\u4F9D\u8D56\u3002\u5B8C\u6574\u8BF4\u660E\u4E0E\u9A8C\u8BC1\u8BB0\u5F55\u5728\u5730\u56FE\u6587\u6863\u4E2D\u3002</desc>`,
    '<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="#8995a5"/></marker></defs>',
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    '<g font-family="Segoe UI, Microsoft YaHei, Noto Sans CJK SC, sans-serif">'
  ];
  if (map.nodes.length === 0) parts.push('<text x="20" y="52" font-size="14" fill="#657286">\u5C1A\u672A\u58F0\u660E\u6A21\u5757\uFF0C\u7B49\u5F85\u5730\u56FE\u66F4\u65B0\u3002</text>');
  columns.bands.forEach((band, i) => {
    const top = TOP + rows.barY[i] * Y;
    const boxes = rows.bandBoxes[i];
    const bottom = boxes.reduce((max, b) => Math.max(max, TOP + (b.y + b.h - 1) * Y), top + 60);
    parts.push(`<rect x="8" y="${top - 10}" width="${width - 16}" height="${bottom - top + 26}" rx="5" fill="#fafbfc"/>`);
    parts.push(`<text x="16" y="${top + 5}" font-size="12" fill="#6a7687">${xml(fitWidth(band.name, Math.floor((width - 40) / X)))}</text>`);
  });
  if (rows.laneHeaderY !== void 0) map.lanes.forEach((lane, i) => {
    const region = columns.lanes[i];
    parts.push(`<text x="${(region.x + region.w / 2) * X}" y="${TOP + rows.laneHeaderY * Y + 5}" text-anchor="middle" font-size="12" fill="#566477">${xml(fitWidth(lane.label, region.w))}</text>`);
  });
  for (const edge of routing.edges) {
    const points = edgePolyline(edge, rows).map(([x, y]) => `${x * X},${TOP + y * Y}`).join(" ");
    parts.push(`<polyline points="${points}" fill="none" stroke="#8995a5" stroke-width="1.4" marker-end="url(#arrow)"/>`);
  }
  for (const box of rows.boxOf.values()) {
    const node = originals.get(box.node.id);
    const palette = neutral ? PALETTES.neutral : node.status === "done" && !isVerified(node) ? PALETTES.unverified : PALETTES[node.status];
    const x = box.x * X, y = TOP + box.y * Y, w = (box.w - 1) * X, h = (box.h - 1) * Y;
    const dash = !neutral && node.status === "planned" ? ' stroke-dasharray="5 4"' : "";
    parts.push(`<g data-node="${xml(node.id)}"><title>${xml(node.label)}${neutral ? "" : ` \xB7 ${xml(statusText(node))}`}</title>`);
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${palette[0]}" stroke="${palette[1]}" stroke-width="1.5"${dash}/>`);
    parts.push(`<text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" font-size="14" fill="${palette[2]}">${xml(box.label.trim())}</text>`);
    const secondary = neutral ? node.kind ?? node.id : statusText(node);
    parts.push(`<text x="${x + w / 2}" y="${y + 40}" text-anchor="middle" font-size="11" fill="${palette[2]}">${xml(fitWidth(secondary, box.w - 4))}</text></g>`);
  }
  parts.push("</g></svg>");
  return parts.join("\n");
}

// src/preview/publisher.ts
var PREVIEW_DIR_NAME = "previews";
var ENABLED = ".enabled";
var PUBLISH_LOCK = ".publish-lock";
function previewDirectory(defaultFile) {
  return join3(dirname4(defaultFile), PREVIEW_DIR_NAME);
}
function previewFile(defaultFile, page) {
  if (page !== void 0 && !ID_RULE.test(page)) throw new Error("Invalid preview page id.");
  return join3(previewDirectory(defaultFile), documentName(page));
}
function save(path, contents) {
  try {
    if (readFileSync2(path, "utf8") === contents) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const result = writeFileAtomic(path, contents);
  if (!result.ok) throw new Error(describeStoreError(result.error));
}
function ownedDirectory(path) {
  mkdirSync2(path, { recursive: true });
  const expected = join3(realpathSync(dirname4(path)), path.slice(dirname4(path).length + 1));
  const actual = realpathSync(path);
  if (process.platform === "win32" ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected) {
    throw new Error(`Preview directory redirects outside its parent: ${path}`);
  }
}
function acquireLock(directory) {
  const path = join3(directory, PUBLISH_LOCK);
  const deadline = Date.now() + 2e3;
  while (true) {
    try {
      mkdirSync2(path);
      return () => rmdirSync(path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Preview export is busy or was interrupted. Retry; if no exporter is running, remove the stale lock directory: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}
function createPreviewPublisher(defaultFile) {
  const directory = previewDirectory(defaultFile);
  const enabledFile = join3(directory, ENABLED);
  const enabled = () => existsSync2(enabledFile);
  const refresh = (page) => {
    try {
      const path = previewFile(defaultFile, page);
      ownedDirectory(directory);
      const release = acquireLock(directory);
      try {
        const pages = [];
        for (const source of listPageFiles(defaultFile)) {
          const slug = pageIdOfFile(defaultFile, source);
          if (slug !== void 0 && !ID_RULE.test(slug)) throw new Error(`Invalid map page filename: ${source}`);
          const loaded = loadMapFile(source);
          if (!loaded.ok) throw new Error(describeStoreError(loaded.error));
          pages.push({ page: slug, map: loaded.value });
        }
        if (page !== void 0 && !pages.some((p) => p.page === page)) return err(`No map page named "${page}".`);
        if (page === void 0 && !pages.some((p) => p.page === void 0)) pages.unshift({ page: void 0, map: EMPTY_MAP });
        const images = join3(directory, "images");
        ownedDirectory(images);
        const present = /* @__PURE__ */ new Set();
        for (const item of pages) {
          const svg = renderMapSvg(item.map);
          const digest = createHash("sha256").update(svg).digest("hex");
          const image = `images/${digest}.svg`;
          save(join3(images, `${digest}.svg`), svg);
          const filename = documentName(item.page);
          save(join3(directory, filename), renderMapMarkdown(item.map, image, pages));
          present.add(filename);
        }
        for (const filename of readdirSync2(directory)) {
          if (/^(map|page-[a-z0-9][a-z0-9-]{0,63})\.md$/.test(filename) && !present.has(filename)) {
            save(join3(directory, filename), "# \u5730\u56FE\u5DF2\u5220\u9664\n\n\u6B64\u9875\u9762\u5DF2\u4E0D\u5728\u9879\u76EE\u5730\u56FE\u4E2D\u3002\n\n[\u8FD4\u56DE\u5730\u56FE\u76EE\u5F55](index.md)\n");
          }
        }
        const index = join3(directory, "index.md");
        save(index, renderPreviewIndex(pages));
        return ok({ path: resolve(path), index: resolve(index), pages: pages.length });
      } finally {
        release();
      }
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  };
  const activate = (page) => {
    const published = refresh(page);
    if (!published.ok) return published;
    try {
      save(enabledFile, "Markdown preview updates are enabled for this project.\n");
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
    return published;
  };
  return { enabled, refresh, activate };
}

// src/preview/cli.ts
function runPreview(args) {
  const usage = "usage: mellos-mapping-preview <project-directory> [--page <slug>]";
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return;
  }
  if (!(args.length === 1 || args.length === 3 && args[1] === "--page") || args[0].startsWith("--")) throw new Error(usage);
  const project = resolve2(args[0]);
  if (!existsSync3(project) || !statSync(project).isDirectory()) throw new Error(`Project directory does not exist: ${project}`);
  const parsed = args[2] === void 0 ? void 0 : makePageId(args[2]);
  if (parsed !== void 0 && !parsed.ok) throw new Error(`Invalid page slug: ${args[2]}`);
  const result = createPreviewPublisher(join4(project, STATE_FILE_RELATIVE_PATH)).activate(parsed?.value);
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify({ surface: "markdown", ...result.value, visibility: "unconfirmed" }));
}
if (process.argv[1] !== void 0 && import.meta.url === pathToFileURL(resolve2(process.argv[1])).href) {
  try {
    runPreview(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
export {
  runPreview
};
