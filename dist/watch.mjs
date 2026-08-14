#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/watch/watch.ts
import { realpathSync, statSync } from "node:fs";
import { join as join2 } from "node:path";
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
      return `layer "${e.id}" still holds node "${e.occupant}"; move or remove its nodes first`;
    case "layer-holds-group":
      return `layer "${e.id}" still holds group "${e.occupant}"; remove its groups first`;
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
function setTitle(map, title) {
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
  const { group: currentGroup, kind: currentKind, lane: currentLane, submap: currentSubmap, ...bare } = node;
  const nextGroup = input.group === void 0 ? currentGroup : input.group === null ? void 0 : input.group;
  const nextKind = input.kind === void 0 ? currentKind : input.kind === null ? void 0 : input.kind;
  const nextLane = input.lane === void 0 ? currentLane : input.lane === null ? void 0 : input.lane;
  const nextSubmap = input.submap === void 0 ? currentSubmap : input.submap === null ? void 0 : input.submap;
  const updated = {
    ...bare,
    ...nextGroup !== void 0 ? { group: nextGroup } : {},
    ...nextKind !== void 0 ? { kind: nextKind } : {},
    ...nextLane !== void 0 ? { lane: nextLane } : {},
    ...nextSubmap !== void 0 ? { submap: nextSubmap } : {},
    ...input.status !== void 0 ? { status: input.status } : {},
    ...input.label !== void 0 ? { label: input.label } : {},
    ...input.evidence !== void 0 ? { evidence: input.evidence } : {},
    ...input.detail !== void 0 ? { detail: input.detail } : {}
  };
  return ok({ ...map, nodes: map.nodes.map((n) => n.id === input.id ? updated : n) });
}

