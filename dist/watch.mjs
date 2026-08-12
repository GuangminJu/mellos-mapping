import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/watch/watch.ts
import { statSync } from "node:fs";
import { join as join2 } from "node:path";
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
var NODE_STATUSES = ["planned", "in-progress", "done", "regressed"];
function makeNodeStatus(raw) {
  return NODE_STATUSES.includes(raw) ? ok(raw) : err({ kind: "invalid-status", raw });
}
var EMPTY_MAP = { layers: [], groups: [], nodes: [], edges: [] };
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
  const node = {
    id: input.id,
    label: input.label,
    layer: input.layer,
    status: input.status ?? "planned",
    ...input.detail !== void 0 ? { detail: input.detail } : {},
    ...input.group !== void 0 ? { group: input.group } : {}
  };
  return ok({ ...map, nodes: [...map.nodes, node] });
}
function linkNodes(map, from, to) {
  if (from === to) return err({ kind: "self-edge", id: from });
  const fromNode = findNode(map, from);
  if (!fromNode) return err({ kind: "unknown-node", id: from });
  const toNode = findNode(map, to);
  if (!toNode) return err({ kind: "unknown-node", id: to });
  if (hasEdge(map, from, to)) return err({ kind: "duplicate-edge", from, to });
  const fromRank = findLayer(map, fromNode.layer).rank;
  const toRank = findLayer(map, toNode.layer).rank;
  if (fromRank <= toRank) return err({ kind: "edge-not-downward", from, fromRank, to, toRank });
  return ok({ ...map, edges: [...map.edges, { from, to }] });
}
function updateNode(map, input) {
  const node = findNode(map, input.id);
  if (!node) return err({ kind: "unknown-node", id: input.id });
  if (input.group !== void 0 && input.group !== null) {
    const bad = checkMembership(map, node.id, node.layer, input.group);
    if (bad) return err(bad);
  }
  const { group: currentGroup, ...bare } = node;
  const nextGroup = input.group === void 0 ? currentGroup : input.group === null ? void 0 : input.group;
  const updated = {
    ...bare,
    ...nextGroup !== void 0 ? { group: nextGroup } : {},
    ...input.status !== void 0 ? { status: input.status } : {},
    ...input.label !== void 0 ? { label: input.label } : {},
    ...input.evidence !== void 0 ? { evidence: input.evidence } : {},
    ...input.detail !== void 0 ? { detail: input.detail } : {}
  };
  return ok({ ...map, nodes: map.nodes.map((n) => n.id === input.id ? updated : n) });
}

