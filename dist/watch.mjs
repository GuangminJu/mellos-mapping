#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/watch/watch.ts
import { realpathSync, statSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
      return `edge ${e.from} (rank ${e.fromRank}) -> ${e.to} (rank ${e.toRank}) is not strictly downward; dependencies may only point to a lower layer`;
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
function aggregateStatus(nodes) {
  if (nodes.some((n) => n.status === "regressed")) return "regressed";
  if (nodes.some((n) => n.status === "in-progress")) return "in-progress";
  if (nodes.length > 0 && nodes.every((n) => n.status === "done")) return "done";
  return "planned";
}
function groupStatus(map, id) {
  return aggregateStatus(map.nodes.filter((n) => n.group === id));
}
function mapStatus(map) {
  return aggregateStatus(map.nodes);
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
var SPINNER_FRAMES = {
  unicode: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"],
  ascii: ["|", "/", "-", "\\"]
};
function spinnerGlyph(frame, unicode) {
  const frames = SPINNER_FRAMES[unicode ? "unicode" : "ascii"];
  return frames[(frame % frames.length + frames.length) % frames.length];
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
var ZOOM_MIN = -4;
var ZOOM_MAX = 2;
var ZOOM_DEFAULT = 0;
function clampZoom(n) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n)));
}
function zoomMode(zoom) {
  if (zoom >= 1) return "detail";
  if (zoom <= -4) return "overview";
  return "boxes";
}
function zoomLabel(zoom) {
  switch (zoom) {
    case 2:
      return "detail+";
    case 1:
      return "detail";
    case 0:
      return "100%";
    case -1:
      return "85%";
    case -2:
      return "70%";
    case -3:
      return "55%";
    case -4:
      return "overview";
  }
}
function isNeutralKind(map) {
  return map.kind !== void 0 && map.kind !== "dev";
}
function aggregateMap(map) {
  if (map.groups.length === 0) return void 0;
  const representative = /* @__PURE__ */ new Map();
  for (const n of map.nodes) representative.set(n.id, n.group ?? n.id);
  const nodes = map.groups.map((g) => {
    const members = map.nodes.filter((n) => n.group === g.id);
    const done = members.filter((n) => n.status === "done").length;
    return {
      id: g.id,
      // neutral kinds document structure, not progress — no member counts
      label: isNeutralKind(map) ? g.label : `${g.label} ${done}/${members.length}`,
      layer: g.layer,
      status: groupStatus(map, g.id)
    };
  });
  for (const n of map.nodes) if (n.group === void 0) nodes.push(n);
  const seen = /* @__PURE__ */ new Set();
  const edges = [];
  for (const e of map.edges) {
    const from = representative.get(e.from);
    const to = representative.get(e.to);
    if (from === to || seen.has(`${from}->${to}`)) continue;
    seen.add(`${from}->${to}`);
    edges.push({ from, to });
  }
  return {
    ...map.title !== void 0 ? { title: map.title } : {},
    ...map.kind !== void 0 ? { kind: map.kind } : {},
    layers: map.layers,
    groups: [],
    lanes: map.lanes,
    nodes,
    edges
  };
}
function focusInfo(map, focusId) {
  const layerNameOf = (layerId) => map.layers.find((l) => l.id === layerId)?.name ?? layerId;
  const group = map.groups.find((g) => g.id === focusId);
  if (group) {
    const members = map.nodes.filter((n) => n.group === group.id);
    const memberIds = new Set(members.map((n) => n.id));
    const rep = (id) => {
      const n = map.nodes.find((x) => x.id === id);
      const owner = n.group !== void 0 ? map.groups.find((g) => g.id === n.group) : void 0;
      return owner !== void 0 ? { id: owner.id, label: owner.label, status: groupStatus(map, owner.id) } : { id: n.id, label: n.label, status: n.status };
    };
    const dedupe = (refs) => {
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      for (const r of refs) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
      return out;
    };
    return {
      kind: "group",
      group,
      status: groupStatus(map, group.id),
      layerName: layerNameOf(group.layer),
      members,
      uses: dedupe(
        map.edges.filter((e) => memberIds.has(e.from) && !memberIds.has(e.to)).map((e) => rep(e.to))
      ),
      usedBy: dedupe(
        map.edges.filter((e) => memberIds.has(e.to) && !memberIds.has(e.from)).map((e) => rep(e.from))
      )
    };
  }
  const node = map.nodes.find((n) => n.id === focusId);
  if (!node) return void 0;
  const ref = (id, edgeLabel) => {
    const n = map.nodes.find((x) => x.id === id);
    return {
      id,
      label: n?.label ?? id,
      status: n?.status ?? "planned",
      ...edgeLabel !== void 0 ? { edgeLabel } : {}
    };
  };
  const laneLabel = node.lane !== void 0 ? map.lanes.find((l) => l.id === node.lane)?.label : void 0;
  return {
    kind: "node",
    node,
    layerName: layerNameOf(node.layer),
    ...laneLabel !== void 0 ? { laneLabel } : {},
    uses: map.edges.filter((e) => e.from === node.id).map((e) => ref(e.to, e.label)),
    usedBy: map.edges.filter((e) => e.to === node.id).map((e) => ref(e.from, e.label))
  };
}
function interiorPages(pages) {
  const dives = /* @__PURE__ */ new Map();
  const divedIntoBy = /* @__PURE__ */ new Map();
  for (const [slug, map] of pages) {
    const targets = /* @__PURE__ */ new Set();
    for (const n of map?.nodes ?? []) {
      const target = n.submap;
      if (target === void 0 || target === slug) continue;
      targets.add(target);
      const sources = divedIntoBy.get(target) ?? /* @__PURE__ */ new Set();
      sources.add(slug);
      divedIntoBy.set(target, sources);
    }
    if (slug !== void 0) dives.set(slug, targets);
  }
  const reachableFrom = (start) => {
    const seen = /* @__PURE__ */ new Set();
    const pending = [start];
    while (pending.length > 0) {
      for (const target of dives.get(pending.pop()) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        pending.push(target);
      }
    }
    return seen;
  };
  const interior = /* @__PURE__ */ new Set();
  for (const [target, sources] of divedIntoBy) {
    const outward = reachableFrom(target);
    for (const source of sources) {
      if (source === void 0 || !outward.has(source)) {
        interior.add(target);
        break;
      }
    }
  }
  return interior;
}
function diveParent(entries, pageId) {
  for (const [key, m] of entries) {
    const node = m?.nodes.find((n) => n.submap === pageId);
    if (node !== void 0) return { parent: key, label: node.label };
  }
  return void 0;
}
function mostRecentKey(keys, mtimeOf2) {
  let best;
  let bestMtime = -Infinity;
  for (const key of keys) {
    const mtime = mtimeOf2(key);
    if (mtime !== void 0 && mtime > bestMtime) {
      best = key;
      bestMtime = mtime;
    }
  }
  return best ?? keys[0];
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
  for (const ch of s.replace(/\r/g, "")) {
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

// src/render/canvas.ts
var SGR = {
  none: "",
  dim: "2",
  amber: "33",
  green: "32",
  greenDim: "32;2",
  // done, but nothing behind the claim: green, not fully lit
  red: "31",
  faint: "90"
};
var ANSI_RESET = "\x1B[0m";
var UP = 1;
var DOWN = 2;
var LEFT = 4;
var RIGHT = 8;
var LIGHT_BY_MASK = {
  [UP]: "\u2502",
  [DOWN]: "\u2502",
  [LEFT]: "\u2500",
  [RIGHT]: "\u2500",
  [UP | DOWN]: "\u2502",
  [LEFT | RIGHT]: "\u2500",
  [DOWN | RIGHT]: "\u250C",
  [DOWN | LEFT]: "\u2510",
  [UP | RIGHT]: "\u2514",
  [UP | LEFT]: "\u2518",
  [UP | DOWN | RIGHT]: "\u251C",
  [UP | DOWN | LEFT]: "\u2524",
  [DOWN | LEFT | RIGHT]: "\u252C",
  [UP | LEFT | RIGHT]: "\u2534",
  [UP | DOWN | LEFT | RIGHT]: "\u253C"
};
function maskChar(mask, heavyHorizontal, unicode) {
  if (!unicode) {
    const hasV = (mask & (UP | DOWN)) !== 0;
    const hasH = (mask & (LEFT | RIGHT)) !== 0;
    if (hasV && hasH) return "+";
    return hasV ? "|" : "-";
  }
  if (heavyHorizontal) {
    if (mask === (LEFT | RIGHT)) return "\u2501";
    if (mask === (UP | DOWN | LEFT | RIGHT)) return "\u253F";
  }
  return LIGHT_BY_MASK[mask] ?? "\u253C";
}
var BORDER_JUNCTION = {
  "\u2500": { down: "\u252C", up: "\u2534" },
  "\u254C": { down: "\u252C", up: "\u2534" },
  "\u2501": { down: "\u252F", up: "\u2537" },
  "-": { down: "+", up: "+" },
  ".": { down: "+", up: "+" }
};
var Canvas = class {
  rows = [];
  cell(x, y) {
    while (this.rows.length <= y) this.rows.push([]);
    const row = this.rows[y];
    while (row.length <= x) row.push({ mask: 0, heavyHorizontal: false, bright: false, style: "none", bold: false });
    return row[x];
  }
  get height() {
    return this.rows.length;
  }
  get width() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }
  /** Write literal text starting at (x, y). Returns the column just past it. */
  text(x, y, s, style, bold = false) {
    let cx = x;
    for (const ch of s) {
      const w = charWidth(ch.codePointAt(0));
      if (w === 0) {
        const base = this.cell(Math.max(0, cx - 1), y);
        const target = base.literal === "" ? this.cell(Math.max(0, cx - 2), y) : base;
        target.literal = (target.literal ?? "") + ch;
        continue;
      }
      const c = this.cell(cx, y);
      c.literal = ch;
      c.style = style;
      c.bold = bold;
      if (w === 2) {
        const phantom = this.cell(cx + 1, y);
        phantom.literal = "";
        phantom.style = style;
      }
      cx += w;
    }
    return cx;
  }
  /** Merge a routed-line direction mask into (x, y). */
  line(x, y, mask, heavyHorizontal = false, bright = false) {
    const c = this.cell(x, y);
    if (c.literal !== void 0) {
      const junction = BORDER_JUNCTION[c.literal];
      const replacement = mask & DOWN ? junction?.down : mask & UP ? junction?.up : void 0;
      if (replacement !== void 0) c.literal = replacement;
      return;
    }
    c.mask |= mask;
    c.heavyHorizontal = c.heavyHorizontal || heavyHorizontal;
    c.bright = c.bright || bright;
  }
  /**
   * Emit terminal lines, optionally windowed to a viewport. Slicing happens
   * at the cell level so ANSI codes reopen correctly inside the window and a
   * CJK character cut in half at either edge degrades to a space instead of
   * shifting the whole row. Routed wiring (mask cells) emits FAINT — the
   * circuit board recedes, the boxes glow.
   */
  emit(opts, viewport) {
    const vp = viewport ?? { x: 0, y: 0, width: this.width, height: this.height };
    const out = [];
    for (let y = vp.y; y < vp.y + vp.height; y++) {
      const row = this.rows[y] ?? [];
      let line = "";
      let open = "";
      const end = Math.min(vp.x + vp.width, row.length);
      for (let x = Math.max(0, vp.x); x < end; x++) {
        const c = row[x];
        const isWire = c.literal === void 0 && c.mask !== 0;
        let ch = c.literal !== void 0 ? c.literal : isWire ? maskChar(c.mask, c.heavyHorizontal, opts.unicode) : " ";
        if (ch === "") {
          if (x !== Math.max(0, vp.x)) continue;
          ch = " ";
        } else if (charWidth(ch.codePointAt(0)) === 2 && x + 1 >= vp.x + vp.width) {
          ch = " ";
        }
        const params = ch === " " ? "" : isWire ? c.bright ? "1" : SGR.faint : [SGR[c.style], c.bold ? "1" : ""].filter(Boolean).join(";");
        if (opts.color && params !== open) {
          line += (open !== "" ? ANSI_RESET : "") + (params !== "" ? `\x1B[${params}m` : "");
          open = params;
        }
        line += ch;
      }
      if (opts.color && open !== "") line += ANSI_RESET;
      out.push(line.replace(/ +$/, ""));
    }
    return out;
  }
};
function drawPath(canvas, points, bright = false) {
  for (let i = 0; i + 1 < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (x1 === x2 && y1 === y2) continue;
    if (x1 === x2) {
      const [lo, hi] = y1 < y2 ? [y1, y2] : [y2, y1];
      for (let yy = lo + 1; yy < hi; yy++) canvas.line(x1, yy, UP | DOWN, false, bright);
      canvas.line(x1, y1, y2 > y1 ? DOWN : UP, false, bright);
      canvas.line(x1, y2, y2 > y1 ? UP : DOWN, false, bright);
    } else {
      const [lo, hi] = x1 < x2 ? [x1, x2] : [x2, x1];
      for (let xx = lo + 1; xx < hi; xx++) canvas.line(xx, y1, LEFT | RIGHT, false, bright);
      canvas.line(x1, y1, x2 > x1 ? RIGHT : LEFT, false, bright);
      canvas.line(x2, y1, x2 > x1 ? LEFT : RIGHT, false, bright);
    }
  }
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
var AGGREGATE_GEO = {
  mode: "boxes",
  scale: 1,
  pad: 0,
  boxGap: 1,
  breathe: 0,
  titleGap: 0,
  barGap: 1,
  bandCounts: false
};

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

// src/render/skins.ts
function styleFor(face) {
  switch (face) {
    case "planned":
      return "dim";
    case "in-progress":
      return "amber";
    case "done":
      return "green";
    case "done-unverified":
      return "greenDim";
    case "regressed":
      return "red";
  }
}
function statusSgr(status) {
  return SGR[styleFor(status)];
}
function skinFor(face, unicode) {
  const style = styleFor(face);
  if (!unicode) {
    return face === "planned" ? { h: ".", v: ":", corners: ["+", "+", "+", "+"], style } : { h: "-", v: "|", corners: ["+", "+", "+", "+"], style };
  }
  switch (face) {
    case "planned":
      return { h: "\u254C", v: "\u254E", corners: ["\u256D", "\u256E", "\u2570", "\u256F"], style };
    case "in-progress":
      return { h: "\u2500", v: "\u2502", corners: ["\u256D", "\u256E", "\u2570", "\u256F"], style };
    // an unverified done keeps the heavy border of done — it is the same
    // claim, told with a hollow glyph and a dimmer green
    case "done":
    case "done-unverified":
    case "regressed":
      return { h: "\u2501", v: "\u2503", corners: ["\u250F", "\u2513", "\u2517", "\u251B"], style };
  }
}
function glyphFor(face, opts) {
  if (face === "in-progress") return spinnerGlyph(opts.spinnerFrame, opts.unicode);
  return face === "done-unverified" ? unverifiedDoneGlyph(opts.unicode) : statusGlyph(face, opts.unicode);
}
function neutralSkin(unicode) {
  return unicode ? { h: "\u2500", v: "\u2502", corners: ["\u256D", "\u256E", "\u2570", "\u256F"], style: "none" } : { h: "-", v: "|", corners: ["+", "+", "+", "+"], style: "none" };
}
function neutralGlyph(node, unicode) {
  return (node.kind !== void 0 ? kindGlyph(node.kind, unicode) : void 0) ?? (unicode ? "\xB7" : ".");
}
function unverifiedDoneIds(declared, drawn) {
  const out = /* @__PURE__ */ new Set();
  const declaredById = new Map(declared.nodes.map((n) => [n.id, n]));
  for (const node of drawn.nodes) {
    if (node.status !== "done") continue;
    const own = declaredById.get(node.id);
    if (own !== void 0) {
      if (own.evidence === void 0) out.add(node.id);
    } else if (declared.nodes.some(
      (m) => m.group === node.id && m.status === "done" && m.evidence === void 0
    )) {
      out.add(node.id);
    }
  }
  return out;
}

// src/render/draw.ts
function drawTitle(canvas, title) {
  canvas.text(LEFT_MARGIN, 0, title, "none", true);
}
function drawLaneHeaders(canvas, map, columns, rows) {
  if (rows.laneHeaderY === void 0) return;
  for (let i = 0; i < map.lanes.length; i++) {
    const region = columns.lanes[i];
    const label = fitWidth(map.lanes[i].label, region.w);
    const cx = region.x + Math.max(0, Math.floor((region.w - displayWidth(label)) / 2));
    canvas.text(cx, rows.laneHeaderY, label, "faint", true);
  }
}
function drawBands(canvas, columns, rows, wiredWidth, totalWidth) {
  for (let b = 0; b < columns.bands.length; b++) {
    const label = columns.bandLabel[b];
    for (let x = 0; x < wiredWidth; x++) canvas.line(x, rows.barY[b], LEFT | RIGHT, true);
    canvas.text(totalWidth - displayWidth(label), rows.barY[b], label, "none", true);
  }
}
function drawBox(canvas, box, opts, neutral, face, focused = false) {
  const { node, x, y, w } = box;
  const skin = neutral ? neutralSkin(opts.unicode) : skinFor(face, opts.unicode);
  const slotGlyph = neutral ? neutralGlyph(node, opts.unicode) : glyphFor(face, opts);
  if (box.borderless) {
    canvas.text(x + 1, y, slotGlyph, skin.style, true);
    return;
  }
  const inner = w - 2;
  const pad = box.pad === 1 ? " " : "";
  canvas.text(x, y, skin.corners[0] + skin.h.repeat(inner) + skin.corners[1], skin.style, focused);
  canvas.text(x, y + 1, skin.v, skin.style, focused);
  canvas.text(x + 1, y + 1, `${pad}${slotGlyph} ${box.label}${pad}`, skin.style, true);
  canvas.text(x + w - 1, y + 1, skin.v, skin.style, focused);
  for (let i = 0; i < box.extra.length; i++) {
    const row = box.extra[i];
    const yy = y + 2 + i;
    canvas.text(x, yy, skin.v, skin.style, focused);
    canvas.text(x + 1, yy, row.text, row.style);
    canvas.text(x + w - 1, yy, skin.v, skin.style, focused);
  }
  canvas.text(x, y + box.h - 1, skin.corners[2] + skin.h.repeat(inner) + skin.corners[3], skin.style, focused);
}
function drawEdges(canvas, edges, rows, opts) {
  for (const edge of edges) {
    const bright = opts.focus !== void 0 && (edge.from.node.id === opts.focus || edge.to.node.id === opts.focus);
    drawPath(canvas, edgePolyline(edge, rows), bright);
  }
}
function drawLegend(canvas, map, opts, legendY, neutral, anyUnverified) {
  let lx = LEFT_MARGIN;
  if (neutral) {
    lx = canvas.text(lx, legendY, map.kind, "faint");
    const seen = /* @__PURE__ */ new Set();
    for (const n of map.nodes) {
      const k = n.kind;
      if (k === void 0 || seen.has(k) || kindGlyph(k, opts.unicode) === void 0) continue;
      seen.add(k);
      lx = canvas.text(lx, legendY, "   ", "none");
      lx = canvas.text(lx, legendY, `${kindGlyph(k, opts.unicode)} ${k}`, "none");
    }
    return;
  }
  const legendOpts = { ...opts, spinnerFrame: 0 };
  const faces = ["planned", "in-progress", "done", "regressed"];
  if (anyUnverified) faces.push("done-unverified");
  for (const face of faces) {
    if (lx > LEFT_MARGIN) lx = canvas.text(lx, legendY, "   ", "none");
    const word = face === "done-unverified" ? "done, no evidence" : face;
    lx = canvas.text(lx, legendY, `${glyphFor(face, legendOpts)} ${word}`, styleFor(face));
  }
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

// src/render/render.ts
function renderMapWindow(map, opts, viewport) {
  const built = buildCanvas(map, opts);
  return {
    lines: built.canvas.emit(opts, viewport),
    contentWidth: built.canvas.width,
    contentHeight: built.canvas.height,
    hits: built.hits
  };
}
function buildCanvas(map, opts) {
  const oriented = flipForSequence(map);
  const plainGeo = zoomGeometry(opts.zoom ?? ZOOM_DEFAULT);
  const aggregated = plainGeo.mode === "constellation" ? aggregateMap(oriented) : void 0;
  const drawn = aggregated ?? oriented;
  return paint(drawn, opts, aggregated !== void 0 ? AGGREGATE_GEO : plainGeo, unverifiedDoneIds(oriented, drawn));
}
function paint(map, opts, geo, unverified) {
  const canvas = new Canvas();
  if (map.layers.length === 0) {
    canvas.text(0, 0, map.title ?? "mellos mapping", "none", true);
    canvas.text(0, 2, "(empty map \u2014 declare layers and nodes to begin)", "dim");
    return { canvas, hits: [] };
  }
  const neutral = isNeutralKind(map);
  const columns = layoutColumns(map, geo, opts.unicode, neutral);
  const routing = routeEdges(map, columns);
  const rows = layoutRows(columns, geo, routing.gapRowCount, map.title !== void 0, map.lanes.length > 0);
  const wiredWidth = routing.fallbackCount > 0 ? columns.contentWidth + 2 + routing.fallbackCount * 2 : columns.contentWidth;
  const totalWidth = wiredWidth + Math.max(...columns.bandLabel.map(displayWidth));
  if (map.title !== void 0) drawTitle(canvas, map.title);
  drawLaneHeaders(canvas, map, columns, rows);
  drawBands(canvas, columns, rows, wiredWidth, totalWidth);
  const faceOf = (id, status) => unverified.has(id) ? "done-unverified" : status;
  for (const box of rows.boxOf.values()) {
    const id = box.node.id;
    drawBox(canvas, box, opts, neutral, faceOf(id, box.node.status), opts.focus !== void 0 && id === opts.focus);
  }
  drawEdges(canvas, routing.edges, rows, opts);
  drawLegend(canvas, map, opts, rows.legendY, neutral, unverified.size > 0);
  const hits = [...rows.boxOf.values()].map((b) => ({
    id: b.node.id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h
  }));
  return { canvas, hits };
}

// src/store/store.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
  if (raw["version"] !== STATE_FILE_VERSION) {
    return err({ kind: "bad-shape", path, detail: `version is ${String(raw["version"])}, expected ${STATE_FILE_VERSION}` });
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
  return ok(map);
}

// src/store/store.ts
var STATE_FILE_RELATIVE_PATH = join(".mellos", "map.json");
var PAGES_DIR_NAME = "pages";
function pageFilePath(defaultFile, page) {
  return page === void 0 ? defaultFile : join(dirname(defaultFile), PAGES_DIR_NAME, `${page}.json`);
}
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
    entries = readdirSync(join(dirname(defaultFile), PAGES_DIR_NAME));
  } catch {
  }
  for (const e of entries.sort()) {
    if (e.endsWith(".json")) out.push(join(dirname(defaultFile), PAGES_DIR_NAME, e));
  }
  return out;
}
var FOCUS_FILE_NAME = "focus";
function focusFilePath(defaultFile) {
  return join(dirname(defaultFile), FOCUS_FILE_NAME);
}
function takeFocusRequest(defaultFile) {
  const path = focusFilePath(defaultFile);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return void 0;
  }
  try {
    rmSync(path, { force: true });
  } catch {
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const page = parsed.page;
  if (page === void 0 || page === null) return { page: void 0 };
  if (typeof page !== "string") return void 0;
  const id = makePageId(page);
  return id.ok ? { page: id.value } : void 0;
}
var CONFIG_FILE_NAME = "config.json";
function configFilePath(defaultFile) {
  return join(dirname(defaultFile), CONFIG_FILE_NAME);
}
function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}
var LEGACY_STATE_FILE_RELATIVE_PATH = join(".claude", "mellos-mapping.json");
var LEGACY_PAGES_DIR_NAME = "mellos-mapping.pages";
var LEGACY_CONFIG_FILE_NAME = "mellos-mapping.config.json";
function migrateLegacyStore(defaultFile) {
  const projectRoot = dirname(dirname(defaultFile));
  const legacyDefault = join(projectRoot, LEGACY_STATE_FILE_RELATIVE_PATH);
  const legacyPages = join(dirname(legacyDefault), LEGACY_PAGES_DIR_NAME);
  const legacyConfig = join(dirname(legacyDefault), LEGACY_CONFIG_FILE_NAME);
  const hasLegacy = existsSync(legacyDefault) || existsSync(legacyPages) || existsSync(legacyConfig);
  const hasCurrent = existsSync(defaultFile) || existsSync(join(dirname(defaultFile), PAGES_DIR_NAME)) || existsSync(configFilePath(defaultFile));
  if (!hasLegacy || hasCurrent) return false;
  mkdirSync(dirname(defaultFile), { recursive: true });
  if (existsSync(legacyDefault)) renameSync(legacyDefault, defaultFile);
  if (existsSync(legacyPages)) renameSync(legacyPages, join(dirname(defaultFile), PAGES_DIR_NAME));
  if (existsSync(legacyConfig)) renameSync(legacyConfig, configFilePath(defaultFile));
  return true;
}
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

