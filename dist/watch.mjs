import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/watch/watch.ts
import { statSync } from "node:fs";
import { join as join2 } from "node:path";
import { pathToFileURL } from "node:url";

// src/render/render.ts
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
      x: prev ? prev.x + prev.w + BOX_GAP : LEFT_MARGIN,
      w: displayWidth(node.label) + 6,
      // borders + padding + glyph
      y: 0
    };
    row.push(box);
    boxes.set(node.id, box);
  }
  let contentWidth = LEFT_MARGIN;
  for (const row of bandBoxes) {
    const last = row[row.length - 1];
    if (last) contentWidth = Math.max(contentWidth, last.x + last.w);
  }
  for (const l of bands) contentWidth = Math.max(contentWidth, LEFT_MARGIN + displayWidth(l.name) + 8);
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
  if (map.title !== void 0) y += 2;
  const barY = [];
  const gapTrackStartY = [];
  for (let b = 0; b < bands.length; b++) {
    barY.push(y);
    y += 2;
    for (const box of bandBoxes[b]) box.y = y;
    y += BOX_H;
    if (b < gapCount) {
      y += 1;
      gapTrackStartY.push(y);
      y += gapRowCount[b];
      y += 1;
    }
  }
  const legendY = y + 1;
  const rowYOf = (gap, s) => gapTrackStartY[gap] + segmentRow.get(s);
  if (map.title !== void 0) canvas.text(LEFT_MARGIN, 0, map.title, "none", true);
  for (let b = 0; b < bands.length; b++) {
    const label = ` ${bands[b].name}`;
    for (let x = 0; x < totalWidth; x++) canvas.line(x, barY[b], LEFT | RIGHT, true);
    const labelStart = (fallbackCount > 0 ? contentWidth : totalWidth) - displayWidth(label);
    canvas.text(labelStart, barY[b], label, "none", true);
  }
  for (const box of boxes.values()) {
    drawBox(canvas, box, opts, opts.focus !== void 0 && box.node.id === opts.focus);
  }
  for (const r of routes) {
    const sy = r.fromBox.y + BOX_H - 1;
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
    h: BOX_H
  }));
  return { canvas, hits };
}
function drawBox(canvas, box, opts, focused = false) {
  const { node, x, y, w } = box;
  const skin = skinFor(node.status, opts.unicode);
  const inner = w - 2;
  canvas.text(x, y, skin.corners[0] + skin.h.repeat(inner) + skin.corners[1], skin.style, focused);
  canvas.text(x, y + 1, skin.v, skin.style, focused);
  canvas.text(x + 1, y + 1, ` ${glyphFor(node.status, opts)} ${node.label} `, skin.style, true);
  canvas.text(x + w - 1, y + 1, skin.v, skin.style, focused);
  canvas.text(x, y + 2, skin.corners[2] + skin.h.repeat(inner) + skin.corners[3], skin.style, focused);
}