// src/render/render.ts
var ZOOM_MIN = -4;
var ZOOM_MAX = 1;
var ZOOM_DEFAULT = 0;
function clampZoom(n) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(n)));
}
function zoomLabel(zoom) {
  switch (zoom) {
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
var BOX_H = 3;
var BOX_GAP = 2;
var LEFT_MARGIN = 2;
function zoomGeometry(zoom) {
  switch (zoom) {
    case 1:
      return { mode: "detail", scale: 1, pad: 1, boxGap: BOX_GAP, breathe: 1, titleGap: 1, barGap: 1, bandCounts: false };
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
var DETAIL_INNER_MIN = 22;
var DETAIL_INNER_MAX = 32;
var DETAIL_NOTE_ROWS = 3;
var LABEL_BUDGET_MIN = 4;
function boxSpec(node, geo) {
  if (geo.mode === "constellation") {
    return { w: 3, h: 1, label: "", pad: 0, borderless: true, extra: [] };
  }
  if (geo.mode === "detail") {
    const innerW = Math.min(Math.max(displayWidth(node.label) + 4, DETAIL_INNER_MIN), DETAIL_INNER_MAX);
    const extra = [];
    if (node.evidence !== void 0) extra.push({ text: fitWidth(` ${node.evidence}`, innerW), style: "faint" });
    if (node.detail !== void 0) {
      const wrapped = wrapWidth(node.detail, innerW - 2);
      for (let i = 0; i < Math.min(wrapped.length, DETAIL_NOTE_ROWS); i++) {
        const cut = i === DETAIL_NOTE_ROWS - 1 && wrapped.length > DETAIL_NOTE_ROWS;
        extra.push({ text: ` ${cut ? fitWidth(wrapped[i] + "\u2026", innerW - 2) : wrapped[i]}`, style: "none" });
      }
    }
    return {
      w: innerW + 2,
      h: BOX_H + extra.length,
      label: fitWidth(node.label, innerW - 4),
      pad: 1,
      borderless: false,
      extra
    };
  }
  const budget = Math.max(LABEL_BUDGET_MIN, Math.ceil(displayWidth(node.label) * geo.scale));
  const label = fitWidth(node.label, budget);
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
      label: `${g.label} ${done}/${members.length}`,
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
  return { ...map.title !== void 0 ? { title: map.title } : {}, layers: map.layers, groups: [], nodes, edges };
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
function buildCanvas(map, opts) {
  const plainGeo = zoomGeometry(opts.zoom ?? ZOOM_DEFAULT);
  const aggregated = plainGeo.mode === "constellation" ? aggregateMap(map) : void 0;
  return buildCanvasWith(aggregated ?? map, opts, aggregated !== void 0 ? AGGREGATE_GEO : plainGeo);
}
function buildCanvasWith(map, opts, geo) {
  const canvas = new Canvas();
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
    const row = bandBoxes[band];
    const prev = row[row.length - 1];
    const box = {
      node,
      ...boxSpec(node, geo),
      x: prev ? prev.x + prev.w + geo.boxGap : LEFT_MARGIN,
      y: 0
    };
    row.push(box);
    boxes.set(node.id, box);
  }
  const bandLabel = bands.map((l, i) => {
    const row = bandBoxes[i];
    const done = row.filter((b) => b.node.status === "done").length;
    return geo.bandCounts && row.length > 0 ? ` ${l.name} ${done}/${row.length}` : ` ${l.name}`;
  });
  let contentWidth = LEFT_MARGIN;
  for (const row of bandBoxes) {
    const last = row[row.length - 1];
    if (last) contentWidth = Math.max(contentWidth, last.x + last.w);
  }
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
  for (let b = 0; b < bands.length; b++) {
    const label = bandLabel[b];
    for (let x = 0; x < totalWidth; x++) canvas.line(x, barY[b], LEFT | RIGHT, true);
    const labelStart = (fallbackCount > 0 ? contentWidth : totalWidth) - displayWidth(label);
    canvas.text(labelStart, barY[b], label, "none", true);
  }
  for (const box of boxes.values()) {
    drawBox(canvas, box, opts, opts.focus !== void 0 && box.node.id === opts.focus);
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
  const legendOpts = { ...opts, spinnerFrame: 0 };
  let lx = LEFT_MARGIN;
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
  const hits = [...boxes.values()].map((b) => ({
    id: b.node.id,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h
  }));
  return { canvas, hits };
}
function drawBox(canvas, box, opts, focused = false) {
  const { node, x, y, w } = box;
  const skin = skinFor(node.status, opts.unicode);
  if (box.borderless) {
    canvas.text(x + 1, y, glyphFor(node.status, opts), skin.style, true);
    return;
  }
  const inner = w - 2;
  const pad = box.pad === 1 ? " " : "";
  canvas.text(x, y, skin.corners[0] + skin.h.repeat(inner) + skin.corners[1], skin.style, focused);
  canvas.text(x, y + 1, skin.v, skin.style, focused);
  canvas.text(x + 1, y + 1, `${pad}${glyphFor(node.status, opts)} ${box.label}${pad}`, skin.style, true);
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
    const declared = declareNode(map, {
      id: id.value,
      label,
      layer: layer.value,
      status: status.value,
      ...detail !== void 0 ? { detail } : {},
      ...group !== void 0 ? { group } : {}
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
    const linked = linkNodes(map, from.value, to.value);
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
    return code & SHIFT ? { kind: "pan", dx: 0, dy: (down ? 1 : -1) * WHEEL_V_STEP } : { kind: "zoom", delta: down ? -1 : 1 };
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
var PANEL_ROWS = 1 + PANEL_CONTENT_ROWS;
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
function pageTabRow(tabs, width, unicode) {
  const segments = [];
  let col = 1;
  for (const [index, tab] of tabs.entries()) {
    const room = width - (col - 1);
    if (room <= 3) break;
    const marker = tab.active ? unicode ? "\u25CF" : "*" : unicode ? "\u25CB" : "o";
    const glyph = STATUS_GLYPH[tab.status][unicode ? 0 : 1];
    const text = fitWidth(` ${marker} ${glyph} ${tab.title} `, room);
    const w = displayWidth(text);
    segments.push({
      text,
      sgr: tab.active ? `${STATUS_SGR[tab.status]};1` : tab.fresh ? STATUS_SGR[tab.status] : "90",
      lo: col,
      hi: col + w - 1,
      index
    });
    col += w;
  }
  return segments;
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
function nodePanel(map, focusId, unicode, width, pinned) {
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
    while (lines2.length < PANEL_CONTENT_ROWS) lines2.push({ text: "", sgr: "" });
    return lines2;
  }
  const node = map.nodes.find((n) => n.id === focusId);
  if (!node) return void 0;
  const layerName = map.layers.find((l) => l.id === node.layer)?.name ?? node.layer;
  const [right, left] = unicode ? ["\u2192", "\u2190"] : ["->", "<-"];
  const withGlyph = (id) => {
    const n = map.nodes.find((x) => x.id === id);
    return n ? `${g(n.status)} ${n.label}` : id;
  };
  const uses = map.edges.filter((e) => e.from === node.id).map((e) => withGlyph(e.to));
  const usedBy = map.edges.filter((e) => e.to === node.id).map((e) => withGlyph(e.from));
  const pin = pinned ? unicode ? "  \u2299 pinned" : "  * pinned" : "";
  const lines = [
    {
      text: fitWidth(`${g(node.status)} ${node.label} [${node.id}] \xB7 ${layerName} \xB7 ${node.status}${pin}`, width),
      sgr: `${STATUS_SGR[node.status]};1`
    },
    { text: fitWidth(`evidence: ${node.evidence ?? "\u2014"}`, width), sgr: "90" },
    { text: fitWidth(`uses ${right}  ${uses.join("  ") || "\u2014"}`, width), sgr: "" },
    { text: fitWidth(`used by ${left}  ${usedBy.join("  ") || "\u2014"}`, width), sgr: "" }
  ];
  const notes = node.detail !== void 0 ? wrapWidth(node.detail, width) : ["(no design notes yet)"];
  const room = PANEL_CONTENT_ROWS - lines.length;
  for (let i = 0; i < room; i++) {
    const last = i === room - 1 && notes.length > room;
    lines.push({
      text: last ? fitWidth(notes[i] + "\u2026", width) : notes[i] ?? "",
      sgr: node.detail !== void 0 ? "" : "90"
    });
  }
  return lines;
}
function mapPanel(map, unicode, width) {
  const g = (s) => STATUS_GLYPH[s][unicode ? 0 : 1];
  const count = (s) => map.nodes.filter((n) => n.status === s).length;
  const statuses = ["done", "in-progress", "planned", "regressed"];
  const counts = statuses.filter((s) => count(s) > 0).map((s) => `${g(s)} ${count(s)} ${s}`).join("   ");
  return [
    { text: fitWidth(map.title ?? "mellos map", width), sgr: "1" },
    {
      text: fitWidth(`${map.layers.length} layers \xB7 ${map.nodes.length} nodes \xB7 ${map.edges.length} edges`, width),
      sgr: "90"
    },
    { text: fitWidth(counts, width), sgr: "" },
    { text: "", sgr: "" },
    { text: "hover a node to inspect \xB7 click to pin", sgr: "90" },
    { text: "", sgr: "" }
  ];
}
function main() {
  const cfg = parseArgs(process.argv.slice(2), process.cwd());
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const mouseActive = interactive && cfg.mouse;
  let lastFrame = "";
  let spinnerFrame = 0;
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
  const tabRows = () => pageFiles.length > 1 ? 1 : 0;
  const viewHeight = () => Math.max(1, (process.stdout.rows ?? 30) - PANEL_ROWS - 1 - tabRows());
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
  };
  const hitTest = (termX, termY) => {
    const sx = termX - 1;
    const sy = termY - 1 - tabRows();
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
    const viewH = viewHeight();
    const focus = hoverId ?? selectedId;
    let body;
    let panned = "";
    let pannable = false;
    if (map !== void 0) {
      const windowed = renderMapWindow(
        map,
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus, zoom },
        { x: offsetX, y: offsetY, width: cols, height: viewH }
      );
      const maxX = Math.max(0, windowed.contentWidth - cols);
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
      body = [fitWidth(notice, Math.max(1, cols - 1))];
    }
    if (notice !== "" && map !== void 0) {
      body[body.length - 1] = fitWidth(`  ${notice}`, Math.max(1, cols - 1));
    }
    const panelWidth = Math.max(10, cols - 2);
    let panel;
    if (map === void 0) {
      panel = Array.from({ length: PANEL_CONTENT_ROWS }, () => ({ text: "", sgr: "" }));
    } else if (focus !== void 0) {
      panel = nodePanel(map, focus, cfg.unicode, panelWidth, selectedId === focus) ?? mapPanel(map, cfg.unicode, panelWidth);
    } else {
      panel = mapPanel(map, cfg.unicode, panelWidth);
    }
    const separator = (cfg.unicode ? "\u2500" : "-").repeat(cols);
    const panelRows = [
      cfg.color ? `\x1B[90m${separator}${RESET}` : separator,
      ...panel.map(
        (l) => cfg.color && l.sgr !== "" && l.text !== "" ? ` \x1B[${l.sgr}m${l.text}${RESET}` : ` ${l.text}`
      )
    ];
    let tabLine;
    if (tabRows() > 0) {
      const tabs = pageFiles.map((f) => {
        const m = pageData.get(f)?.map;
        return {
          title: m?.title ?? (pageIdOfFile(cfg.file, f) ?? "main"),
          status: m !== void 0 ? mapStatus(m) : "planned",
          active: f === activeFile,
          fresh: pageData.get(f)?.fresh ?? false
        };
      });
      const segments = pageTabRow(tabs, cols, cfg.unicode);
      lastTabSegments = segments;
      tabLine = segments.map((s) => cfg.color && s.sgr !== "" ? `\x1B[${s.sgr}m${s.text}${RESET}` : s.text).join("");
    } else {
      lastTabSegments = [];
    }
    const zoomTag = `${cfg.unicode ? "\u2295" : "zoom"} ${zoomLabel(zoom)}`;
    const hint = !interactive ? cfg.file : `${zoomTag} \xB7 wheel zoom \xB7 ` + (pannable ? "drag pan \xB7 " : "") + "hover/click \xB7 0 reset \xB7 q quit";
    const footerText = fitWidth(` ${hint}${panned}`, Math.max(1, cols - 1));
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
        pageData.set(file, { map: loaded.value, mtimeMs, fresh: !firstScan && file !== activeFile });
        if (file === activeFile) {
          map = loaded.value;
          notice = "";
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
            selectedId = void 0;
            dirty = true;
            break;
          case "pan":
            offsetX += event.dx;
            offsetY += event.dy;
            dirty = true;
            break;
          case "zoom": {
            const next = clampZoom(zoom + event.delta);
            if (next === zoom || map === void 0) break;
            const cols = process.stdout.columns ?? 100;
            const anchorId = hoverId ?? selectedId ?? nearestHit(lastHits, offsetX + cols / 2, offsetY + viewHeight() / 2)?.id;
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
            dragAnchor = { x: event.x, y: event.y, ox: offsetX, oy: offsetY };
            press = { moved: false };
            break;
          case "mouse-drag":
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
            if (press && !press.moved) {
              const tabHit = tabRows() > 0 && event.y === 1 ? lastTabSegments.find((s) => event.x >= s.lo && event.x <= s.hi) : void 0;
              if (tabHit !== void 0) {
                const target = pageFiles[tabHit.index];
                if (target !== void 0 && target !== activeFile) switchPage(target);
              } else {
                selectedId = hitTest(event.x, event.y);
              }
              dirty = true;
            }
            dragAnchor = void 0;
            press = void 0;
            break;
          case "next-page":
          case "prev-page": {
            if (pageFiles.length > 1 && activeFile !== void 0) {
              const current = pageFiles.indexOf(activeFile);
              const step = event.kind === "next-page" ? 1 : -1;
              switchPage(pageFiles[(current + step + pageFiles.length) % pageFiles.length]);
              dirty = true;
            }
            break;
          }
          case "page": {
            const target = pageFiles[event.index];
            if (target !== void 0 && target !== activeFile) {
              switchPage(target);
              dirty = true;
            }
            break;
          }
        }
      }
      if (dirty) paint();
    });
    process.stdout.on("resize", handleResize);
  }
  tick();
  setInterval(tick, cfg.intervalMs);
}
if (process.argv[1] !== void 0 && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
export {
  anchorOffsets,
  fitWidth,
  mapPanel,
  nearestHit,
  nodePanel,
  pageTabRow,
  parseArgs,
  wrapWidth
};