// src/watch/input.ts
var KEY_H_STEP = 4;
var KEY_V_STEP = 2;
var WHEEL_V_STEP = 3;
var WHEEL_H_STEP = 4;
var MOTION = 32;
var WHEEL = 64;
var SHIFT = 4;
var BUTTON_BITS = 3;
var WHEEL_BITS = 3;
var SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
var ARROW = /^\x1b\[([ABCD])/;
var SHIFT_TAB = /^\x1b\[Z/;
var CSI_SEQUENCE = /^\x1b\[[0-9;:<=>?]*[ -/]*[@-~]/;
var SS3_SEQUENCE = /^\x1bO[@-~]/;
var PARTIAL_ESCAPE = /^(?:\x1b\[[0-9;:<=>?]*[ -/]*|\x1bO)$/;
var ARROW_PAN = {
  A: { dx: 0, dy: -KEY_V_STEP },
  B: { dx: 0, dy: KEY_V_STEP },
  C: { dx: KEY_H_STEP, dy: 0 },
  D: { dx: -KEY_H_STEP, dy: 0 }
};
var KEY_PAN = {
  k: { dx: 0, dy: -KEY_V_STEP },
  j: { dx: 0, dy: KEY_V_STEP },
  l: { dx: KEY_H_STEP, dy: 0 },
  h: { dx: -KEY_H_STEP, dy: 0 }
};
function mouseEvent(code, x, y, final) {
  if (code & WHEEL) {
    switch (code & WHEEL_BITS) {
      case 0:
      case 1: {
        const down = (code & 1) !== 0;
        return code & SHIFT ? { kind: "pan", dx: 0, dy: (down ? 1 : -1) * WHEEL_V_STEP } : { kind: "zoom", delta: down ? -1 : 1, at: { x, y } };
      }
      default: {
        const right = (code & 1) !== 0;
        return { kind: "pan", dx: (right ? 1 : -1) * WHEEL_H_STEP, dy: 0 };
      }
    }
  }
  const buttons = code & BUTTON_BITS;
  if (final === "m") return buttons === 0 ? { kind: "mouse-up", x, y } : void 0;
  if (code & MOTION) {
    if (buttons === 3) return { kind: "mouse-move", x, y };
    if (buttons === 0) return { kind: "mouse-drag", x, y };
    return void 0;
  }
  return buttons === 0 ? { kind: "mouse-down", x, y } : void 0;
}
function parseInput(chunk) {
  const events = [];
  let i = 0;
  while (i < chunk.length) {
    const slice = chunk.slice(i);
    const mouse = SGR_MOUSE.exec(slice);
    if (mouse) {
      const event = mouseEvent(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4]);
      if (event) events.push(event);
      i += mouse[0].length;
      continue;
    }
    const arrow = ARROW.exec(slice);
    if (arrow) {
      const pan = ARROW_PAN[arrow[1]];
      events.push({ kind: "pan", ...pan });
      i += arrow[0].length;
      continue;
    }
    const shiftTab = SHIFT_TAB.exec(slice);
    if (shiftTab) {
      events.push({ kind: "prev-page" });
      i += shiftTab[0].length;
      continue;
    }
    const sequence = CSI_SEQUENCE.exec(slice) ?? SS3_SEQUENCE.exec(slice);
    if (sequence) {
      i += sequence[0].length;
      continue;
    }
    if (PARTIAL_ESCAPE.test(slice)) {
      return { events, rest: slice };
    }
    const ch = chunk[i];
    if (ch === "\x1B") events.push({ kind: "clear" });
    else if (ch === "q" || ch === "Q" || ch === "" || ch === "") events.push({ kind: "quit" });
    else if (ch === "0") events.push({ kind: "reset" });
    else if (ch === "+" || ch === "=") events.push({ kind: "zoom", delta: 1 });
    else if (ch === "-") events.push({ kind: "zoom", delta: -1 });
    else if (ch === "	") events.push({ kind: "next-page" });
    else if (ch === "\x7F" || ch === "\b") events.push({ kind: "back" });
    else if (ch === "f" || ch === "F") events.push({ kind: "follow-toggle" });
    else if (ch >= "1" && ch <= "9") events.push({ kind: "page", index: ch.charCodeAt(0) - "1".charCodeAt(0) });
    else if (KEY_PAN[ch]) events.push({ kind: "pan", ...KEY_PAN[ch] });
    i += 1;
  }
  return { events, rest: "" };
}

// src/watch/pane-state.ts
function describePageFault(fault) {
  return fault.kind === "unreadable" ? `cannot read ${fault.path}: ${fault.detail}` : describeStoreError(fault);
}
function isTransient(fault) {
  return fault.kind === "malformed-json";
}
function mapOf(entry) {
  if (entry === void 0 || entry.state.kind === "absent") return void 0;
  return entry.state.kind === "loaded" ? entry.state.map : entry.state.lastGood;
}
function mtimeOf(entry) {
  return entry === void 0 || entry.state.kind === "absent" ? void 0 : entry.state.mtimeMs;
}
function initialPaneState(follow, requestedFile) {
  return { pages: [], activeFile: void 0, pendingFocusFile: requestedFile, follow, diveStack: [], scanned: false };
}
function entryOf(state, file) {
  return file === void 0 ? void 0 : state.pages.find((p) => p.file === file);
}
function mapsOf(state) {
  return new Map(state.pages.map((p) => [p.file, mapOf(p)]));
}
function filesOf(state) {
  return state.pages.map((p) => p.file);
}
function markViewed(state, file) {
  if (file === void 0 || !state.pages.some((p) => p.file === file && p.fresh)) return state;
  return { ...state, pages: state.pages.map((p) => p.file === file ? { ...p, fresh: false } : p) };
}
function userSwitch(state, file) {
  const followTurnedOff = state.follow;
  return {
    state: markViewed({ ...state, activeFile: file, pendingFocusFile: void 0, follow: false }, file),
    followTurnedOff
  };
}
function toggleFollow(state) {
  return { ...state, follow: !state.follow };
}
function pushDive(state, file) {
  return { ...state, diveStack: [...state.diveStack, file] };
}
function popDive(state) {
  const files = new Set(filesOf(state));
  const stack = [...state.diveStack];
  while (stack.length > 0) {
    const parent = stack.pop();
    if (files.has(parent)) return { state: { ...state, diveStack: stack }, parent };
  }
  return { state: { ...state, diveStack: [] }, parent: void 0 };
}
function scan(state, input) {
  const first = !state.scanned;
  const previousActive = state.activeFile;
  const pages = [];
  const freshened = [];
  const changed = [];
  for (const file of input.files) {
    const held = entryOf(state, file);
    const mtimeMs = input.mtimeAt(file);
    if (mtimeMs === void 0) {
      pages.push(held ?? { file, state: { kind: "absent" }, fresh: false });
      continue;
    }
    const settled = held !== void 0 && mtimeOf(held) === mtimeMs && !(held.state.kind === "faulted" && held.state.transient);
    if (settled) {
      pages.push(held);
      continue;
    }
    const loaded = input.load(file);
    if (loaded.ok) {
      if (!first) changed.push(file);
      const fresh = !first && file !== previousActive;
      if (fresh) freshened.push(file);
      pages.push({ file, state: { kind: "loaded", map: loaded.value, mtimeMs }, fresh });
      continue;
    }
    pages.push({
      file,
      state: {
        kind: "faulted",
        fault: loaded.error,
        lastGood: mapOf(held),
        mtimeMs,
        transient: isTransient(loaded.error)
      },
      fresh: held?.fresh ?? false
    });
  }
  let pendingFocusFile = state.pendingFocusFile;
  if (input.focusRequest !== void 0 && !(first && pendingFocusFile !== void 0)) {
    pendingFocusFile = input.focusRequest;
  }
  let activeFile = previousActive;
  let requestApplied = false;
  if (pendingFocusFile !== void 0 && input.files.includes(pendingFocusFile)) {
    activeFile = pendingFocusFile;
    pendingFocusFile = void 0;
    requestApplied = true;
  }
  const mtimeIn = (file) => mtimeOf(pages.find((p) => p.file === file));
  if (state.follow && !requestApplied && changed.length > 0 && !input.engaged) {
    activeFile = mostRecentKey(changed, mtimeIn) ?? activeFile;
  }
  if (activeFile === void 0 || !input.files.includes(activeFile)) {
    activeFile = mostRecentKey(input.files, mtimeIn);
  }
  const files = new Set(input.files);
  const next = {
    pages,
    activeFile,
    pendingFocusFile,
    follow: state.follow,
    diveStack: state.diveStack.filter((f) => files.has(f)),
    scanned: true
  };
  return { state: markViewed(next, activeFile), freshened };
}

// src/watch/watch.ts
function describeArgsError(e) {
  switch (e.kind) {
    case "unknown-flag":
      return `unknown flag "${e.flag}"`;
    case "missing-value":
      return `${e.flag} needs a value`;
    case "invalid-value":
      return `${e.flag} got "${e.raw}" (expected: ${e.rule})`;
  }
}
var USAGE = "usage: mellos-mapping-watch [--file <map.json>] [--page <slug>] [--interval <ms>] [--ascii] [--no-color] [--no-mouse] [--no-follow]";
function parseArgs(argv, cwd) {
  let file = join2(cwd, STATE_FILE_RELATIVE_PATH);
  let intervalMs = POLL_INTERVAL_DEFAULT_MS;
  let unicode = true;
  let color = true;
  let mouse = true;
  let page;
  let follow = true;
  const valueOf = (flag, raw) => raw === void 0 || raw.startsWith("--") ? err({ kind: "missing-value", flag }) : ok(raw);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--file": {
        const value = valueOf(flag, argv[++i]);
        if (!value.ok) return value;
        file = value.value;
        break;
      }
      case "--page": {
        const value = valueOf(flag, argv[++i]);
        if (!value.ok) return value;
        const parsed = makePageId(value.value);
        if (!parsed.ok) return err({ kind: "invalid-value", flag, raw: value.value, rule: parsed.error.rule });
        page = parsed.value;
        break;
      }
      case "--interval": {
        const value = valueOf(flag, argv[++i]);
        if (!value.ok) return value;
        const ms = Number(value.value);
        if (!Number.isFinite(ms) || ms <= 0) {
          return err({ kind: "invalid-value", flag, raw: value.value, rule: "a positive number of milliseconds" });
        }
        intervalMs = Math.max(POLL_INTERVAL_MIN_MS, ms);
        break;
      }
      case "--ascii":
        unicode = false;
        break;
      case "--no-color":
        color = false;
        break;
      case "--no-mouse":
        mouse = false;
        break;
      case "--no-follow":
        follow = false;
        break;
      default:
        return err({ kind: "unknown-flag", flag });
    }
  }
  return ok({ file, intervalMs, unicode, color, mouse, page, follow });
}
function readPage(file) {
  try {
    return loadMapFile(file);
  } catch (e) {
    return err({ kind: "unreadable", path: file, detail: e.code ?? e.message });
  }
}
function renderWindow(map, opts, viewport) {
  try {
    return ok(renderMapWindow(map, opts, viewport));
  } catch (e) {
    return err(`this map could not be drawn: ${e.message}`);
  }
}
function dividerRow(width, unicode, follow) {
  const grip = unicode ? " \u22EF " : " ~ ";
  let bar = (unicode ? "\u2500" : "-").repeat(width);
  const gripAt = Math.max(0, Math.floor((width - grip.length) / 2));
  if (width > grip.length + 2) bar = bar.slice(0, gripAt) + grip + bar.slice(gripAt + grip.length);
  if (follow) {
    const tag = unicode ? " \u21E2 follow " : " > follow ";
    const at = width - tag.length - 1;
    if (at > gripAt + grip.length) bar = bar.slice(0, at) + tag + bar.slice(at + tag.length);
  }
  return bar;
}
var HIDE_CURSOR = "\x1B[?25l";
var SHOW_CURSOR = "\x1B[?25h";
var CLEAR_ALL = "\x1B[H\x1B[2J";
var HOME = "\x1B[H";
var ERASE_LINE_END = "\x1B[K";
var MOUSE_ON = "\x1B[?1003h\x1B[?1006h";
var MOUSE_OFF = "\x1B[?1003l\x1B[?1006l";
var RESET = "\x1B[0m";
function terminalRestoreSequence(mouseActive) {
  return (mouseActive ? MOUSE_OFF : "") + SHOW_CURSOR + RESET + "\n";
}
var PANEL_CONTENT_ROWS = 6;
var PANEL_ROWS_MIN = 2;
var MAP_ROWS_MIN = 4;
var POLL_INTERVAL_DEFAULT_MS = 250;
var POLL_INTERVAL_MIN_MS = 50;
var SPLASH_FRAME_MS = 80;
var FLASH_ACK_MS = 2500;
var FLASH_NOTICE_MS = 3e3;
var FLASH_BACKGROUND_NEWS_MS = 4e3;
var DOUBLE_CLICK_MS = 450;
var FALLBACK_COLUMNS = 100;
var FALLBACK_ROWS = 30;
var DEFAULT_PAGE_TAB_LABEL = "main";
function usableColumns(cols) {
  return Math.max(1, cols - 1);
}
function clampPanelRows(wanted, totalRows, tabRows) {
  const largest = totalRows - tabRows - MAP_ROWS_MIN - 2;
  return Math.max(PANEL_ROWS_MIN, Math.min(wanted, largest));
}
function panelRowsFromDividerY(termY, totalRows, tabRows) {
  return clampPanelRows(totalRows - termY - 1, totalRows, tabRows);
}
function anchorOffsets(anchor, offset, before, after) {
  if (anchor) {
    return {
      x: Math.round(offset.x + anchor.after.x + anchor.after.w / 2 - (anchor.before.x + anchor.before.w / 2)),
      y: Math.round(offset.y + anchor.after.y + anchor.after.h / 2 - (anchor.before.y + anchor.before.h / 2))
    };
  }
  return {
    x: before.w > 0 ? Math.round(offset.x * after.w / before.w) : 0,
    y: before.h > 0 ? Math.round(offset.y * after.h / before.h) : 0
  };
}
var TAB_INDICATOR_W = 3;
function pageTabRow(tabs, width, unicode, scroll = 0) {
  const texts = tabs.map((tab) => {
    const marker = tab.active ? unicode ? "\u25CF" : "*" : unicode ? "\u25CB" : "o";
    const glyph = statusGlyph(tab.status, unicode);
    return tab.neutral === true ? ` ${marker} ${tab.title} ` : ` ${marker} ${glyph} ${tab.title} `;
  });
  const sgrOf = (tab) => tab.neutral === true ? tab.active ? "1" : tab.fresh ? "36" : "90" : tab.active ? `${statusSgr(tab.status)};1` : tab.fresh ? statusSgr(tab.status) : "90";
  const widths = texts.map(displayWidth);
  const count = tabs.length;
  let lo = 0;
  let hi = count - 1;
  if (widths.reduce((a, b) => a + b, 0) > width) {
    lo = Math.max(0, Math.min(scroll, count - 1));
    hi = lo;
    const cost = (l, h) => widths.slice(l, h + 1).reduce((a, b) => a + b, 0) + (l > 0 ? TAB_INDICATOR_W : 0) + (h < count - 1 ? TAB_INDICATOR_W : 0);
    while (hi + 1 < count && cost(lo, hi + 1) <= width) hi++;
  }
  const segments = [];
  let col = 1;
  const push = (text, sgr, action) => {
    const w = displayWidth(text);
    segments.push({ text, sgr, lo: col, hi: col + w - 1, action });
    col += w;
  };
  if (lo > 0) push(unicode ? " \u2039 " : " < ", "90", { kind: "scroll", delta: -1 });
  const tail = hi < count - 1 ? TAB_INDICATOR_W : 0;
  for (let i = lo; i <= hi; i++) {
    push(fitWidth(texts[i], Math.max(1, width - (col - 1) - tail)), sgrOf(tabs[i]), { kind: "switch", index: i });
  }
  if (hi < count - 1) push(unicode ? " \u203A " : " > ", "90", { kind: "scroll", delta: 1 });
  return segments;
}
function tabScrollFor(tabs, width, unicode, scroll, index) {
  if (index <= scroll) return Math.max(0, index);
  const visibleAt = (s2) => pageTabRow(tabs, width, unicode, s2).some((seg) => seg.action.kind === "switch" && seg.action.index === index);
  let s = Math.max(0, Math.min(scroll, tabs.length - 1));
  while (s < index && !visibleAt(s)) s++;
  return s;
}
function topLevelFiles(defaultFile, files, mapOf2) {
  const interior = interiorPages(files.map((f) => [pageIdOfFile(defaultFile, f), mapOf2.get(f)]));
  return files.filter((f) => {
    const id = pageIdOfFile(defaultFile, f);
    return id === void 0 || !interior.has(id);
  });
}
function diveOrigin(defaultFile, file, files, mapOf2) {
  const id = pageIdOfFile(defaultFile, file);
  if (id === void 0) return void 0;
  const entries = files.filter((f) => f !== file).map((f) => [f, mapOf2.get(f)]);
  return diveParent(entries, id);
}
function nearestHit(hits, cx, cy) {
  let best;
  let bestDistance = Infinity;
  for (const h of hits) {
    const d = Math.abs(h.x + h.w / 2 - cx) + Math.abs(h.y + h.h / 2 - cy);
    if (d < bestDistance) {
      bestDistance = d;
      best = h;
    }
  }
  return best;
}
function nodePanel(map, focusId, unicode, width, pinned, rows = PANEL_CONTENT_ROWS) {
  const g = (s) => statusGlyph(s, unicode);
  const pinMark = pinned ? unicode ? "  \u2299 pinned" : "  * pinned" : "";
  const focus = focusInfo(map, focusId);
  if (focus === void 0) return void 0;
  const refText = (r) => `${g(r.status)} ${r.label}${r.edgeLabel !== void 0 ? ` (${r.edgeLabel})` : ""}`;
  if (focus.kind === "group") {
    const { group, status, layerName: layerName2, members } = focus;
    const [right2, left2] = unicode ? ["\u2192", "\u2190"] : ["->", "<-"];
    const uses2 = focus.uses.map(refText);
    const usedBy2 = focus.usedBy.map(refText);
    const lines2 = [
      {
        text: fitWidth(
          `${g(status)} ${group.label} [${group.id}] \xB7 ${layerName2} \xB7 ${status} \xB7 ${members.length} member(s)${pinMark}`,
          width
        ),
        sgr: `${statusSgr(status)};1`
      },
      {
        text: fitWidth(`members: ${members.map((n) => `${g(n.status)} ${n.label}`).join("  ") || "\u2014"}`, width),
        sgr: ""
      },
      { text: fitWidth(`uses ${right2}  ${uses2.join("  ") || "\u2014"}`, width), sgr: "" },
      { text: fitWidth(`used by ${left2}  ${usedBy2.join("  ") || "\u2014"}`, width), sgr: "" }
    ];
    while (lines2.length < rows) lines2.push({ text: "", sgr: "" });
    return lines2.slice(0, rows);
  }
  const { node, layerName, laneLabel } = focus;
  const neutral = isNeutralKind(map);
  const [right, left] = unicode ? ["\u2192", "\u2190"] : ["->", "<-"];
  const uses = focus.uses.map(refText);
  const usedBy = focus.usedBy.map(refText);
  const pin = pinMark;
  const headGlyph = neutral ? (node.kind !== void 0 ? kindGlyph(node.kind, unicode) : void 0) ?? (unicode ? "\xB7" : ".") : g(node.status);
  const headParts = [
    `${headGlyph} ${node.label} [${node.id}]`,
    layerName,
    ...laneLabel !== void 0 ? [laneLabel] : [],
    ...node.kind !== void 0 ? [node.kind] : [],
    ...neutral ? [] : [node.status],
    ...node.submap !== void 0 ? [`${unicode ? "\u229E" : "+"} ${node.submap}`] : []
  ];
  const [usesWord, usedByWord] = map.kind === "sequence" ? ["after", "before"] : ["uses", "used by"];
  const lines = [
    {
      text: fitWidth(`${headParts.join(" \xB7 ")}${pin}`, width),
      sgr: neutral ? "1" : `${statusSgr(node.status)};1`
    },
    { text: fitWidth(`evidence: ${node.evidence ?? "\u2014"}`, width), sgr: "90" },
    { text: fitWidth(`${usesWord} ${right}  ${uses.join("  ") || "\u2014"}`, width), sgr: "" },
    { text: fitWidth(`${usedByWord} ${left}  ${usedBy.join("  ") || "\u2014"}`, width), sgr: "" }
  ];
  const notes = node.detail !== void 0 ? wrapWidth(node.detail, width) : ["(no design notes yet)"];
  const room = Math.max(0, rows - lines.length);
  for (let i = 0; i < room; i++) {
    const last = i === room - 1 && notes.length > room;
    lines.push({
      text: last ? fitWidth(notes[i] + "\u2026", width) : notes[i] ?? "",
      sgr: node.detail !== void 0 ? "" : "90"
    });
  }
  return lines.slice(0, rows);
}
var WATER_ROWS = 7;
var WATER_COLS_MAX = 60;
var SPLASH_SHADES = {
  unicode: ["\u2591", "\u2591", "\u2592", "\u2592", "\u2593", "\u2593", "\u2588", "\u2588"],
  ascii: [".", ".", ":", ":", "=", "=", "#", "#"]
};
var WAVE_RAMP = [17, 18, 19, 61, 24, 25, 31, 37, 44, 45, 51, 87, 123, 159, 195];
function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor(ms / 1e3));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
function waitingInfo(s, width) {
  const w = Math.max(1, width);
  const clock = s.elapsedMs !== void 0 ? ` \xB7 waiting ${elapsedLabel(s.elapsedMs)}` : "";
  const lines = [
    `watching  ${s.defaultFile}`,
    `      and ${join2(s.pagesDir, "*.json")}`,
    `polling every ${s.intervalMs} ms${clock}`
  ];
  for (const b of s.broken) lines.push(`! ${b}`);
  lines.push("the map appears at the first mmap_declare");
  return lines.map((l) => fitWidth(l, w));
}
var WAVE_INTERVAL = 18;
var WAVE_LIFETIME = 64;
var WAVE_SPEED = 0.9;
var WAVE_ENVELOPE = 10;
var WAVE_NUMBER = 0.42;
var WAVE_LEVELS = 7;
var WAVE_GAIN = 4.5;
function waveHash(n) {
  let h = Math.imul(n + 1, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}
var WAVE_CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1]
];
function liveRipples(frame, width, height) {
  const out = [];
  const first = Math.floor((frame - WAVE_LIFETIME - WAVE_INTERVAL) / WAVE_INTERVAL);
  const last = Math.floor(frame / WAVE_INTERVAL);
  for (let n = Math.max(0, first); n <= last; n++) {
    const h = waveHash(n);
    const age = frame - (n * WAVE_INTERVAL + h % WAVE_INTERVAL);
    if (age < 0 || age > WAVE_LIFETIME) continue;
    const [fx, fy] = WAVE_CORNERS[h % WAVE_CORNERS.length];
    out.push({
      ox: fx * (width - 1),
      oy: fy * (height - 1),
      r: age * WAVE_SPEED,
      fade: 1 - age / WAVE_LIFETIME
    });
  }
  return out;
}
function waveAt(ripples, x, y) {
  let value = 0;
  for (const w of ripples) {
    const front = Math.hypot(x - w.ox, (y - w.oy) * 2) - w.r;
    value += Math.cos(front * WAVE_NUMBER) * Math.exp(-(front * front) / (2 * WAVE_ENVELOPE ** 2)) * w.fade;
  }
  return value;
}
function waveLevel(value) {
  return Math.max(-WAVE_LEVELS, Math.min(WAVE_LEVELS, Math.round(value * WAVE_GAIN)));
}
function splashFrame(notice, info, frame, width, height, unicode, color) {
  const fieldW = Math.min(width - 4, WATER_COLS_MAX);
  if (fieldW < 24 || height < WATER_ROWS + info.length + 3) return void 0;
  const mode = unicode ? "unicode" : "ascii";
  const shades = SPLASH_SHADES[mode];
  const indent = " ".repeat(Math.max(0, Math.floor((width - fieldW) / 2)));
  const ripples = liveRipples(frame, fieldW, WATER_ROWS);
  const paintRow = (y) => {
    const levels = Array.from({ length: fieldW }, (_, x) => waveLevel(waveAt(ripples, x, y)));
    let out = "";
    for (let i = 0; i < fieldW; ) {
      const level = levels[i];
      let j = i;
      while (j < fieldW && levels[j] === level) j++;
      if (level === 0) out += " ".repeat(j - i);
      else {
        const ink = shades[Math.abs(level)].repeat(j - i);
        out += color ? `\x1B[38;5;${WAVE_RAMP[WAVE_LEVELS + level]}m${ink}${RESET}` : ink;
      }
      i = j;
    }
    return out;
  };
  const dim = (s) => color ? `\x1B[90m${s}${RESET}` : s;
  const spinner = SPINNER_FRAMES[mode];
  const status = fitWidth(`${spinner[frame % spinner.length]} ${notice}`, Math.max(1, width - 2));
  const statusIndent = " ".repeat(Math.max(0, Math.floor((width - displayWidth(status)) / 2)));
  const infoWidth = Math.max(0, ...info.map((l) => displayWidth(l)));
  const infoIndent = " ".repeat(Math.max(0, Math.floor((width - infoWidth) / 2)));
  const block = [
    ...Array.from({ length: WATER_ROWS }, (_, y) => indent + paintRow(y)),
    "",
    statusIndent + dim(status),
    "",
    ...info.map((l) => infoIndent + dim(l))
  ];
  return [...Array.from({ length: Math.max(0, Math.floor((height - block.length) / 2)) }, () => ""), ...block];
}
function mapPanel(map, unicode, width, rows = PANEL_CONTENT_ROWS) {
  const g = (s) => statusGlyph(s, unicode);
  const count = (s) => map.nodes.filter((n) => n.status === s).length;
  const statuses = ["done", "in-progress", "planned", "regressed"];
  const counts = statuses.filter((s) => count(s) > 0).map((s) => `${g(s)} ${count(s)} ${s}`).join("   ");
  const parts = [`${map.layers.length} layers`, `${map.nodes.length} nodes`, `${map.edges.length} edges`];
  if (map.lanes.length > 0) parts.push(`${map.lanes.length} lanes`);
  const lines = [
    { text: fitWidth(map.title ?? "mellos map", width), sgr: "1" },
    { text: fitWidth(parts.join(" \xB7 "), width), sgr: "90" },
    // documentation kinds document structure, not progress
    { text: fitWidth(isNeutralKind(map) ? `${map.kind} diagram` : counts, width), sgr: isNeutralKind(map) ? "90" : "" },
    { text: "", sgr: "" },
    { text: "hover a node to inspect \xB7 click to pin", sgr: "90" }
  ];
  while (lines.length < rows) lines.push({ text: "", sgr: "" });
  return lines.slice(0, rows);
}
function main() {
  const parsed = parseArgs(process.argv.slice(2), process.cwd());
  if (!parsed.ok) {
    console.error(`mellos-mapping-watch: ${describeArgsError(parsed.error)}
${USAGE}`);
    process.exit(1);
  }
  const cfg = parsed.value;
  if (migrateLegacyStore(cfg.file)) console.error("mellos-mapping: moved the legacy .claude map store to .mellos/ \u2014 commit the move.");
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const mouseActive = interactive && cfg.mouse;
  let lastFrame = "";
  let spinnerFrame = 0;
  let splashTick = 0;
  const startedAt = Date.now();
  const standbyNotice = "waiting for the first mmap_declare ...";
  let map;
  let notice = standbyNotice;
  let lastCols = process.stdout.columns ?? 0;
  let lastRows = process.stdout.rows ?? 0;
  let pane = initialPaneState(
    cfg.follow,
    cfg.page === void 0 ? void 0 : pageFilePath(cfg.file, cfg.page)
  );
  const pageViews = /* @__PURE__ */ new Map();
  let lastTabSegments = [];
  let tabScroll = 0;
  let offsetX = 0;
  let offsetY = 0;
  let zoom = ZOOM_DEFAULT;
  let dragAnchor;
  let press;
  let hoverId;
  let selectedId;
  let lastHits = [];
  let lastContent = { w: 0, h: 0 };
  let pendingInput = "";
  let panelContentRows = PANEL_CONTENT_ROWS;
  let dividerDrag = false;
  let lastClick;
  let flash;
  let lastTabFiles = [];
  const topFiles = () => topLevelFiles(cfg.file, filesOf(pane), mapsOf(pane));
  const inSubmap = () => pane.activeFile !== void 0 && !topFiles().includes(pane.activeFile);
  const tabRows = () => topFiles().length > 1 || inSubmap() ? 1 : 0;
  const climbBack = () => {
    const climbed = popDive(pane);
    pane = climbed.state;
    const parent = climbed.parent ?? (pane.activeFile !== void 0 ? diveOrigin(cfg.file, pane.activeFile, filesOf(pane), mapsOf(pane))?.parent : void 0);
    if (parent !== void 0 && parent !== pane.activeFile) {
      handSwitch(parent);
      return true;
    }
    return false;
  };
  const viewWidth = () => usableColumns(process.stdout.columns ?? FALLBACK_COLUMNS);
  const viewHeight = () => Math.max(1, (process.stdout.rows ?? FALLBACK_ROWS) - (1 + panelContentRows) - 1 - tabRows());
  const dividerY = () => tabRows() + viewHeight() + 1;
  const pageTabsOf = (files) => files.map((f) => {
    const entry = entryOf(pane, f);
    const m = mapOf(entry);
    return {
      title: m?.title ?? (pageIdOfFile(cfg.file, f) ?? DEFAULT_PAGE_TAB_LABEL),
      status: m !== void 0 ? mapStatus(m) : "planned",
      active: f === pane.activeFile,
      fresh: entry?.fresh ?? false,
      neutral: m !== void 0 && isNeutralKind(m)
    };
  });
  const noticeFor = (file) => {
    const entry = entryOf(pane, file);
    if (entry === void 0 || entry.state.kind === "absent") {
      return file === void 0 || file === cfg.file ? standbyNotice : `waiting for ${file} ...`;
    }
    if (entry.state.kind === "loaded") return "";
    return entry.state.transient && entry.state.lastGood !== void 0 ? "" : describePageFault(entry.state.fault);
  };
  const adoptPage = () => {
    map = mapOf(entryOf(pane, pane.activeFile));
    notice = noticeFor(pane.activeFile);
  };
  const adoptView = (previous) => {
    const file = pane.activeFile;
    if (file === void 0 || file === previous) return;
    if (previous !== void 0) pageViews.set(previous, { offsetX, offsetY, zoom, selectedId });
    const view = pageViews.get(file);
    offsetX = view?.offsetX ?? 0;
    offsetY = view?.offsetY ?? 0;
    zoom = view?.zoom ?? ZOOM_DEFAULT;
    selectedId = view?.selectedId;
    hoverId = void 0;
    const top = topFiles();
    const tabIndex = top.indexOf(file);
    if (tabIndex >= 0) tabScroll = tabScrollFor(pageTabsOf(top), viewWidth(), cfg.unicode, tabScroll, tabIndex);
  };
  const handSwitch = (file) => {
    const previous = pane.activeFile;
    const switched = userSwitch(pane, file);
    pane = switched.state;
    if (switched.followTurnedOff) {
      flash = { text: "auto-follow off \u2014 press f to re-enable", until: Date.now() + FLASH_NOTICE_MS };
    }
    adoptView(previous);
    adoptPage();
  };
  const hitTest = (termX, termY) => {
    const sx = termX - 1;
    const sy = termY - 1 - tabRows();
    if (sx < 0 || sx >= viewWidth()) return void 0;
    if (sy < 0 || sy >= viewHeight()) return void 0;
    const cx = sx + offsetX;
    const cy = sy + offsetY;
    return lastHits.find((h) => cx >= h.x && cx < h.x + h.w && cy >= h.y && cy < h.y + h.h)?.id;
  };
  process.stdout.write(HIDE_CURSOR + CLEAR_ALL + (mouseActive ? MOUSE_ON : ""));
  process.on("exit", () => process.stdout.write(terminalRestoreSequence(mouseActive)));
  const quit = () => process.exit(0);
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.on("uncaughtException", (e) => {
    process.stderr.write(`
the map pane stopped: ${e instanceof Error ? e.stack ?? e.message : String(e)}
`);
    process.exit(1);
  });
  const paint2 = () => {
    const cols = process.stdout.columns ?? FALLBACK_COLUMNS;
    const viewW = viewWidth();
    panelContentRows = clampPanelRows(panelContentRows, process.stdout.rows ?? FALLBACK_ROWS, tabRows());
    const viewH = viewHeight();
    const focus = hoverId ?? selectedId;
    let body;
    let panned = "";
    let pannable = false;
    if (map !== void 0) {
      const rendered = renderWindow(
        map,
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus, zoom },
        { x: offsetX, y: offsetY, width: viewW, height: viewH }
      );
      if (!rendered.ok) {
        body = ["", fitWidth(`  ! ${rendered.error}`, viewW), ""];
        lastHits = [];
      } else {
        const windowed = rendered.value;
        const maxX = Math.max(0, windowed.contentWidth - viewW);
        const maxY = Math.max(0, windowed.contentHeight - viewH);
        if (offsetX > maxX || offsetY > maxY || offsetX < 0 || offsetY < 0) {
          offsetX = Math.min(Math.max(0, offsetX), maxX);
          offsetY = Math.min(Math.max(0, offsetY), maxY);
          paint2();
          return;
        }
        pannable = maxX > 0 || maxY > 0;
        body = windowed.lines;
        lastHits = windowed.hits;
        lastContent = { w: windowed.contentWidth, h: windowed.contentHeight };
        if (offsetX !== 0 || offsetY !== 0) panned = `  (+${offsetX},+${offsetY})`;
      }
    } else {
      const info = waitingInfo(
        {
          defaultFile: cfg.file,
          pagesDir: join2(dirname2(cfg.file), PAGES_DIR_NAME),
          intervalMs: cfg.intervalMs,
          elapsedMs: interactive ? Date.now() - startedAt : void 0,
          broken: pane.pages.flatMap(
            (p) => p.state.kind === "faulted" && p.state.lastGood === void 0 ? [describePageFault(p.state.fault)] : []
          )
        },
        Math.max(1, viewW - 2)
      );
      body = (interactive ? splashFrame(notice, info, splashTick, viewW, viewH, cfg.unicode, cfg.color) : void 0) ?? [fitWidth(notice, viewW), "", ...info.map((l) => fitWidth(` ${l}`, viewW))];
    }
    if (notice !== "" && map !== void 0) {
      body[body.length - 1] = fitWidth(`  ${notice}`, viewW);
    }
    const panelWidth = Math.max(10, cols - 2);
    let panel;
    if (map === void 0) {
      panel = Array.from({ length: panelContentRows }, () => ({ text: "", sgr: "" }));
    } else if (focus !== void 0) {
      panel = nodePanel(map, focus, cfg.unicode, panelWidth, selectedId === focus, panelContentRows) ?? mapPanel(map, cfg.unicode, panelWidth, panelContentRows);
    } else {
      panel = mapPanel(map, cfg.unicode, panelWidth, panelContentRows);
    }
    const separator = dividerRow(viewW, cfg.unicode, pane.follow);
    const panelRows = [
      cfg.color ? `\x1B[90m${separator}${RESET}` : separator,
      ...panel.map(
        (l) => cfg.color && l.sgr !== "" && l.text !== "" ? ` \x1B[${l.sgr}m${l.text}${RESET}` : ` ${l.text}`
      )
    ];
    let tabLine;
    lastTabFiles = topFiles();
    if (inSubmap() && pane.activeFile !== void 0) {
      const stackParent = pane.diveStack[pane.diveStack.length - 1];
      const origin = diveOrigin(cfg.file, pane.activeFile, filesOf(pane), mapsOf(pane));
      const parentFile = stackParent ?? origin?.parent;
      const parentTitle = parentFile !== void 0 ? mapOf(entryOf(pane, parentFile))?.title ?? (pageIdOfFile(cfg.file, parentFile) ?? DEFAULT_PAGE_TAB_LABEL) : DEFAULT_PAGE_TAB_LABEL;
      const nodeLabel = origin?.label ?? map?.title ?? "";
      const crumbHead = ` ${cfg.unicode ? "\u232B" : "<"} ${parentTitle} ${cfg.unicode ? "\u25B8" : ">"} `;
      const head = { text: crumbHead, sgr: "90", lo: 1, hi: displayWidth(crumbHead), action: { kind: "back" } };
      const tailText = fitWidth(`${nodeLabel} `, Math.max(1, viewW - displayWidth(crumbHead)));
      const tail = {
        text: tailText,
        sgr: "1",
        lo: head.hi + 1,
        hi: head.hi + displayWidth(tailText),
        action: { kind: "back" }
      };
      lastTabSegments = [head, tail];
      tabLine = lastTabSegments.map((s) => cfg.color && s.sgr !== "" ? `\x1B[${s.sgr}m${s.text}${RESET}` : s.text).join("");
    } else if (tabRows() > 0) {
      const segments = pageTabRow(pageTabsOf(lastTabFiles), viewW, cfg.unicode, tabScroll);
      lastTabSegments = segments;
      tabLine = segments.map((s) => cfg.color && s.sgr !== "" ? `\x1B[${s.sgr}m${s.text}${RESET}` : s.text).join("");
    } else {
      lastTabSegments = [];
    }
    const zoomTag = `${cfg.unicode ? "\u2295" : "zoom"} ${zoomLabel(zoom)}`;
    const hint = !interactive ? cfg.file : (flash !== void 0 ? `${flash.text} \xB7 ` : "") + `${zoomTag} \xB7 wheel zoom \xB7 ` + (pannable ? "drag pan \xB7 " : "") + "hover/click \xB7 0 reset \xB7 q quit";
    const footerText = fitWidth(` ${hint}${panned}`, viewW);
    const footer = cfg.color ? `\x1B[90m${footerText}${RESET}` : footerText;
    let frame = HOME;
    if (tabLine !== void 0) frame += tabLine + ERASE_LINE_END + "\n";
    for (let i = 0; i < viewH; i++) frame += (body[i] ?? "") + ERASE_LINE_END + "\n";
    for (const row of panelRows) frame += row + ERASE_LINE_END + "\n";
    frame += footer + ERASE_LINE_END;
    if (frame !== lastFrame) {
      process.stdout.write(frame);
      lastFrame = frame;
    }
  };
  const handleResize = () => {
    lastCols = process.stdout.columns ?? lastCols;
    lastRows = process.stdout.rows ?? lastRows;
    lastFrame = "";
    process.stdout.write(CLEAR_ALL);
    paint2();
  };
  const tick = () => {
    if ((process.stdout.columns ?? lastCols) !== lastCols || (process.stdout.rows ?? lastRows) !== lastRows) {
      handleResize();
    }
    const discovered = listPageFiles(cfg.file);
    const files = discovered.length > 0 ? discovered : [cfg.file];
    const request = takeFocusRequest(cfg.file);
    const previous = pane.activeFile;
    const scanned = scan(pane, {
      files,
      mtimeAt: (file) => {
        try {
          return statSync(file).mtimeMs;
        } catch {
          return void 0;
        }
      },
      load: readPage,
      focusRequest: request === void 0 ? void 0 : pageFilePath(cfg.file, request.page),
      // a drag in progress holds auto-follow off: the user is engaged with
      // THIS page, and a missed switch is re-triggered by the next save
      engaged: dragAnchor !== void 0
    });
    pane = scanned.state;
    for (const known of [...pageViews.keys()]) {
      if (!files.includes(known)) pageViews.delete(known);
    }
    adoptView(previous);
    adoptPage();
    const top = topFiles();
    for (const file of scanned.freshened) {
      if (top.includes(file)) continue;
      const title = mapOf(entryOf(pane, file))?.title ?? (pageIdOfFile(cfg.file, file) ?? "?");
      flash = { text: `${cfg.unicode ? "\u229E " : ""}${title} updated`, until: Date.now() + FLASH_BACKGROUND_NEWS_MS };
    }
    if (pane.pages.some((p) => mapOf(p)?.nodes.some((n) => n.status === "in-progress"))) spinnerFrame++;
    if (flash !== void 0 && Date.now() > flash.until) flash = void 0;
    paint2();
  };
  if (interactive) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      const parsed2 = parseInput(pendingInput + chunk);
      pendingInput = parsed2.rest;
      let dirty = false;
      for (const event of parsed2.events) {
        switch (event.kind) {
          case "quit":
            quit();
            return;
          case "reset":
            offsetX = 0;
            offsetY = 0;
            zoom = ZOOM_DEFAULT;
            dirty = true;
            break;
          case "clear":
            if (selectedId !== void 0) selectedId = void 0;
            else climbBack();
            dirty = true;
            break;
          case "pan":
            offsetX += event.dx;
            offsetY += event.dy;
            dirty = true;
            break;
          case "zoom": {
            if (event.at !== void 0 && event.at.y === 1 && tabRows() > 0 && !inSubmap()) {
              tabScroll = Math.max(0, Math.min(tabScroll + (event.delta === 1 ? -1 : 1), topFiles().length - 1));
              dirty = true;
              break;
            }
            const next = clampZoom(zoom + event.delta);
            if (next === zoom || map === void 0) break;
            const anchorId = hoverId ?? selectedId ?? nearestHit(lastHits, offsetX + viewWidth() / 2, offsetY + viewHeight() / 2)?.id;
            const before = lastHits.find((h) => h.id === anchorId);
            zoom = next;
            const measured = renderWindow(
              map,
              { color: false, unicode: cfg.unicode, spinnerFrame: 0, zoom },
              { x: 0, y: 0, width: 0, height: 0 }
            );
            if (!measured.ok) {
              dirty = true;
              break;
            }
            const sized = measured.value;
            const after = before === void 0 ? void 0 : sized.hits.find((h) => h.id === before.id);
            const moved = anchorOffsets(
              before !== void 0 && after !== void 0 ? { before, after } : void 0,
              { x: offsetX, y: offsetY },
              lastContent,
              { w: sized.contentWidth, h: sized.contentHeight }
            );
            offsetX = moved.x;
            offsetY = moved.y;
            dirty = true;
            break;
          }
          case "mouse-move": {
            const over = hitTest(event.x, event.y);
            if (over !== hoverId) {
              hoverId = over;
              dirty = true;
            }
            break;
          }
          case "mouse-down":
            if (event.y === dividerY()) {
              dividerDrag = true;
              break;
            }
            dragAnchor = { x: event.x, y: event.y, ox: offsetX, oy: offsetY };
            press = { moved: false };
            break;
          case "mouse-drag":
            if (dividerDrag) {
              const next = panelRowsFromDividerY(event.y, process.stdout.rows ?? FALLBACK_ROWS, tabRows());
              if (next !== panelContentRows) {
                panelContentRows = next;
                dirty = true;
              }
              break;
            }
            if (dragAnchor) {
              const nx = dragAnchor.ox - (event.x - dragAnchor.x);
              const ny = dragAnchor.oy - (event.y - dragAnchor.y);
              if (nx !== offsetX || ny !== offsetY) {
                offsetX = nx;
                offsetY = ny;
                if (press) press.moved = true;
                dirty = true;
              }
            }
            break;
          case "mouse-up":
            if (dividerDrag) {
              dividerDrag = false;
              break;
            }
            if (press && !press.moved) {
              const tabHit = tabRows() > 0 && event.y === 1 ? lastTabSegments.find((s) => event.x >= s.lo && event.x <= s.hi) : void 0;
              if (tabHit !== void 0) {
                if (tabHit.action.kind === "back") {
                  climbBack();
                } else if (tabHit.action.kind === "scroll") {
                  tabScroll = Math.max(0, Math.min(tabScroll + tabHit.action.delta, lastTabFiles.length - 1));
                } else {
                  const target = lastTabFiles[tabHit.action.index];
                  if (target !== void 0 && target !== pane.activeFile) handSwitch(target);
                }
              } else {
                const id = hitTest(event.x, event.y);
                const now = Date.now();
                if (id !== void 0 && lastClick?.id === id && now - lastClick.at <= DOUBLE_CLICK_MS) {
                  const submap = map?.nodes.find((n) => n.id === id)?.submap;
                  if (submap !== void 0 && pane.activeFile !== void 0) {
                    const target = pageFilePath(cfg.file, submap);
                    const files = filesOf(pane);
                    if (files.includes(target) && target !== pane.activeFile) {
                      pane = pushDive(pane, pane.activeFile);
                      handSwitch(target);
                    } else if (!files.includes(target)) {
                      flash = { text: `submap "${submap}" has no page yet`, until: now + FLASH_ACK_MS };
                    }
                  }
                  lastClick = void 0;
                } else {
                  lastClick = id !== void 0 ? { id, at: now } : void 0;
                }
                selectedId = id;
              }
              dirty = true;
            }
            dragAnchor = void 0;
            press = void 0;
            break;
          case "next-page":
          case "prev-page": {
            const top = topFiles();
            if (top.length > 0 && pane.activeFile !== void 0) {
              const current = top.indexOf(pane.activeFile);
              const step = event.kind === "next-page" ? 1 : -1;
              const target = top[(current + step + top.length) % top.length];
              if (target !== pane.activeFile) {
                handSwitch(target);
                dirty = true;
              }
            }
            break;
          }
          case "page": {
            const target = topFiles()[event.index];
            if (target !== void 0 && target !== pane.activeFile) {
              handSwitch(target);
              dirty = true;
            }
            break;
          }
          case "back":
            if (climbBack()) dirty = true;
            break;
          case "follow-toggle":
            pane = toggleFollow(pane);
            flash = { text: pane.follow ? "auto-follow on" : "auto-follow off", until: Date.now() + FLASH_ACK_MS };
            dirty = true;
            break;
        }
      }
      if (dirty) paint2();
    });
    process.stdout.on("resize", handleResize);
  }
  tick();
  setInterval(tick, cfg.intervalMs);
  if (interactive) {
    setInterval(() => {
      if (map !== void 0) return;
      splashTick++;
      paint2();
    }, SPLASH_FRAME_MS);
  }
}
function launchedAsEntry(argv1, moduleUrl) {
  if (argv1 === void 0) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return pathToFileURL(argv1).href === moduleUrl;
  }
}
if (launchedAsEntry(process.argv[1], import.meta.url)) {
  main();
}
export {
  PANEL_ROWS_MIN,
  USAGE,
  WAVE_LEVELS,
  WAVE_NUMBER,
  anchorOffsets,
  clampPanelRows,
  describeArgsError,
  describePageFault,
  diveOrigin,
  dividerRow,
  elapsedLabel,
  fitWidth,
  launchedAsEntry,
  liveRipples,
  mapPanel,
  nearestHit,
  nodePanel,
  pageTabRow,
  panelRowsFromDividerY,
  parseArgs,
  readPage,
  renderWindow,
  splashFrame,
  tabScrollFor,
  terminalRestoreSequence,
  topLevelFiles,
  usableColumns,
  waitingInfo,
  waveAt,
  waveHash,
  waveLevel,
  wrapWidth
};