// src/render/render.ts
var ZOOM_MIN = -4;
var ZOOM_MAX = 2;
var ZOOM_DEFAULT = 0;
function clampZoom(n) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n)));
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
var WIDE_RANGES = [
  [4352, 4447],
  // Hangul Jamo
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
  [131072, 262141]
  // CJK extension planes
];
function charWidth(cp) {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp >= lo && cp <= hi) return 2;
  }
  return 1;
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
var SGR = {
  none: "",
  dim: "2",
  amber: "33",
  green: "32",
  red: "31",
  faint: "90"
};
var ANSI_RESET = "\x1B[0m";
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
      const c = this.cell(cx, y);
      c.literal = ch;
      c.style = style;
      c.bold = bold;
      const w = charWidth(ch.codePointAt(0));
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
var SPINNER_UNICODE = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var SPINNER_ASCII = ["|", "/", "-", "\\"];
function skinFor(status, unicode) {
  const style = status === "planned" ? "dim" : status === "in-progress" ? "amber" : status === "done" ? "green" : "red";
  if (!unicode) {
    return status === "planned" ? { h: ".", v: ":", corners: ["+", "+", "+", "+"], style } : { h: "-", v: "|", corners: ["+", "+", "+", "+"], style };
  }
  switch (status) {
    case "planned":
      return { h: "\u254C", v: "\u254E", corners: ["\u256D", "\u256E", "\u2570", "\u256F"], style };
    case "in-progress":
      return { h: "\u2500", v: "\u2502", corners: ["\u256D", "\u256E", "\u2570", "\u256F"], style };
    case "done":
    case "regressed":
      return { h: "\u2501", v: "\u2503", corners: ["\u250F", "\u2513", "\u2517", "\u251B"], style };
  }
}
function glyphFor(status, opts) {
  const spinner = opts.unicode ? SPINNER_UNICODE : SPINNER_ASCII;
  switch (status) {
    case "planned":
      return opts.unicode ? "\xB7" : ".";
    case "in-progress":
      return spinner[opts.spinnerFrame % spinner.length];
    case "done":
      return opts.unicode ? "\u25A0" : "#";
    case "regressed":
      return opts.unicode ? "\u2717" : "X";
  }
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
function isNeutralKind(map) {
  return map.kind !== void 0 && map.kind !== "dev";
}
function neutralSkin(unicode) {
  return unicode ? { h: "\u2500", v: "\u2502", corners: ["\u256D", "\u256E", "\u2570", "\u256F"], style: "none" } : { h: "-", v: "|", corners: ["+", "+", "+", "+"], style: "none" };
}
var BOX_H = 3;
var BOX_GAP = 2;
var LEFT_MARGIN = 2;
var DETAIL_BUDGET = { innerMin: 22, innerMax: 32, noteRows: 3 };
var DETAIL_PLUS_BUDGET = { innerMin: 30, innerMax: 48, noteRows: 12 };
function zoomGeometry(zoom) {
  switch (zoom) {
    case 2:
      return { mode: "detail", scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false, detail: DETAIL_PLUS_BUDGET };
    case 1:
      return { mode: "detail", scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false, detail: DETAIL_BUDGET };
    case 0:
      return { mode: "boxes", scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -1:
      return { mode: "boxes", scale: 0.85, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
    case -2:
      return { mode: "boxes", scale: 0.7, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: false };
    case -3:
      return { mode: "boxes", scale: 0.55, pad: 0, boxGap: 1, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
    case -4:
      return { mode: "constellation", scale: 0, pad: 0, boxGap: BOX_GAP, breathe: 0, titleGap: 0, barGap: 1, bandCounts: true };
  }
}
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
function renderMapWindow(map, opts, viewport) {
  const built = buildCanvas(map, opts);
  return {
    lines: built.canvas.emit(opts, viewport),
    contentWidth: built.canvas.width,
    contentHeight: built.canvas.height,
    hits: built.hits
  };
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
function flipForSequence(map) {
  if (map.kind !== "sequence") return map;
  return {
    ...map,
    layers: map.layers.map((l) => ({ ...l, rank: -l.rank })),
    edges: map.edges.map((e) => ({ from: e.to, to: e.from, ...e.label !== void 0 ? { label: e.label } : {} }))
  };
}
function buildCanvas(map, opts) {
  const oriented = flipForSequence(map);
  const plainGeo = zoomGeometry(opts.zoom ?? ZOOM_DEFAULT);
  const aggregated = plainGeo.mode === "constellation" ? aggregateMap(oriented) : void 0;
  return buildCanvasWith(aggregated ?? oriented, opts, aggregated !== void 0 ? AGGREGATE_GEO : plainGeo);
}
function buildCanvasWith(map, opts, geo) {
  const canvas = new Canvas();
  const neutral = isNeutralKind(map);
  const bands = [...map.layers].sort((a, b) => b.rank - a.rank);
  if (bands.length === 0) {
    canvas.text(0, 0, map.title ?? "mellos mapping", "none", true);
    canvas.text(0, 2, "(empty map \u2014 declare layers and nodes to begin)", "dim");
    return { canvas, hits: [] };
  }
  const bandIndexOf = new Map(bands.map((l, i) => [l.id, i]));
  const boxes = /* @__PURE__ */ new Map();
  const bandBoxes = bands.map(() => []);
  for (const node of map.nodes) {
    const band = bandIndexOf.get(node.layer);
    const box = { node, ...boxSpec(node, geo, opts.unicode, neutral), x: LEFT_MARGIN, y: 0 };
    bandBoxes[band].push(box);
    boxes.set(node.id, box);
  }
  const laneCount = map.lanes.length;
  const laneX = [];
  const laneW = [];
  if (laneCount === 0) {
    for (const row of bandBoxes) {
      let x = LEFT_MARGIN;
      for (const box of row) {
        box.x = x;
        x += box.w + geo.boxGap;
      }
    }
  } else {
    const laneGap = geo.boxGap + 2;
    const laneIndexOf = new Map(map.lanes.map((l, i) => [l.id, i]));
    const regions = laneCount + 1;
    const grouped = bandBoxes.map((row) => {
      const cells = Array.from({ length: regions }, () => []);
      for (const box of row) {
        const lane = box.node.lane;
        cells[lane !== void 0 ? laneIndexOf.get(lane) : regions - 1].push(box);
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
      laneX.push(x0);
      laneW.push(regionW[i]);
      x0 += regionW[i] + laneGap;
    }
    for (const cells of grouped) {
      for (let i = 0; i < regions; i++) {
        let x = laneX[i];
        for (const box of cells[i]) {
          box.x = x;
          x += box.w + geo.boxGap;
        }
      }
    }
  }
  const bandLabel = bands.map((l, i) => {
    const row = bandBoxes[i];
    const done = row.filter((b) => b.node.status === "done").length;
    return geo.bandCounts && row.length > 0 && !neutral ? ` ${l.name} ${done}/${row.length}` : ` ${l.name}`;
  });
  let contentWidth = LEFT_MARGIN;
  for (const row of bandBoxes) {
    const last = row[row.length - 1];
    if (last) contentWidth = Math.max(contentWidth, last.x + last.w);
  }
  for (let i = 0; i < laneCount; i++) contentWidth = Math.max(contentWidth, laneX[i] + laneW[i]);
  for (const label of bandLabel) contentWidth = Math.max(contentWidth, LEFT_MARGIN + displayWidth(label) + 7);
  const routes = map.edges.map((e) => {
    const fromBox = boxes.get(e.from);
    const toBox = boxes.get(e.to);
    return {
      fromBox,
      toBox,
      fromBand: bandIndexOf.get(fromBox.node.layer),
      toBand: bandIndexOf.get(toBox.node.layer)
    };
  });
  const claimedColumns = /* @__PURE__ */ new Map();
  const isFree = (box, x) => !(claimedColumns.get(box)?.has(x) ?? false);
  const claim = (box, x) => {
    let set = claimedColumns.get(box);
    if (!set) claimedColumns.set(box, set = /* @__PURE__ */ new Set());
    set.add(x);
    return x;
  };
  const straightX = /* @__PURE__ */ new Map();
  for (const r of routes) {
    if (r.toBand - r.fromBand !== 1) continue;
    const lo = Math.max(r.fromBox.x + 1, r.toBox.x + 1);
    const hi = Math.min(r.fromBox.x + r.fromBox.w - 2, r.toBox.x + r.toBox.w - 2);
    if (lo > hi) continue;
    const mid = Math.floor((lo + hi) / 2);
    for (let d = 0; d <= hi - lo && !straightX.has(r); d++) {
      for (const x of d === 0 ? [mid] : [mid - d, mid + d]) {
        if (x >= lo && x <= hi && isFree(r.fromBox, x) && isFree(r.toBox, x)) {
          straightX.set(r, claim(r.toBox, claim(r.fromBox, x)));
          break;
        }
      }
    }
  }
  const bent = routes.filter((r) => !straightX.has(r));
  const outgoing = /* @__PURE__ */ new Map();
  const incoming = /* @__PURE__ */ new Map();
  for (const r of bent) {
    outgoing.set(r.fromBox, [...outgoing.get(r.fromBox) ?? [], r]);
    incoming.set(r.toBox, [...incoming.get(r.toBox) ?? [], r]);
  }
  const freeSlot = (box, k, n) => {
    const lo = box.x + 1;
    const hi = box.x + box.w - 2;
    const ideal = box.x + Math.min(box.w - 2, Math.max(1, Math.round((k + 1) * (box.w - 1) / (n + 1))));
    for (let d = 0; d <= hi - lo; d++) {
      for (const x of d === 0 ? [ideal] : [ideal - d, ideal + d]) {
        if (x >= lo && x <= hi && isFree(box, x)) return claim(box, x);
      }
    }
    return ideal;
  };
  const attach = /* @__PURE__ */ new Map();
  for (const r of bent) {
    const outs = outgoing.get(r.fromBox);
    const ins = incoming.get(r.toBox);
    attach.set(r, {
      sx: freeSlot(r.fromBox, outs.indexOf(r), outs.length),
      ex: freeSlot(r.toBox, ins.indexOf(r), ins.length)
    });
  }
  const skipRoutes = bent.filter((r) => r.toBand - r.fromBand > 1);
  const usedDescent = /* @__PURE__ */ new Set();
  const descentX = /* @__PURE__ */ new Map();
  let fallbackCount = 0;
  const blockedByBox = (band, x) => bandBoxes[band].some((b) => x >= b.x && x <= b.x + b.w - 1);
  for (const r of skipRoutes) {
    const { ex } = attach.get(r);
    let chosen;
    for (let d = 0; d <= contentWidth && chosen === void 0; d++) {
      for (const c of d === 0 ? [ex] : [ex - d, ex + d]) {
        if (c < LEFT_MARGIN || c > contentWidth + 1 || usedDescent.has(c)) continue;
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
    descentX.set(r, chosen);
  }
  const totalWidth = fallbackCount > 0 ? contentWidth + 2 + fallbackCount * 2 : contentWidth;
  const gapCount = bands.length - 1;
  const gapSegments = Array.from({ length: gapCount }, () => []);
  const segmentOf = /* @__PURE__ */ new Map();
  for (const r of bent) {
    const { sx, ex } = attach.get(r);
    if (r.toBand - r.fromBand === 1) {
      const landing = { route: r, kind: "landing", lo: Math.min(sx, ex), hi: Math.max(sx, ex) };
      gapSegments[r.toBand - 1].push(landing);
      segmentOf.set(r, { landing });
    } else {
      const c = descentX.get(r);
      const exit = { route: r, kind: "exit", lo: Math.min(sx, c), hi: Math.max(sx, c) };
      const landing = { route: r, kind: "landing", lo: Math.min(c, ex), hi: Math.max(c, ex) };
      gapSegments[r.fromBand].push(exit);
      gapSegments[r.toBand - 1].push(landing);
      segmentOf.set(r, { exit, landing });
    }
  }
  const segmentRow = /* @__PURE__ */ new Map();
  const gapRowCount = gapSegments.map((segments) => {
    const rowEnds = [];
    for (const s of [...segments].sort((a, b) => a.lo - b.lo)) {
      let row = rowEnds.findIndex((end) => s.lo > end + 1);
      if (row === -1) {
        rowEnds.push(s.hi);
        row = rowEnds.length - 1;
      } else {
        rowEnds[row] = Math.max(rowEnds[row], s.hi);
      }
      segmentRow.set(s, row);
    }
    return rowEnds.length;
  });
  let y = 0;
  if (map.title !== void 0) y += 1 + geo.titleGap;
  let laneHeaderY;
  if (laneCount > 0) {
    laneHeaderY = y;
    y += 1 + geo.barGap;
  }
  const barY = [];
  const gapTrackStartY = [];
  for (let b = 0; b < bands.length; b++) {
    barY.push(y);
    y += 1 + geo.barGap;
    const row = bandBoxes[b];
    for (const box of row) box.y = y;
    y += row.reduce((max, box) => Math.max(max, box.h), geo.mode === "constellation" ? 1 : BOX_H);
    if (b < gapCount) {
      y += geo.breathe;
      gapTrackStartY.push(y);
      y += gapRowCount[b];
      y += geo.breathe;
    }
  }
  const legendY = y + 1;
  const rowYOf = (gap, s) => gapTrackStartY[gap] + segmentRow.get(s);
  if (map.title !== void 0) canvas.text(LEFT_MARGIN, 0, map.title, "none", true);
  if (laneHeaderY !== void 0) {
    for (let i = 0; i < laneCount; i++) {
      const label = fitWidth(map.lanes[i].label, laneW[i]);
      const cx = laneX[i] + Math.max(0, Math.floor((laneW[i] - displayWidth(label)) / 2));
      canvas.text(cx, laneHeaderY, label, "faint", true);
    }
  }
  for (let b = 0; b < bands.length; b++) {
    const label = bandLabel[b];
    for (let x = 0; x < totalWidth; x++) canvas.line(x, barY[b], LEFT | RIGHT, true);
    const labelStart = (fallbackCount > 0 ? contentWidth : totalWidth) - displayWidth(label);
    canvas.text(labelStart, barY[b], label, "none", true);
  }
  for (const box of boxes.values()) {
    drawBox(canvas, box, opts, neutral, opts.focus !== void 0 && box.node.id === opts.focus);
  }
  for (const r of routes) {
    const sy = r.fromBox.y + r.fromBox.h - 1;
    const ey = r.toBox.y;
    const bright = opts.focus !== void 0 && (r.fromBox.node.id === opts.focus || r.toBox.node.id === opts.focus);
    const direct = straightX.get(r);
    if (direct !== void 0) {
      drawPath(
        canvas,
        [
          [direct, sy],
          [direct, ey]
        ],
        bright
      );
      continue;
    }
    const { sx, ex } = attach.get(r);
    const segments = segmentOf.get(r);
    const landingY = rowYOf(r.toBand - 1, segments.landing);
    if (r.toBand - r.fromBand === 1) {
      drawPath(
        canvas,
        [
          [sx, sy],
          [sx, landingY],
          [ex, landingY],
          [ex, ey]
        ],
        bright
      );
    } else {
      const c = descentX.get(r);
      const exitY = rowYOf(r.fromBand, segments.exit);
      drawPath(
        canvas,
        [
          [sx, sy],
          [sx, exitY],
          [c, exitY],
          [c, landingY],
          [ex, landingY],
          [ex, ey]
        ],
        bright
      );
    }
  }
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
  } else {
    const legendOpts = { ...opts, spinnerFrame: 0 };
    const legendEntries = [
      ["planned", "dim"],
      ["in-progress", "amber"],
      ["done", "green"],
      ["regressed", "red"]
    ];
    for (const [status, style] of legendEntries) {
      if (lx > LEFT_MARGIN) lx = canvas.text(lx, legendY, "   ", "none");
      lx = canvas.text(lx, legendY, `${glyphFor(status, legendOpts)} ${status}`, style);
    }
  }
  const hits = [...boxes.values()].map((b) => ({
    id: b.node.id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h
  }));
  return { canvas, hits };
}
function drawBox(canvas, box, opts, neutral, focused = false) {
  const { node, x, y, w } = box;
  const skin = neutral ? neutralSkin(opts.unicode) : skinFor(node.status, opts.unicode);
  const slotGlyph = neutral ? (node.kind !== void 0 ? kindGlyph(node.kind, opts.unicode) : void 0) ?? (opts.unicode ? "\xB7" : ".") : glyphFor(node.status, opts);
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

// src/store/store.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
var STATE_FILE_VERSION = 1;
var STATE_FILE_RELATIVE_PATH = join(".claude", "mellos-mapping.json");
var PAGES_DIR_NAME = "mellos-mapping.pages";
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
  }
}
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function optionalString(v) {
  return typeof v === "string" ? v : void 0;
}
function parseMap(raw, path) {
  if (!isRecord(raw)) return err({ kind: "bad-shape", path, detail: "root is not an object" });
  if (raw["version"] !== STATE_FILE_VERSION) {
    return err({ kind: "bad-shape", path, detail: `version is ${String(raw["version"])}, expected ${STATE_FILE_VERSION}` });
  }
  let map = EMPTY_MAP;
  const title = optionalString(raw["title"]);
  if (title !== void 0) map = setTitle(map, title);
  const rawKind = optionalString(raw["kind"]);
  if (rawKind !== void 0) {
    const kind = makeMapKind(rawKind);
    if (!kind.ok) return err({ kind: "invariant-violation", path, violation: kind.error });
    map = setKind(map, kind.value);
  }
  for (const [i, rawLayer] of asArray(raw["layers"]).entries()) {
    if (!isRecord(rawLayer)) return err({ kind: "bad-shape", path, detail: `layers[${i}] is not an object` });
    const id = makeLayerId(String(rawLayer["id"] ?? ""));
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const name = optionalString(rawLayer["name"]);
    const rank = rawLayer["rank"];
    if (name === void 0 || typeof rank !== "number" || !Number.isInteger(rank)) {
      return err({ kind: "bad-shape", path, detail: `layers[${i}] needs a string name and an integer rank` });
    }
    const next = declareLayer(map, { id: id.value, name, rank });
    if (!next.ok) return err({ kind: "invariant-violation", path, violation: next.error });
    map = next.value;
  }
  for (const [i, rawLane] of asArray(raw["lanes"]).entries()) {
    if (!isRecord(rawLane)) return err({ kind: "bad-shape", path, detail: `lanes[${i}] is not an object` });
    const id = makeLaneId(String(rawLane["id"] ?? ""));
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const label = optionalString(rawLane["label"]);
    if (label === void 0) return err({ kind: "bad-shape", path, detail: `lanes[${i}] needs a string label` });
    const declared = declareLane(map, { id: id.value, label });
    if (!declared.ok) return err({ kind: "invariant-violation", path, violation: declared.error });
    map = declared.value;
  }
  for (const [i, rawGroup] of asArray(raw["groups"]).entries()) {
    if (!isRecord(rawGroup)) return err({ kind: "bad-shape", path, detail: `groups[${i}] is not an object` });
    const id = makeGroupId(String(rawGroup["id"] ?? ""));
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const layer = makeLayerId(String(rawGroup["layer"] ?? ""));
    if (!layer.ok) return err({ kind: "invariant-violation", path, violation: layer.error });
    const label = optionalString(rawGroup["label"]);
    if (label === void 0) return err({ kind: "bad-shape", path, detail: `groups[${i}] needs a string label` });
    const declared = declareGroup(map, { id: id.value, label, layer: layer.value });
    if (!declared.ok) return err({ kind: "invariant-violation", path, violation: declared.error });
    map = declared.value;
  }
  for (const [i, rawNode] of asArray(raw["nodes"]).entries()) {
    if (!isRecord(rawNode)) return err({ kind: "bad-shape", path, detail: `nodes[${i}] is not an object` });
    const id = makeNodeId(String(rawNode["id"] ?? ""));
    if (!id.ok) return err({ kind: "invariant-violation", path, violation: id.error });
    const layer = makeLayerId(String(rawNode["layer"] ?? ""));
    if (!layer.ok) return err({ kind: "invariant-violation", path, violation: layer.error });
    const status = makeNodeStatus(String(rawNode["status"] ?? ""));
    if (!status.ok) return err({ kind: "invariant-violation", path, violation: status.error });
    const label = optionalString(rawNode["label"]);
    if (label === void 0) return err({ kind: "bad-shape", path, detail: `nodes[${i}] needs a string label` });
    const detail = optionalString(rawNode["detail"]);
    const rawGroup = optionalString(rawNode["group"]);
    let group;
    if (rawGroup !== void 0) {
      const made = makeGroupId(rawGroup);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      group = made.value;
    }
    const rawNodeKind = optionalString(rawNode["kind"]);
    let nodeKind;
    if (rawNodeKind !== void 0) {
      const made = makeNodeKind(rawNodeKind);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      nodeKind = made.value;
    }
    const rawLane = optionalString(rawNode["lane"]);
    let lane;
    if (rawLane !== void 0) {
      const made = makeLaneId(rawLane);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      lane = made.value;
    }
    const rawSubmap = optionalString(rawNode["submap"]);
    let submap;
    if (rawSubmap !== void 0) {
      const made = makeSubmapRef(rawSubmap);
      if (!made.ok) return err({ kind: "invariant-violation", path, violation: made.error });
      submap = made.value;
    }
    const declared = declareNode(map, {
      id: id.value,
      label,
      layer: layer.value,
      status: status.value,
      ...detail !== void 0 ? { detail } : {},
      ...group !== void 0 ? { group } : {},
      ...nodeKind !== void 0 ? { kind: nodeKind } : {},
      ...lane !== void 0 ? { lane } : {},
      ...submap !== void 0 ? { submap } : {}
    });
    if (!declared.ok) return err({ kind: "invariant-violation", path, violation: declared.error });
    map = declared.value;
    const evidence = optionalString(rawNode["evidence"]);
    if (evidence !== void 0) {
      const updated = updateNode(map, { id: id.value, evidence });
      if (!updated.ok) return err({ kind: "invariant-violation", path, violation: updated.error });
      map = updated.value;
    }
  }
  for (const [i, rawEdge] of asArray(raw["edges"]).entries()) {
    if (!isRecord(rawEdge)) return err({ kind: "bad-shape", path, detail: `edges[${i}] is not an object` });
    const from = makeNodeId(String(rawEdge["from"] ?? ""));
    if (!from.ok) return err({ kind: "invariant-violation", path, violation: from.error });
    const to = makeNodeId(String(rawEdge["to"] ?? ""));
    if (!to.ok) return err({ kind: "invariant-violation", path, violation: to.error });
    const linked = linkNodes(map, from.value, to.value, optionalString(rawEdge["label"]));
    if (!linked.ok) return err({ kind: "invariant-violation", path, violation: linked.error });
    map = linked.value;
  }
  return ok(map);
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
    raw = JSON.parse(text);
  } catch (e) {
    return err({ kind: "malformed-json", path, detail: e.message });
  }
  return parseMap(raw, path);
}

// src/watch/input.ts
var KEY_H_STEP = 4;
var KEY_V_STEP = 2;
var WHEEL_V_STEP = 3;
var MOTION = 32;
var WHEEL = 64;
var SHIFT = 4;
var BUTTON_BITS = 3;
var SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
var ARROW = /^\x1b\[([ABCD])/;
var SHIFT_TAB = /^\x1b\[Z/;
var PARTIAL_ESCAPE = /(?:\x1b|\x1b\[|\x1b\[<[\d;]*)$/;
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
    const down = (code & 1) !== 0;
    return code & SHIFT ? { kind: "pan", dx: 0, dy: (down ? 1 : -1) * WHEEL_V_STEP } : { kind: "zoom", delta: down ? -1 : 1, at: { x, y } };
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
  if (chunk === "\x1B") return { events: [{ kind: "clear" }], rest: "" };
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
    const partial = PARTIAL_ESCAPE.exec(slice);
    if (partial && partial.index === 0) {
      return { events, rest: slice };
    }
    const ch = chunk[i];
    if (ch === "q" || ch === "Q" || ch === "" || ch === "") events.push({ kind: "quit" });
    else if (ch === "0") events.push({ kind: "reset" });
    else if (ch === "+" || ch === "=") events.push({ kind: "zoom", delta: 1 });
    else if (ch === "-") events.push({ kind: "zoom", delta: -1 });
    else if (ch === "	") events.push({ kind: "next-page" });
    else if (ch === "\x7F" || ch === "\b") events.push({ kind: "back" });
    else if (ch >= "1" && ch <= "9") events.push({ kind: "page", index: ch.charCodeAt(0) - "1".charCodeAt(0) });
    else if (KEY_PAN[ch]) events.push({ kind: "pan", ...KEY_PAN[ch] });
    i += 1;
  }
  return { events, rest: "" };
}

// src/watch/watch.ts
function parseArgs(argv, cwd) {
  let file = join2(cwd, STATE_FILE_RELATIVE_PATH);
  let intervalMs = 250;
  let unicode = true;
  let color = true;
  let mouse = true;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--file":
        file = argv[++i] ?? file;
        break;
      case "--interval":
        intervalMs = Math.max(50, Number(argv[++i]) || intervalMs);
        break;
      case "--ascii":
        unicode = false;
        break;
      case "--no-color":
        color = false;
        break;
      case "--no-mouse":
        mouse = false;
        break;
      default:
        break;
    }
  }
  return { file, intervalMs, unicode, color, mouse };
}
var HIDE_CURSOR = "\x1B[?25l";
var SHOW_CURSOR = "\x1B[?25h";
var CLEAR_ALL = "\x1B[H\x1B[2J";
var HOME = "\x1B[H";
var ERASE_LINE_END = "\x1B[K";
var MOUSE_ON = "\x1B[?1003h\x1B[?1006h";
var MOUSE_OFF = "\x1B[?1003l\x1B[?1006l";
var RESET = "\x1B[0m";
var PANEL_CONTENT_ROWS = 6;
var PANEL_ROWS_MIN = 2;
var MAP_ROWS_MIN = 4;
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
var STATUS_GLYPH = {
  planned: ["\xB7", "."],
  "in-progress": ["\u283F", "*"],
  done: ["\u25A0", "#"],
  regressed: ["\u2717", "X"]
};
var STATUS_SGR = {
  planned: "2",
  "in-progress": "33",
  done: "32",
  regressed: "31"
};
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
    const glyph = STATUS_GLYPH[tab.status][unicode ? 0 : 1];
    return tab.neutral === true ? ` ${marker} ${tab.title} ` : ` ${marker} ${glyph} ${tab.title} `;
  });
  const sgrOf = (tab) => tab.neutral === true ? tab.active ? "1" : tab.fresh ? "36" : "90" : tab.active ? `${STATUS_SGR[tab.status]};1` : tab.fresh ? STATUS_SGR[tab.status] : "90";
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
function topLevelFiles(defaultFile, files, mapOf) {
  const refs = /* @__PURE__ */ new Set();
  for (const m of mapOf.values()) {
    for (const n of m?.nodes ?? []) if (n.submap !== void 0) refs.add(n.submap);
  }
  return files.filter((f) => {
    const id = pageIdOfFile(defaultFile, f);
    return id === void 0 || !refs.has(id);
  });
}
function diveOrigin(defaultFile, file, files, mapOf) {
  const id = pageIdOfFile(defaultFile, file);
  if (id === void 0) return void 0;
  for (const f of files) {
    if (f === file) continue;
    const node = mapOf.get(f)?.nodes.find((n) => n.submap === id);
    if (node !== void 0) return { parent: f, label: node.label };
  }
  return void 0;
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
  const g = (s) => STATUS_GLYPH[s][unicode ? 0 : 1];
  const pinMark = pinned ? unicode ? "  \u2299 pinned" : "  * pinned" : "";
  const group = map.groups.find((gr) => gr.id === focusId);
  if (group) {
    const members = map.nodes.filter((n) => n.group === group.id);
    const memberIds = new Set(members.map((n) => n.id));
    const status = groupStatus(map, group.id);
    const layerName2 = map.layers.find((l) => l.id === group.layer)?.name ?? group.layer;
    const [right2, left2] = unicode ? ["\u2192", "\u2190"] : ["->", "<-"];
    const repLabel = (id) => {
      const n = map.nodes.find((x) => x.id === id);
      const owner = n.group !== void 0 ? map.groups.find((gr) => gr.id === n.group) : void 0;
      return owner !== void 0 ? `${g(groupStatus(map, owner.id))} ${owner.label}` : `${g(n.status)} ${n.label}`;
    };
    const uses2 = [
      ...new Set(
        map.edges.filter((e) => memberIds.has(e.from) && !memberIds.has(e.to)).map((e) => repLabel(e.to))
      )
    ];
    const usedBy2 = [
      ...new Set(
        map.edges.filter((e) => memberIds.has(e.to) && !memberIds.has(e.from)).map((e) => repLabel(e.from))
      )
    ];
    const lines2 = [
      {
        text: fitWidth(
          `${g(status)} ${group.label} [${group.id}] \xB7 ${layerName2} \xB7 ${status} \xB7 ${members.length} member(s)${pinMark}`,
          width
        ),
        sgr: `${STATUS_SGR[status]};1`
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
  const node = map.nodes.find((n) => n.id === focusId);
  if (!node) return void 0;
  const neutral = isNeutralKind(map);
  const layerName = map.layers.find((l) => l.id === node.layer)?.name ?? node.layer;
  const [right, left] = unicode ? ["\u2192", "\u2190"] : ["->", "<-"];
  const withGlyph = (id) => {
    const n = map.nodes.find((x) => x.id === id);
    return n ? `${g(n.status)} ${n.label}` : id;
  };
  const withEdgeLabel = (base, label) => label !== void 0 ? `${base} (${label})` : base;
  const uses = map.edges.filter((e) => e.from === node.id).map((e) => withEdgeLabel(withGlyph(e.to), e.label));
  const usedBy = map.edges.filter((e) => e.to === node.id).map((e) => withEdgeLabel(withGlyph(e.from), e.label));
  const pin = pinned ? unicode ? "  \u2299 pinned" : "  * pinned" : "";
  const headGlyph = neutral ? (node.kind !== void 0 ? kindGlyph(node.kind, unicode) : void 0) ?? (unicode ? "\xB7" : ".") : g(node.status);
  const laneLabel = node.lane !== void 0 ? map.lanes.find((l) => l.id === node.lane)?.label : void 0;
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
      sgr: neutral ? "1" : `${STATUS_SGR[node.status]};1`
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
var SPLASH_FONT = {
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  E: ["####", "#", "###", "#", "####"],
  L: ["#", "#", "#", "#", "####"],
  O: [" ###", "#   #", "#   #", "#   #", " ###"],
  S: [" ####", "#", " ###", "    #", "####"],
  A: [" ###", "#   #", "#####", "#   #", "#   #"],
  P: ["####", "#   #", "####", "#", "#"],
  I: ["###", " #", " #", " #", "###"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  G: [" ####", "#", "#  ##", "#   #", " ###"]
};
var SPLASH_ROWS = 5;
var SPLASH_SHADES = {
  unicode: ["\u2591", "\u2591", "\u2592", "\u2592", "\u2593", "\u2593", "\u2588", "\u2588"],
  ascii: [".", ".", ":", ":", "=", "=", "#", "#"]
};
var WAVE_RAMP = [17, 18, 19, 61, 24, 25, 31, 37, 44, 45, 51, 87, 123, 159, 195];
var SPINNER_FRAMES = {
  unicode: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"],
  ascii: ["|", "/", "-", "\\"]
};
function wordArt(word) {
  const glyphs = [...word.toUpperCase()].map((ch) => SPLASH_FONT[ch]).filter((g) => g !== void 0);
  const widths = glyphs.map((g) => Math.max(...g.map((r) => r.length)));
  const rows = [];
  for (let r = 0; r < SPLASH_ROWS; r++) {
    rows.push(glyphs.map((g, i) => (g[r] ?? "").padEnd(widths[i], " ")).join(" "));
  }
  return rows;
}
function splashArt() {
  const words = [wordArt("MELLOS"), wordArt("MAPPING")];
  const width = Math.max(...words.flat().map((r) => r.length));
  const centered = words.map((rows) => {
    const own = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => " ".repeat(Math.floor((width - own) / 2)) + r);
  });
  return [...centered[0], "", ...centered[1]];
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
function splashFrame(notice, frame, width, height, unicode, color) {
  const art = splashArt();
  const artWidth = Math.max(...art.map((r) => r.length));
  if (width < artWidth + 2 || height < art.length + 2) return void 0;
  const mode = unicode ? "unicode" : "ascii";
  const shades = SPLASH_SHADES[mode];
  const solid = shades[shades.length - 1];
  const indent = " ".repeat(Math.floor((width - artWidth) / 2));
  const ripples = liveRipples(frame, artWidth, art.length);
  const inkOf = (x, y) => {
    const level = waveLevel(waveAt(ripples, x, y));
    return color ? `38;5;${WAVE_RAMP[WAVE_LEVELS + level]}` : shades[Math.abs(level)];
  };
  const paintRow = (row, y) => {
    const cells = [...row].map((ch, x) => ch === "#" ? inkOf(x, y) : void 0);
    let out = "";
    for (let i = 0; i < cells.length; ) {
      const cell = cells[i];
      let j = i;
      while (j < cells.length && cells[j] === cell) j++;
      if (cell === void 0) out += " ".repeat(j - i);
      else out += color ? `\x1B[${cell}m${solid.repeat(j - i)}${RESET}` : cell.repeat(j - i);
      i = j;
    }
    return out;
  };
  const spinner = SPINNER_FRAMES[mode];
  const status = fitWidth(`${spinner[frame % spinner.length]} ${notice}`, Math.max(1, width - 2));
  const statusIndent = " ".repeat(Math.max(0, Math.floor((width - displayWidth(status)) / 2)));
  const block = [
    ...art.map((row, y) => row.trim() === "" ? "" : indent + paintRow(row, y)),
    "",
    statusIndent + (color ? `\x1B[90m${status}${RESET}` : status)
  ];
  return [...Array.from({ length: Math.max(0, Math.floor((height - block.length) / 2)) }, () => ""), ...block];
}
function mapPanel(map, unicode, width, rows = PANEL_CONTENT_ROWS) {
  const g = (s) => STATUS_GLYPH[s][unicode ? 0 : 1];
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
  const cfg = parseArgs(process.argv.slice(2), process.cwd());
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const mouseActive = interactive && cfg.mouse;
  let lastFrame = "";
  let spinnerFrame = 0;
  let splashTick = 0;
  let map;
  let notice = `waiting for ${cfg.file} ...`;
  let lastCols = process.stdout.columns ?? 0;
  let lastRows = process.stdout.rows ?? 0;
  let pageFiles = [cfg.file];
  const pageData = /* @__PURE__ */ new Map();
  const pageViews = /* @__PURE__ */ new Map();
  let activeFile;
  let firstScan = true;
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
  const diveStack = [];
  let flash;
  let lastTabFiles = [];
  const maps = () => new Map([...pageData].map(([f, e]) => [f, e.map]));
  const topFiles = () => topLevelFiles(cfg.file, pageFiles, maps());
  const inSubmap = () => activeFile !== void 0 && !topFiles().includes(activeFile);
  const tabRows = () => topFiles().length > 1 || inSubmap() ? 1 : 0;
  const climbBack = () => {
    let parent = diveStack.pop();
    while (parent !== void 0 && !pageFiles.includes(parent)) parent = diveStack.pop();
    if (parent === void 0 && activeFile !== void 0) {
      parent = diveOrigin(cfg.file, activeFile, pageFiles, maps())?.parent;
    }
    if (parent !== void 0 && parent !== activeFile) {
      switchPage(parent);
      return true;
    }
    return false;
  };
  const viewWidth = () => usableColumns(process.stdout.columns ?? 100);
  const viewHeight = () => Math.max(1, (process.stdout.rows ?? 30) - (1 + panelContentRows) - 1 - tabRows());
  const dividerY = () => tabRows() + viewHeight() + 1;
  const pageTabsOf = (files) => files.map((f) => {
    const m = pageData.get(f)?.map;
    return {
      title: m?.title ?? (pageIdOfFile(cfg.file, f) ?? "main"),
      status: m !== void 0 ? mapStatus(m) : "planned",
      active: f === activeFile,
      fresh: pageData.get(f)?.fresh ?? false,
      neutral: m !== void 0 && isNeutralKind(m)
    };
  });
  const switchPage = (file) => {
    if (activeFile !== void 0) pageViews.set(activeFile, { offsetX, offsetY, zoom, selectedId });
    activeFile = file;
    const view = pageViews.get(file);
    offsetX = view?.offsetX ?? 0;
    offsetY = view?.offsetY ?? 0;
    zoom = view?.zoom ?? ZOOM_DEFAULT;
    selectedId = view?.selectedId;
    hoverId = void 0;
    const entry = pageData.get(file);
    if (entry !== void 0 && entry.fresh) pageData.set(file, { ...entry, fresh: false });
    map = entry?.map;
    notice = map === void 0 ? `waiting for ${file} ...` : "";
    const top = topFiles();
    const tabIndex = top.indexOf(file);
    if (tabIndex >= 0) tabScroll = tabScrollFor(pageTabsOf(top), viewWidth(), cfg.unicode, tabScroll, tabIndex);
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
  const restore = () => {
    process.stdout.write((mouseActive ? MOUSE_OFF : "") + SHOW_CURSOR + "\n");
    process.exit(0);
  };
  process.on("SIGINT", restore);
  process.on("SIGTERM", restore);
  const paint = () => {
    const cols = process.stdout.columns ?? 100;
    const viewW = viewWidth();
    panelContentRows = clampPanelRows(panelContentRows, process.stdout.rows ?? 30, tabRows());
    const viewH = viewHeight();
    const focus = hoverId ?? selectedId;
    let body;
    let panned = "";
    let pannable = false;
    if (map !== void 0) {
      const windowed = renderMapWindow(
        map,
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus, zoom },
        { x: offsetX, y: offsetY, width: viewW, height: viewH }
      );
      const maxX = Math.max(0, windowed.contentWidth - viewW);
      const maxY = Math.max(0, windowed.contentHeight - viewH);
      if (offsetX > maxX || offsetY > maxY || offsetX < 0 || offsetY < 0) {
        offsetX = Math.min(Math.max(0, offsetX), maxX);
        offsetY = Math.min(Math.max(0, offsetY), maxY);
        paint();
        return;
      }
      pannable = maxX > 0 || maxY > 0;
      body = windowed.lines;
      lastHits = windowed.hits;
      lastContent = { w: windowed.contentWidth, h: windowed.contentHeight };
      if (offsetX !== 0 || offsetY !== 0) panned = `  (+${offsetX},+${offsetY})`;
    } else {
      body = (interactive ? splashFrame(notice, splashTick, viewW, viewH, cfg.unicode, cfg.color) : void 0) ?? [fitWidth(notice, viewW)];
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
    const grip = cfg.unicode ? " \u22EF " : " ~ ";
    const bar = (cfg.unicode ? "\u2500" : "-").repeat(viewW);
    const gripAt = Math.max(0, Math.floor((viewW - grip.length) / 2));
    const separator = viewW > grip.length + 2 ? bar.slice(0, gripAt) + grip + bar.slice(gripAt + grip.length) : bar;
    const panelRows = [
      cfg.color ? `\x1B[90m${separator}${RESET}` : separator,
      ...panel.map(
        (l) => cfg.color && l.sgr !== "" && l.text !== "" ? ` \x1B[${l.sgr}m${l.text}${RESET}` : ` ${l.text}`
      )
    ];
    let tabLine;
    lastTabFiles = topFiles();
    if (inSubmap() && activeFile !== void 0) {
      const stackParent = [...diveStack].reverse().find((f) => pageFiles.includes(f));
      const scanned = diveOrigin(cfg.file, activeFile, pageFiles, maps());
      const parentFile = stackParent ?? scanned?.parent;
      const parentTitle = parentFile !== void 0 ? pageData.get(parentFile)?.map?.title ?? (pageIdOfFile(cfg.file, parentFile) ?? "main") : "main";
      const nodeLabel = scanned?.label ?? map?.title ?? "";
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
    paint();
  };
  const tick = () => {
    if ((process.stdout.columns ?? lastCols) !== lastCols || (process.stdout.rows ?? lastRows) !== lastRows) {
      handleResize();
    }
    const discovered = listPageFiles(cfg.file);
    pageFiles = discovered.length > 0 ? discovered : [cfg.file];
    for (const known of [...pageData.keys()]) {
      if (!pageFiles.includes(known)) {
        pageData.delete(known);
        pageViews.delete(known);
      }
    }
    for (const file of pageFiles) {
      let mtimeMs;
      try {
        mtimeMs = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      const entry = pageData.get(file);
      if (mtimeMs === entry?.mtimeMs) continue;
      const loaded = loadMapFile(file);
      if (loaded.ok) {
        const becameFresh = !firstScan && file !== activeFile;
        pageData.set(file, { map: loaded.value, mtimeMs, fresh: becameFresh });
        if (file === activeFile) {
          map = loaded.value;
          notice = "";
        } else if (becameFresh && !topFiles().includes(file)) {
          const title = loaded.value.title ?? (pageIdOfFile(cfg.file, file) ?? "?");
          flash = { text: `${cfg.unicode ? "\u229E " : ""}${title} updated`, until: Date.now() + 4e3 };
        }
      } else if (loaded.error.kind === "malformed-json") {
      } else {
        pageData.set(file, { map: entry?.map, mtimeMs, fresh: entry?.fresh ?? false });
        if (file === activeFile) notice = describeStoreError(loaded.error);
      }
    }
    firstScan = false;
    if (activeFile === void 0 || !pageFiles.includes(activeFile)) switchPage(pageFiles[0]);
    if ([...pageData.values()].some((p) => p.map?.nodes.some((n) => n.status === "in-progress"))) spinnerFrame++;
    if (flash !== void 0 && Date.now() > flash.until) flash = void 0;
    paint();
  };
  if (interactive) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      const parsed = parseInput(pendingInput + chunk);
      pendingInput = parsed.rest;
      let dirty = false;
      for (const event of parsed.events) {
        switch (event.kind) {
          case "quit":
            restore();
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
            const sized = renderMapWindow(
              map,
              { color: false, unicode: cfg.unicode, spinnerFrame: 0, zoom },
              { x: 0, y: 0, width: 0, height: 0 }
            );
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
              const next = panelRowsFromDividerY(event.y, process.stdout.rows ?? 30, tabRows());
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
                  if (target !== void 0 && target !== activeFile) switchPage(target);
                }
              } else {
                const id = hitTest(event.x, event.y);
                const now = Date.now();
                if (id !== void 0 && lastClick?.id === id && now - lastClick.at <= 450) {
                  const submap = map?.nodes.find((n) => n.id === id)?.submap;
                  if (submap !== void 0 && activeFile !== void 0) {
                    const target = pageFilePath(cfg.file, submap);
                    if (pageFiles.includes(target) && target !== activeFile) {
                      diveStack.push(activeFile);
                      switchPage(target);
                    } else if (!pageFiles.includes(target)) {
                      flash = { text: `submap "${submap}" has no page yet`, until: now + 2500 };
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
            if (top.length > 0 && activeFile !== void 0) {
              const current = top.indexOf(activeFile);
              const step = event.kind === "next-page" ? 1 : -1;
              const target = top[(current + step + top.length) % top.length];
              if (target !== activeFile) {
                switchPage(target);
                dirty = true;
              }
            }
            break;
          }
          case "page": {
            const target = topFiles()[event.index];
            if (target !== void 0 && target !== activeFile) {
              switchPage(target);
              dirty = true;
            }
            break;
          }
          case "back":
            if (climbBack()) dirty = true;
            break;
        }
      }
      if (dirty) paint();
    });
    process.stdout.on("resize", handleResize);
  }
  tick();
  setInterval(tick, cfg.intervalMs);
  if (interactive) {
    setInterval(() => {
      if (map !== void 0) return;
      splashTick++;
      paint();
    }, 80);
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
  WAVE_LEVELS,
  WAVE_NUMBER,
  anchorOffsets,
  clampPanelRows,
  diveOrigin,
  fitWidth,
  launchedAsEntry,
  liveRipples,
  mapPanel,
  nearestHit,
  nodePanel,
  pageTabRow,
  panelRowsFromDividerY,
  parseArgs,
  splashArt,
  splashFrame,
  tabScrollFor,
  topLevelFiles,
  usableColumns,
  waveAt,
  waveHash,
  waveLevel,
  wordArt,
  wrapWidth
};