// src/store/store.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
var NODE_STATUSES = ["planned", "in-progress", "done", "regressed"];
function makeNodeStatus(raw) {
  return NODE_STATUSES.includes(raw) ? ok(raw) : err({ kind: "invalid-status", raw });
}
var EMPTY_MAP = { layers: [], nodes: [], edges: [] };
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
    case "layer-not-empty":
      return `layer "${e.id}" still holds node "${e.occupant}"; move or remove its nodes first`;
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
function declareNode(map, input) {
  if (findNode(map, input.id)) return err({ kind: "duplicate-node", id: input.id });
  if (!findLayer(map, input.layer)) return err({ kind: "unknown-layer", id: input.layer });
  const node = {
    id: input.id,
    label: input.label,
    layer: input.layer,
    status: input.status ?? "planned",
    ...input.detail !== void 0 ? { detail: input.detail } : {}
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
  const updated = {
    ...node,
    ...input.status !== void 0 ? { status: input.status } : {},
    ...input.label !== void 0 ? { label: input.label } : {},
    ...input.evidence !== void 0 ? { evidence: input.evidence } : {},
    ...input.detail !== void 0 ? { detail: input.detail } : {}
  };
  return ok({ ...map, nodes: map.nodes.map((n) => n.id === input.id ? updated : n) });
}

// src/store/store.ts
var STATE_FILE_VERSION = 1;
var STATE_FILE_RELATIVE_PATH = join(".claude", "mellos-mapping.json");
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
    const declared = declareNode(map, {
      id: id.value,
      label,
      layer: layer.value,
      status: status.value,
      ...detail !== void 0 ? { detail } : {}
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
var WHEEL_H_STEP = 6;
var MOTION = 32;
var WHEEL = 64;
var SHIFT = 4;
var BUTTON_BITS = 3;
var SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
var ARROW = /^\x1b\[([ABCD])/;
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
    const direction = code & 1 ? 1 : -1;
    return code & SHIFT ? { kind: "pan", dx: direction * WHEEL_H_STEP, dy: 0 } : { kind: "pan", dx: 0, dy: direction * WHEEL_V_STEP };
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
    const partial = PARTIAL_ESCAPE.exec(slice);
    if (partial && partial.index === 0) {
      return { events, rest: slice };
    }
    const ch = chunk[i];
    if (ch === "q" || ch === "Q" || ch === "" || ch === "") events.push({ kind: "quit" });
    else if (ch === "0") events.push({ kind: "reset" });
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
function nodePanel(map, focusId, unicode, width, pinned) {
  const node = map.nodes.find((n) => n.id === focusId);
  if (!node) return void 0;
  const g = (s) => STATUS_GLYPH[s][unicode ? 0 : 1];
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
  let lastMtimeMs = -1;
  let lastFrame = "";
  let spinnerFrame = 0;
  let map;
  let notice = `waiting for ${cfg.file} ...`;
  let offsetX = 0;
  let offsetY = 0;
  let dragAnchor;
  let press;
  let hoverId;
  let selectedId;
  let lastHits = [];
  let pendingInput = "";
  const viewHeight = () => Math.max(1, (process.stdout.rows ?? 30) - PANEL_ROWS - 1);
  const hitTest = (termX, termY) => {
    const sx = termX - 1;
    const sy = termY - 1;
    if (sy >= viewHeight()) return void 0;
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
        { color: cfg.color, unicode: cfg.unicode, spinnerFrame, focus },
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
      if (offsetX !== 0 || offsetY !== 0) panned = `  (+${offsetX},+${offsetY})`;
    } else {
      body = [notice];
    }
    if (notice !== "" && map !== void 0) body[body.length - 1] = `  ${notice}`;
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
    const hint = !interactive ? cfg.file : (pannable ? "drag/wheel pan \xB7 " : "") + "hover/click nodes \xB7 0 reset \xB7 Esc unpin \xB7 q quit";
    const footer = cfg.color ? `\x1B[90m ${hint}${panned}${RESET}` : ` ${hint}${panned}`;
    let frame = HOME;
    for (let i = 0; i < viewH; i++) frame += (body[i] ?? "") + ERASE_LINE_END + "\n";
    for (const row of panelRows) frame += row + ERASE_LINE_END + "\n";
    frame += footer + ERASE_LINE_END;
    if (frame !== lastFrame) {
      process.stdout.write(frame);
      lastFrame = frame;
    }
  };
  const tick = () => {
    let mtimeMs;
    try {
      mtimeMs = statSync(cfg.file).mtimeMs;
    } catch {
      mtimeMs = void 0;
    }
    if (mtimeMs !== void 0 && mtimeMs !== lastMtimeMs) {
      const loaded = loadMapFile(cfg.file);
      if (loaded.ok) {
        map = loaded.value;
        notice = "";
        lastMtimeMs = mtimeMs;
      } else if (loaded.error.kind === "malformed-json") {
      } else {
        notice = describeStoreError(loaded.error);
        lastMtimeMs = mtimeMs;
      }
    }
    if (map?.nodes.some((n) => n.status === "in-progress")) spinnerFrame++;
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
              selectedId = hitTest(event.x, event.y);
              dirty = true;
            }
            dragAnchor = void 0;
            press = void 0;
            break;
        }
      }
      if (dirty) paint();
    });
    process.stdout.on("resize", paint);
  }
  tick();
  setInterval(tick, cfg.intervalMs);
}
if (process.argv[1] !== void 0 && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
export {
  fitWidth,
  mapPanel,
  nodePanel,
  parseArgs,
  wrapWidth
};
