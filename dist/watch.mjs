import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/watch/watch.ts
import { statSync } from "node:fs";
import { join as join2 } from "node:path";
import { pathToFileURL } from "node:url";

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
    status: input.status ?? "planned"
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
    ...input.evidence !== void 0 ? { evidence: input.evidence } : {}
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
    const declared = declareNode(map, { id: id.value, label, layer: layer.value, status: status.value });
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
var ANSI = {
  none: "",
  dim: "\x1B[2m",
  amber: "\x1B[33m",
  green: "\x1B[32m",
  red: "\x1B[31m"
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
    while (row.length <= x) row.push({ mask: 0, heavyHorizontal: false, style: "none" });
    return row[x];
  }
  /** Write literal text starting at (x, y). */
  text(x, y, s, style) {
    let cx = x;
    for (const ch of s) {
      const c = this.cell(cx, y);
      c.literal = ch;
      c.style = style;
      const w = charWidth(ch.codePointAt(0));
      if (w === 2) {
        const phantom = this.cell(cx + 1, y);
        phantom.literal = "";
        phantom.style = style;
      }
      cx += w;
    }
  }
  /** Merge a routed-line direction mask into (x, y). */
  line(x, y, mask, heavyHorizontal = false) {
    const c = this.cell(x, y);
    if (c.literal !== void 0) {
      const junction = BORDER_JUNCTION[c.literal];
      const replacement = mask & DOWN ? junction?.down : mask & UP ? junction?.up : void 0;
      if (replacement !== void 0) c.literal = replacement;
      return;
    }
    c.mask |= mask;
    c.heavyHorizontal = c.heavyHorizontal || heavyHorizontal;
  }
  emit(opts) {
    return this.rows.map((row) => {
      let out = "";
      let open = "none";
      for (const c of row) {
        const ch = c.literal !== void 0 ? c.literal : c.mask !== 0 ? maskChar(c.mask, c.heavyHorizontal, opts.unicode) : " ";
        if (ch === "") continue;
        const style = ch === " " ? "none" : c.style;
        if (opts.color && style !== open) {
          out += (open !== "none" ? ANSI_RESET : "") + ANSI[style];
          open = style;
        }
        out += ch;
      }
      if (opts.color && open !== "none") out += ANSI_RESET;
      return out.replace(/ +$/, "");
    });
  }
};
function drawPath(canvas, points) {
  for (let i = 0; i + 1 < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (x1 === x2 && y1 === y2) continue;
    if (x1 === x2) {
      const [lo, hi] = y1 < y2 ? [y1, y2] : [y2, y1];
      for (let yy = lo + 1; yy < hi; yy++) canvas.line(x1, yy, UP | DOWN);
      canvas.line(x1, y1, y2 > y1 ? DOWN : UP);
      canvas.line(x1, y2, y2 > y1 ? UP : DOWN);
    } else {
      const [lo, hi] = x1 < x2 ? [x1, x2] : [x2, x1];
      for (let xx = lo + 1; xx < hi; xx++) canvas.line(xx, y1, LEFT | RIGHT);
      canvas.line(x1, y1, x2 > x1 ? RIGHT : LEFT);
      canvas.line(x2, y1, x2 > x1 ? LEFT : RIGHT);
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
      return { h: "\u254C", v: "\u254E", corners: ["\u250C", "\u2510", "\u2514", "\u2518"], style };
    case "in-progress":
      return { h: "\u2500", v: "\u2502", corners: ["\u250C", "\u2510", "\u2514", "\u2518"], style };
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
function renderMap(map, opts) {
  const canvas = new Canvas();
  const bands = [...map.layers].sort((a, b) => b.rank - a.rank);
  if (bands.length === 0) {
    canvas.text(0, 0, map.title ?? "mellos mapping", "none");
    canvas.text(0, 2, "(empty map \u2014 declare layers and nodes to begin)", "dim");
    return canvas.emit(opts);
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
  const gapCount = bands.length - 1;
  const exitTracks = Array.from({ length: gapCount }, () => []);
  const landingTracks = Array.from({ length: gapCount }, () => []);
  const skipRoutes = [];
  for (const r of routes) {
    landingTracks[r.toBand - 1].push(r);
    if (r.toBand - r.fromBand > 1) {
      exitTracks[r.fromBand].push(r);
      skipRoutes.push(r);
    }
  }
  let y = 0;
  if (map.title !== void 0) y += 2;
  const barY = [];
  const landingY = /* @__PURE__ */ new Map();
  const jogY = /* @__PURE__ */ new Map();
  for (let b = 0; b < bands.length; b++) {
    barY.push(y);
    y += 2;
    for (const box of bandBoxes[b]) box.y = y;
    y += BOX_H;
    if (b < gapCount) {
      y += 1;
      for (const r of exitTracks[b]) jogY.set(r, y++);
      for (const r of landingTracks[b]) landingY.set(r, y++);
      y += 1;
    }
  }
  const legendY = y + 1;
  let contentWidth = LEFT_MARGIN;
  for (const row of bandBoxes) {
    const last = row[row.length - 1];
    if (last) contentWidth = Math.max(contentWidth, last.x + last.w);
  }
  for (const l of bands) contentWidth = Math.max(contentWidth, LEFT_MARGIN + displayWidth(l.name) + 8);
  const marginX = new Map(skipRoutes.map((r, i) => [r, contentWidth + 2 + i * 2]));
  const totalWidth = contentWidth + 2 + skipRoutes.length * 2;
  if (map.title !== void 0) canvas.text(LEFT_MARGIN, 0, map.title, "none");
  for (let b = 0; b < bands.length; b++) {
    const label = ` ${bands[b].name} `;
    for (let x = 0; x < totalWidth; x++) canvas.line(x, barY[b], LEFT | RIGHT, true);
    canvas.text(contentWidth - displayWidth(label), barY[b], label, "none");
  }
  for (const box of boxes.values()) drawBox(canvas, box, opts);
  const outgoing = /* @__PURE__ */ new Map();
  const incoming = /* @__PURE__ */ new Map();
  for (const r of routes) {
    outgoing.set(r.fromBox, [...outgoing.get(r.fromBox) ?? [], r]);
    incoming.set(r.toBox, [...incoming.get(r.toBox) ?? [], r]);
  }
  const slot = (box, k, n) => box.x + Math.min(box.w - 2, Math.max(1, Math.round((k + 1) * (box.w - 1) / (n + 1))));
  for (const r of routes) {
    const outs = outgoing.get(r.fromBox);
    const ins = incoming.get(r.toBox);
    const sx = slot(r.fromBox, outs.indexOf(r), outs.length);
    const ex = slot(r.toBox, ins.indexOf(r), ins.length);
    const sy = r.fromBox.y + BOX_H - 1;
    const ey = r.toBox.y;
    const landing = landingY.get(r);
    if (r.toBand - r.fromBand === 1) {
      drawPath(canvas, [
        [sx, sy],
        [sx, landing],
        [ex, landing],
        [ex, ey]
      ]);
    } else {
      const jog = jogY.get(r);
      const mx = marginX.get(r);
      drawPath(canvas, [
        [sx, sy],
        [sx, jog],
        [mx, jog],
        [mx, landing],
        [ex, landing],
        [ex, ey]
      ]);
    }
  }
  const legendOpts = { ...opts, spinnerFrame: 0 };
  const legend = [
    `${glyphFor("planned", legendOpts)} planned`,
    `${glyphFor("in-progress", legendOpts)} in-progress`,
    `${glyphFor("done", legendOpts)} done`,
    `${glyphFor("regressed", legendOpts)} regressed`
  ].join("   ");
  canvas.text(LEFT_MARGIN, legendY, legend, "dim");
  return canvas.emit(opts);
}
function drawBox(canvas, box, opts) {
  const { node, x, y, w } = box;
  const skin = skinFor(node.status, opts.unicode);
  const inner = w - 2;
  canvas.text(x, y, skin.corners[0] + skin.h.repeat(inner) + skin.corners[1], skin.style);
  canvas.text(x, y + 1, skin.v + ` ${glyphFor(node.status, opts)} ${node.label} `, skin.style);
  canvas.text(x + w - 1, y + 1, skin.v, skin.style);
  canvas.text(x, y + 2, skin.corners[2] + skin.h.repeat(inner) + skin.corners[3], skin.style);
}

// src/watch/watch.ts
function parseArgs(argv, cwd) {
  let file = join2(cwd, STATE_FILE_RELATIVE_PATH);
  let intervalMs = 250;
  let unicode = true;
  let color = true;
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
      default:
        break;
    }
  }
  return { file, intervalMs, unicode, color };
}
var HIDE_CURSOR = "\x1B[?25l";
var SHOW_CURSOR = "\x1B[?25h";
var HOME_AND_CLEAR = "\x1B[H\x1B[2J";
var HOME = "\x1B[H\x1B[0J";
function main() {
  const cfg = parseArgs(process.argv.slice(2), process.cwd());
  let lastMtimeMs = -1;
  let lastPicture = "";
  let spinnerFrame = 0;
  let map;
  let notice = `waiting for ${cfg.file} ...`;
  process.stdout.write(HIDE_CURSOR + HOME_AND_CLEAR);
  const restore = () => {
    process.stdout.write(SHOW_CURSOR + "\n");
    process.exit(0);
  };
  process.on("SIGINT", restore);
  process.on("SIGTERM", restore);
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
    const spinning = map?.nodes.some((n) => n.status === "in-progress") ?? false;
    if (spinning) spinnerFrame++;
    const lines = map !== void 0 ? renderMap(map, { color: cfg.color, unicode: cfg.unicode, spinnerFrame }) : [notice];
    const picture = lines.join("\n") + (notice && map !== void 0 ? `

  ${notice}` : "");
    if (picture !== lastPicture) {
      process.stdout.write(HOME + picture + "\n");
      lastPicture = picture;
    }
  };
  tick();
  setInterval(tick, cfg.intervalMs);
}
if (process.argv[1] !== void 0 && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
export {
  parseArgs
};
