// src/domain/types.ts
var RANK_MIN = 0;
var RANK_MAX = 99;
var RANK_RULE_TEXT = `an integer in ${RANK_MIN}..${RANK_MAX}, 0 = bottom / most primitive`;

// src/domain/ops.ts
function aggregateStatus(nodes) {
  if (nodes.some((n) => n.status === "regressed")) return "regressed";
  if (nodes.some((n) => n.status === "in-progress")) return "in-progress";
  if (nodes.length > 0 && nodes.every((n) => n.status === "done")) return "done";
  return "planned";
}
function groupStatus(map, id) {
  return aggregateStatus(map.nodes.filter((n) => n.group === id));
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
function zoomMode(zoom2) {
  if (zoom2 >= 1) return "detail";
  if (zoom2 <= -4) return "overview";
  return "boxes";
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
function mostRecentKey(keys, mtimeOf) {
  let best;
  let bestMtime = -Infinity;
  for (const key of keys) {
    const mtime = mtimeOf(key);
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

// src/preview/presentation.ts
var LABELS = { planned: "\u5F85\u5F00\u53D1", "in-progress": "\u5F00\u53D1\u4E2D", done: "\u5DF2\u9A8C\u8BC1", regressed: "\u51FA\u73B0\u56DE\u5F52" };
function isVerified(node) {
  return node.status === "done" && node.evidence !== void 0;
}
function statusText(node) {
  return node.status === "done" && !isVerified(node) ? `${unverifiedDoneGlyph(true)} \u5B8C\u6210\u4F46\u7F3A\u5C11\u8BC1\u636E` : `${statusGlyph(node.status, true)} ${LABELS[node.status]}`;
}

// src/render/zoom-geometry.ts
var BOX_H = 3;
var BOX_GAP = 2;
var LEFT_MARGIN = 2;
var BAR_MIN_RUN = 7;
var DETAIL_BUDGET = { innerMin: 22, innerMax: 32, noteRows: 3 };
var DETAIL_PLUS_BUDGET = { innerMin: 30, innerMax: 48, noteRows: 12 };
function zoomGeometry(zoom2) {
  const m = zoomMode(zoom2);
  const mode = m === "overview" ? "constellation" : m;
  switch (zoom2) {
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

// src/preview/text.ts
function xml(text) {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
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

// src/web/scene.ts
var CARD_W = 248;
var CARD_H = 94;
var GAP = 36;
var ROW = 160;
var MARGIN = 32;
function layoutWebScene(source, overview = false) {
  const map = overview ? aggregateMap(source) ?? source : source;
  const oriented = flipForSequence(map);
  const layers = [...oriented.layers].sort((a, b) => b.rank - a.rank);
  const rows = layers.map((layer) => map.nodes.filter((node) => node.layer === layer.id));
  const laneKeys = map.lanes.length ? [...map.lanes.map((lane) => lane.id), ""] : [];
  const laneWidths = laneKeys.map((id) => Math.max(1, ...rows.map((row) => row.filter((n) => (n.lane ?? "") === id).length)) * (CARD_W + GAP));
  if (laneKeys.length && !map.nodes.some((n) => n.lane === void 0)) {
    laneKeys.pop();
    laneWidths.pop();
  }
  const contentWidth = Math.max(568, laneKeys.length ? laneWidths.reduce((sum, w) => sum + w, 0) - GAP : Math.max(0, ...rows.map((row) => row.length)) * (CARD_W + GAP) - GAP);
  const header = map.lanes.length ? 46 : 0;
  const nodes = [];
  rows.forEach((row, index) => {
    if (!laneKeys.length) {
      const start = MARGIN + (contentWidth - (row.length * (CARD_W + GAP) - GAP)) / 2;
      row.forEach((node, i) => nodes.push({ node, x: start + i * (CARD_W + GAP), y: header + index * ROW + 48, w: CARD_W, h: CARD_H }));
    } else {
      let x = MARGIN;
      laneKeys.forEach((lane, i) => {
        row.filter((n) => (n.lane ?? "") === lane).forEach((node, j) => nodes.push({ node, x: x + j * (CARD_W + GAP), y: header + index * ROW + 48, w: CARD_W, h: CARD_H }));
        x += laneWidths[i];
      });
    }
  });
  const nodeOf = new Map(nodes.map((node) => [node.node.id, node]));
  const bandOf = new Map(layers.map((layer, i) => [layer.id, i]));
  let skipCount = 0;
  const routed = oriented.edges.map((edge) => {
    const from = nodeOf.get(edge.from), to = nodeOf.get(edge.to);
    const exits = oriented.edges.filter((e) => e.from === edge.from);
    const entries = oriented.edges.filter((e) => e.to === edge.to);
    const x1 = from.x + from.w * (exits.indexOf(edge) + 1) / (exits.length + 1);
    const x2 = to.x + to.w * (entries.indexOf(edge) + 1) / (entries.length + 1);
    const y1 = from.y + from.h, y2 = to.y, mid = (y1 + y2) / 2;
    if (bandOf.get(to.node.layer) - bandOf.get(from.node.layer) > 1) {
      const side = MARGIN + contentWidth + 24 + skipCount++ * 18;
      return {
        from: edge.from,
        to: edge.to,
        label: edge.label ?? "",
        x: side,
        y: mid,
        path: `M ${x1} ${y1} V ${y1 + 18} Q ${x1} ${y1 + 26} ${x1 + 8} ${y1 + 26} H ${side - 8} Q ${side} ${y1 + 26} ${side} ${y1 + 34} V ${y2 - 28} Q ${side} ${y2 - 20} ${side - 8} ${y2 - 20} H ${x2 + 8} Q ${x2} ${y2 - 20} ${x2} ${y2 - 12} V ${y2}`
      };
    }
    return {
      from: edge.from,
      to: edge.to,
      label: edge.label ?? "",
      x: (x1 + x2) / 2,
      y: mid,
      path: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
    };
  });
  const occupied = [];
  const edges = routed.map((edge) => {
    if (!edge.label) return edge;
    const half = displayWidth(edge.label) * 2.8 + 6;
    const offset = [0, 14, -14, 28, -28].find((offset2) => !occupied.some((label) => Math.abs(label.y - edge.y - offset2) < 12 && Math.abs(label.x - edge.x) < label.half + half)) ?? 0;
    const positioned = { ...edge, y: edge.y + offset };
    occupied.push({ x: edge.x, y: positioned.y, half });
    return positioned;
  });
  let laneX = MARGIN;
  const lanes = map.lanes.map((lane, i) => {
    const value = { label: lane.label, x: laneX, width: laneWidths[i] - GAP };
    laneX += laneWidths[i];
    return value;
  });
  return {
    width: contentWidth + MARGIN * 2 + (skipCount ? 24 + skipCount * 18 : 0),
    height: Math.max(220, header + layers.length * ROW),
    nodes,
    edges,
    lanes,
    neutral: isNeutralKind(source),
    bands: layers.map((layer, i) => ({ id: layer.id, name: layer.name, rank: source.layers.find((l) => l.id === layer.id).rank, y: header + i * ROW, count: rows[i].length }))
  };
}

// src/web/view.ts
var STATUS_NAMES = { planned: "\u5F85\u5F00\u53D1", "in-progress": "\u8FDB\u884C\u4E2D", done: "\u5DF2\u9A8C\u8BC1", regressed: "\u6709\u56DE\u5F52", unverified: "\u5F85\u9A8C\u8BC1", neutral: "\u6A21\u5757" };
function stateOf(node, map) {
  if (map.kind && map.kind !== "dev") return "neutral";
  const group = map.groups.find((g) => g.id === node.id);
  const verified = group ? map.nodes.filter((n) => n.group === group.id).every(isVerified) : isVerified(node);
  return node.status === "done" && !verified ? "unverified" : node.status;
}
function renderStage(map, scene2) {
  return `<svg class="map-scene" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 ${scene2.width} ${scene2.height}" role="group" aria-label="\u77E2\u91CF\u4F9D\u8D56\u5730\u56FE"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z" fill="context-stroke"/></marker></defs>` + scene2.bands.map((band) => `<g class="band" transform="translate(0 ${band.y})"><line x2="${scene2.width}"/><rect class="band-rank-box" x="0" y="10" width="29" height="18" rx="3"/><text class="band-rank" x="14.5" y="23" text-anchor="middle">L${band.rank}</text><text x="40" y="24">${xml(band.name)}</text><text class="band-count" x="${scene2.width}" y="24" text-anchor="end">${band.count} \u4E2A\u6A21\u5757</text></g>`).join("") + scene2.lanes.map((lane) => `<text class="lane-label" x="${lane.x + lane.width / 2}" y="16" text-anchor="middle">${xml(lane.label)}</text>`).join("") + '<g class="wires" aria-hidden="true">' + scene2.edges.map((edge) => `<g class="edge" data-from="${xml(edge.from)}" data-to="${xml(edge.to)}"><path d="${edge.path}" marker-end="url(#arrow)"/>${edge.label ? `<text x="${edge.x}" y="${edge.y - 7}" text-anchor="middle">${xml(edge.label)}</text>` : ""}</g>`).join("") + "</g>" + scene2.nodes.map((box) => {
    const n = box.node, status = stateOf(n, map), group = map.groups.find((g) => g.id === n.id);
    const caption = group ? `${map.nodes.filter((m) => m.group === group.id).length} \u4E2A\u6A21\u5757` : n.id;
    const badge = n.submap ? "\u5B50\u5730\u56FE \u2197" : n.kind ? kindGlyph(n.kind, true) ?? "" : "";
    return `<g class="node ${status}" data-node="${xml(n.id)}" transform="translate(${box.x} ${box.y})" role="button" tabindex="0" aria-pressed="false" aria-label="${xml(n.label)} \xB7 ${STATUS_NAMES[status]}"><title>${xml(n.label)}${n.submap ? " \xB7 \u53CC\u51FB\u6253\u5F00\u5B50\u5730\u56FE" : ""}</title><rect class="node-card" width="${box.w}" height="${box.h}" rx="9"/><g class="node-head"><circle class="status-dot" cx="19" cy="19" r="3"/><text x="30" y="23">${STATUS_NAMES[status]}</text><text class="node-kind" x="${box.w - 15}" y="23" text-anchor="end">${xml(fitWidth(group ? "\u5206\u7EC4" : n.kind ?? "", 22))}</text></g><text class="node-title" x="15" y="51">${xml(fitWidth(n.label, Math.floor((box.w - 30) / 8.5)))}</text><text class="node-foot" x="15" y="78">${xml(fitWidth(caption, badge ? 28 : 40))}</text>${badge ? `<text class="submap-badge" x="${box.w - 15}" y="78" text-anchor="end">${xml(badge)}</text>` : ""}</g>`;
  }).join("") + "</svg>";
}
function renderInspector(map, id) {
  const info = id ? focusInfo(map, id) : void 0;
  const neutral = map.kind !== void 0 && map.kind !== "dev";
  if (!info) {
    const verified = map.nodes.filter(isVerified).length;
    return `<div class="inspector-heading"><div><span class="eyebrow">${neutral ? "MAP OVERVIEW" : "BUILD OVERVIEW"}</span><h2>\u5730\u56FE\u6982\u89C8</h2></div><span class="quiet">\u70B9\u51FB\u8282\u70B9\u56FA\u5B9A\u8BE6\u60C5</span></div><div class="overview-grid"><div><strong>${map.nodes.length}</strong><span>\u6A21\u5757</span></div><div><strong>${map.edges.length}</strong><span>\u4F9D\u8D56\u5173\u7CFB</span></div><div><strong>${map.layers.length}</strong><span>\u5C42\u7EA7</span></div><div><strong>${neutral ? map.groups.length : `${verified}/${map.nodes.length}`}</strong><span>${neutral ? "\u5206\u7EC4" : "\u5DF2\u9A8C\u8BC1"}</span></div></div><p class="inspector-hint">${neutral ? "\u9009\u62E9\u4E00\u4E2A\u6A21\u5757\uFF0C\u67E5\u770B\u5B83\u7684\u804C\u8D23\u4E0E\u4E0A\u4E0B\u6E38\u5173\u7CFB\u3002" : map.nodes.some((n) => n.status === "in-progress") ? `\u6B63\u5728\u6784\u5EFA\uFF1A${map.nodes.filter((n) => n.status === "in-progress").map((n) => xml(n.label)).join("\u3001")}` : "\u6A21\u5757\u72B6\u6001\u6765\u81EA\u9879\u76EE\u5730\u56FE\uFF1B\u9A8C\u8BC1\u8BB0\u5F55\u4F1A\u4FDD\u7559\u5728\u8282\u70B9\u8BE6\u60C5\u4E2D\u3002"}</p>`;
  }
  const node = info.kind === "node" ? info.node : void 0;
  const title = node?.label ?? (info.kind === "group" ? info.group.label : "");
  const neighbors = (label, refs) => `<div class="relations"><span class="eyebrow">${label} \xB7 ${refs.length}</span><div>${refs.length ? refs.map((ref) => `<button class="relation" data-select="${xml(ref.id)}">${xml(ref.label)}${ref.edgeLabel ? `<small>${xml(ref.edgeLabel)}</small>` : ""}<span>\u2197</span></button>`).join("") : '<span class="quiet">\u65E0</span>'}</div></div>`;
  return `<div class="inspector-heading"><div><span class="eyebrow">${xml(info.layerName)}${info.kind === "node" && info.laneLabel ? ` / ${xml(info.laneLabel)}` : ""}</span><h2>${xml(title)}</h2></div><button class="icon-button" data-clear aria-label="\u53D6\u6D88\u9009\u62E9">\xD7</button></div>` + (node ? `<p class="node-description">${xml(node.detail ?? "\u5C1A\u672A\u586B\u5199\u6A21\u5757\u8BF4\u660E\u3002")}</p>${node.evidence ? `<div class="evidence ${stateOf(node, map)}"><span>${node.status === "regressed" ? "\u56DE\u5F52\u8BB0\u5F55" : "\u9A8C\u8BC1\u8BB0\u5F55"}</span><p>${xml(node.evidence)}</p></div>` : ""}${node.submap ? `<button class="dive-button" data-dive="${xml(node.submap)}">\u6253\u5F00\u5B50\u5730\u56FE <span>\u2197</span></button>` : ""}` : `<div class="group-members">${info.kind === "group" ? info.members.map((member) => `<button class="relation" data-select="${xml(member.id)}">${xml(member.label)}<small>${STATUS_NAMES[stateOf(member, map)]}</small></button>`).join("") : ""}</div>`) + `<div class="neighbor-grid">${neighbors(map.kind === "sequence" ? "\u6B64\u524D\u4E8B\u4EF6" : "\u4F9D\u8D56\u4E8E", info.uses)}${neighbors(map.kind === "sequence" ? "\u540E\u7EED\u4E8B\u4EF6" : "\u88AB\u4F9D\u8D56", info.usedBy)}</div>`;
}

// src/web/viewport.ts
function svgViewBox(view2, width, height) {
  return `${-view2.x / view2.scale} ${-view2.y / view2.scale} ${Math.max(1, width) / view2.scale} ${Math.max(1, height) / view2.scale}`;
}
var clampScale = (scale) => Math.max(0.15, Math.min(2.5, scale));
function fitViewport(width, height, sceneWidth, sceneHeight) {
  const scale = Math.max(0.15, Math.min(1, (width - 48) / sceneWidth, (height - 32) / sceneHeight));
  return { scale, x: (width - sceneWidth * scale) / 2, y: Math.max(16, (height - sceneHeight * scale) / 2) };
}
function zoomViewport(view2, scale, x, y) {
  const next = clampScale(scale), ratio = next / view2.scale;
  return { scale: next, x: x - (x - view2.x) * ratio, y: y - (y - view2.y) * ratio };
}

// src/web/zoom.ts
function showsOverview(state, hasGroups) {
  return hasGroups && (state.overview || state.viewport.scale < 0.55);
}
function zoomScene(state, factor, x, y) {
  return {
    viewport: zoomViewport(state.viewport, state.viewport.scale * factor, x, y),
    // Overview and fit can aggregate a scene explicitly. Moving closer resumes
    // scale-driven detail instead of leaving that earlier choice latched on.
    overview: state.overview && factor <= 1
  };
}

// src/web/app.ts
var element = (id) => document.getElementById(id);
var viewport = element("viewport");
var stage = element("stage");
var inspector = element("inspector");
var pages = element("pages");
var search = element("search");
var dialog = element("dialog");
var base = new URL(".", window.location.href);
var kinds = { dev: "\u5F00\u53D1\u5730\u56FE", architecture: "\u67B6\u6784\u5730\u56FE", dataflow: "\u6570\u636E\u6D41", "behavior-tree": "\u884C\u4E3A\u6811", sequence: "\u65F6\u5E8F\u5730\u56FE" };
var snapshot = { project: "", pages: [] };
var revision = "";
var etag = "";
var currentId = new URLSearchParams(location.search).get("page") ?? "";
var follow = true;
var hover;
var statusFilter = "all";
var scene;
var renderedOverview = false;
var parents = [];
var toastTimer;
var deletion;
var views = /* @__PURE__ */ new Map();
function view() {
  let value = views.get(currentId);
  if (!value) {
    value = { viewport: { x: 0, y: 0, scale: 1 }, selected: void 0, overview: false, fitted: false };
    views.set(currentId, value);
  }
  return value;
}
var current = () => snapshot.pages.find((page) => page.id === currentId);
function toast(message) {
  element("toast").textContent = message;
  element("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element("toast").hidden = true;
  }, 4500);
}
function setFollow(enabled) {
  follow = enabled;
  element("follow").classList.toggle("active", enabled);
  element("follow").setAttribute("aria-pressed", String(enabled));
  element("follow").textContent = enabled ? "\u25CF \u81EA\u52A8\u8DDF\u968F" : "\u2316 \u5F53\u524D\u9875\u5DF2\u56FA\u5B9A";
}
function switchPage(id, manual = true, dive = false) {
  if (!snapshot.pages.some((page) => page.id === id)) {
    toast("\u8FD9\u5F20\u5B50\u5730\u56FE\u5C1A\u672A\u521B\u5EFA\uFF0C\u6216\u5DF2\u88AB\u5220\u9664\u3002");
    return;
  }
  if (manual) setFollow(false);
  if (dive) parents.push(currentId);
  else parents = [];
  currentId = id;
  hover = void 0;
  search.value = "";
  statusFilter = "all";
  const url = new URL(location.href);
  url.searchParams.set("page", id);
  history.replaceState(null, "", url);
  render();
}
function goBack() {
  const parent = parents.pop();
  if (parent === void 0) return;
  if (!snapshot.pages.some((page) => page.id === parent)) {
    toast("\u7236\u5730\u56FE\u5DF2\u88AB\u5220\u9664\u3002");
    return;
  }
  const stack = [...parents];
  switchPage(parent);
  parents = stack;
  renderHeading();
}
function renderHeading() {
  const page = current(), map = page?.map;
  element("project").textContent = snapshot.project;
  element("title").textContent = page?.title ?? "\u5730\u56FE\u5DF2\u4E0D\u5B58\u5728";
  document.title = `${page?.title ?? "\u5730\u56FE"} \xB7 Mellos`;
  element("kind").textContent = kinds[map?.kind ?? "dev"];
  pages.innerHTML = snapshot.pages.map((p) => `<option value="${xml(p.id)}">${xml(p.title)}</option>`).join("");
  pages.value = currentId;
  const neutral = !!map?.kind && map.kind !== "dev", verified = map?.nodes.filter(isVerified).length ?? 0, total = map?.nodes.length ?? 0;
  element("summary").innerHTML = neutral ? `<b>${total}</b> \u4E2A\u6A21\u5757 \xB7 <b>${map?.edges.length ?? 0}</b> \u6761\u5173\u7CFB` : `<b>${verified} / ${total}</b> \u5DF2\u9A8C\u8BC1 \xB7 <b>${map?.nodes.filter((n) => n.status === "in-progress").length ?? 0}</b> \u8FDB\u884C\u4E2D`;
  element("progress").hidden = neutral;
  element("progress").firstElementChild.style.width = `${total ? verified / total * 100 : 0}%`;
  element("filters").hidden = neutral;
  element("breadcrumbs").innerHTML = parents.map((id, i) => `<button data-parent="${i}">\u2190 ${xml(snapshot.pages.find((p) => p.id === id)?.title ?? id)}</button><span>\u203A</span>`).join("") + (parents.length ? `<span>${xml(page?.title ?? "")}</span>` : "");
  element("export").disabled = !map;
  element("delete").disabled = !page || !page.modified && !page.error;
}
function render() {
  renderHeading();
  const page = current(), map = page?.map;
  scene = void 0;
  stage.innerHTML = "";
  const empty = element("empty");
  empty.hidden = !!map?.nodes.length;
  empty.textContent = page?.error ? `\u5730\u56FE\u8BFB\u53D6\u5931\u8D25
${page.error}
\u4FEE\u590D\u6E90\u6587\u4EF6\u540E\u4F1A\u81EA\u52A8\u6062\u590D\u3002` : !page ? "\u5F53\u524D\u5730\u56FE\u5DF2\u88AB\u5220\u9664\u3002\n\u4ECE\u53F3\u4E0A\u89D2\u9009\u62E9\u5176\u4ED6\u5730\u56FE\u3002" : "\u5730\u56FE\u5DF2\u8FDE\u63A5\n\u58F0\u660E\u6A21\u5757\u540E\uFF0C\u5B83\u4EEC\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002";
  if (!map) {
    inspector.innerHTML = '<p class="quiet">\u6B64\u9875\u9762\u6682\u65E0\u53EF\u663E\u793A\u7684\u5730\u56FE\u6570\u636E\u3002</p>';
    element("minimap").innerHTML = "";
    return;
  }
  const state = view();
  if (state.selected && !focusInfo(map, state.selected)) state.selected = void 0;
  if (hover && !focusInfo(map, hover)) hover = void 0;
  renderedOverview = showsOverview(state, map.groups.length > 0);
  scene = layoutWebScene(map, renderedOverview);
  stage.innerHTML = renderStage(map, scene);
  if (!state.fitted) {
    const fitted = fitViewport(viewport.clientWidth, viewport.clientHeight - 45, scene.width, scene.height);
    state.viewport = fitted.scale >= 0.85 ? fitted : { scale: 0.85, x: (viewport.clientWidth - scene.width * 0.85) / 2, y: 18 };
    state.fitted = true;
  }
  element("overview").setAttribute("aria-pressed", String(renderedOverview));
  element("overview").disabled = map.groups.length === 0;
  element("overview").title = map.groups.length ? "\u5C06\u540C\u7EC4\u6A21\u5757\u805A\u5408\u663E\u793A" : "\u8FD9\u5F20\u5730\u56FE\u5C1A\u672A\u58F0\u660E\u5206\u7EC4";
  transform();
  updateFocus();
}
function transform() {
  const v = view().viewport;
  stage.querySelector(".map-scene")?.setAttribute("viewBox", svgViewBox(v, viewport.clientWidth, viewport.clientHeight));
  element("zoom-label").textContent = `${Math.round(v.scale * 100)}%`;
  viewport.style.backgroundPosition = `${v.x}px ${v.y}px`;
  viewport.style.backgroundSize = `${20 * v.scale}px ${20 * v.scale}px`;
  if (scene) element("minimap").innerHTML = `<svg viewBox="0 0 ${scene.width} ${scene.height}" aria-label="\u5730\u56FE\u7F29\u7565\u56FE">${scene.nodes.map((n) => `<rect class="mini-node" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10"/>`).join("")}<rect class="mini-window" x="${-v.x / v.scale}" y="${-v.y / v.scale}" width="${viewport.clientWidth / v.scale}" height="${viewport.clientHeight / v.scale}"/></svg>`;
}
function updateFocus() {
  const map = current()?.map;
  if (!map) return;
  const focus = view().selected ?? hover, query = search.value.trim().toLocaleLowerCase();
  const related = new Set(focus ? [focus] : []);
  for (const edge of scene?.edges ?? []) {
    if (edge.from === focus) related.add(edge.to);
    if (edge.to === focus) related.add(edge.from);
  }
  const visible = /* @__PURE__ */ new Set();
  for (const item of scene?.nodes ?? []) {
    const n = item.node;
    const matchesQuery = !query || [n.label, n.id, n.detail, n.evidence].some((text) => text?.toLocaleLowerCase().includes(query)) || map.nodes.some((member) => member.group === n.id && [member.label, member.detail].some((t) => t?.toLocaleLowerCase().includes(query)));
    if (matchesQuery && (statusFilter === "all" || stateOf(n, map) === statusFilter)) visible.add(n.id);
  }
  stage.querySelectorAll("[data-node]").forEach((button) => {
    const id = button.dataset.node;
    button.classList.toggle("focus", id === focus);
    button.classList.toggle("muted-node", !visible.has(id) || !!focus && !related.has(id));
    button.setAttribute("aria-pressed", String(id === view().selected));
  });
  stage.querySelectorAll(".edge").forEach((edge) => {
    const from = edge.dataset.from, to = edge.dataset.to;
    const focused = from === focus || to === focus;
    edge.classList.toggle("focus", focused);
    edge.classList.toggle("muted-edge", !visible.has(from) || !visible.has(to) || !!focus && !focused);
  });
  element("filters").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.status === statusFilter));
  element("match-count").textContent = query || statusFilter !== "all" ? `${visible.size} \u4E2A\u5339\u914D\u6A21\u5757` : "";
  const content = renderInspector(map, focus);
  if (inspector.innerHTML !== content) inspector.innerHTML = content;
}
function select(id) {
  view().selected = id;
  hover = void 0;
  if (id && scene && !scene.nodes.some((n) => n.node.id === id)) {
    view().overview = false;
    view().viewport = { ...view().viewport, scale: Math.max(0.65, view().viewport.scale) };
    render();
  }
  const box = id ? scene?.nodes.find((n) => n.node.id === id) : void 0;
  if (box) {
    const v = view().viewport, x = box.x * v.scale + v.x, y = box.y * v.scale + v.y;
    if (x < 0 || y < 0 || x + box.w * v.scale > viewport.clientWidth || y + box.h * v.scale > viewport.clientHeight) {
      view().viewport = { ...v, x: viewport.clientWidth / 2 - (box.x + box.w / 2) * v.scale, y: viewport.clientHeight / 2 - (box.y + box.h / 2) * v.scale };
      transform();
    }
  }
  updateFocus();
}
function fit() {
  if (!scene) return;
  let fitted = fitViewport(viewport.clientWidth, viewport.clientHeight - 45, scene.width, scene.height);
  if (fitted.scale < 0.55 && !renderedOverview && current()?.map?.groups.length) {
    view().overview = true;
    render();
    fitted = fitViewport(viewport.clientWidth, viewport.clientHeight - 45, scene.width, scene.height);
  }
  view().viewport = fitted;
  transform();
}
function zoom(factor, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  Object.assign(view(), zoomScene(view(), factor, x, y));
  if (showsOverview(view(), !!current()?.map?.groups.length) !== renderedOverview) render();
  else transform();
}
pages.addEventListener("change", () => switchPage(pages.value));
element("follow").addEventListener("click", () => setFollow(!follow));
element("theme").addEventListener("click", () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
});
search.addEventListener("input", () => {
  view().selected = void 0;
  updateFocus();
});
search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const first = stage.querySelector(".node:not(.muted-node)");
    if (first?.dataset.node) select(first.dataset.node);
  }
});
element("filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (button) {
    statusFilter = button.dataset.status;
    view().selected = void 0;
    updateFocus();
  }
});
element("overview").addEventListener("click", () => {
  view().overview = !renderedOverview;
  if (!view().overview) view().viewport = { ...view().viewport, scale: Math.max(0.65, view().viewport.scale) };
  render();
  if (view().overview) fit();
});
element("fit").addEventListener("click", fit);
element("zoom-in").addEventListener("click", () => zoom(1.2));
element("zoom-out").addEventListener("click", () => zoom(1 / 1.2));
stage.addEventListener("click", (event) => {
  const node = event.target.closest("[data-node]");
  if (node) select(view().selected === node.dataset.node ? void 0 : node.dataset.node);
});
stage.addEventListener("keydown", (event) => {
  const node = event.target.closest("[data-node]");
  if (node && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    select(view().selected === node.dataset.node ? void 0 : node.dataset.node);
  }
});
stage.addEventListener("dblclick", (event) => {
  const node = event.target.closest("[data-node]");
  const target = current()?.map?.nodes.find((n) => n.id === node?.dataset.node)?.submap;
  if (target) switchPage(target, true, true);
});
stage.addEventListener("pointerover", (event) => {
  const node = event.target.closest("[data-node]");
  if (node && hover !== node.dataset.node) {
    hover = node.dataset.node;
    updateFocus();
  }
});
stage.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget?.closest?.("[data-node]")) {
    hover = void 0;
    updateFocus();
  }
});
inspector.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (target?.hasAttribute("data-clear")) select(void 0);
  if (target?.dataset.select) select(target.dataset.select);
  if (target?.dataset.dive) switchPage(target.dataset.dive, true, true);
});
element("breadcrumbs").addEventListener("click", (event) => {
  const target = event.target.closest("[data-parent]");
  if (!target) return;
  const index = Number(target.dataset.parent), id = parents[index], stack = parents.slice(0, index);
  if (id !== void 0) {
    switchPage(id);
    parents = stack;
    renderHeading();
  }
});
viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  const bounds = viewport.getBoundingClientRect();
  zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 3e-3), event.clientX - bounds.left, event.clientY - bounds.top);
}, { passive: false });
var drag;
viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("[data-node]")) return;
  drag = { x: event.clientX, y: event.clientY, origin: view().viewport, moved: false };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("dragging");
});
viewport.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
  view().viewport = { ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy };
  transform();
});
viewport.addEventListener("pointerup", () => {
  if (drag && !drag.moved) select(void 0);
  drag = void 0;
  viewport.classList.remove("dragging");
});
viewport.addEventListener("pointercancel", () => {
  drag = void 0;
  viewport.classList.remove("dragging");
});
element("minimap").addEventListener("click", (event) => {
  if (!scene) return;
  const svg = element("minimap").querySelector("svg"), rect = svg.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * scene.width, y = (event.clientY - rect.top) / rect.height * scene.height;
  view().viewport = { ...view().viewport, x: viewport.clientWidth / 2 - x * view().viewport.scale, y: viewport.clientHeight / 2 - y * view().viewport.scale };
  transform();
});
var dividerDrag;
var divider = element("divider");
function resizeInspector(height) {
  const value = Math.max(100, Math.min(innerHeight * 0.5, height));
  document.documentElement.style.setProperty("--detail-height", `${value}px`);
  divider.setAttribute("aria-valuenow", String(Math.round(value)));
}
divider.addEventListener("pointerdown", (event) => {
  dividerDrag = { y: event.clientY, height: inspector.clientHeight };
  divider.setPointerCapture(event.pointerId);
});
divider.addEventListener("pointermove", (event) => {
  if (dividerDrag) resizeInspector(dividerDrag.height + dividerDrag.y - event.clientY);
});
divider.addEventListener("pointerup", () => {
  dividerDrag = void 0;
});
divider.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    event.stopPropagation();
    resizeInspector(inspector.clientHeight + (event.key === "ArrowUp" ? 20 : -20));
  }
});
new ResizeObserver(() => {
  if (scene) transform();
}).observe(viewport);
element("export").addEventListener("click", () => {
  const map = current()?.map;
  if (!map) return;
  const url = URL.createObjectURL(new Blob([renderMapSvg(map)], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentId || "mellos-map"}.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
});
element("help").addEventListener("click", () => {
  deletion = void 0;
  element("dialog-confirm").hidden = true;
  element("dialog-title").textContent = "\u4F7F\u7528\u5730\u56FE";
  element("dialog-body").textContent = "\u6EDA\u8F6E / + \u2212\uFF1A\u7F29\u653E\uFF0C\u4F4E\u4E8E 55% \u65F6\u805A\u5408\u5206\u7EC4\n\u62D6\u52A8\u753B\u5E03\uFF1A\u5E73\u79FB \xB7 0\uFF1A\u9002\u5E94\u7A97\u53E3\n\u60AC\u505C\uFF1A\u9884\u89C8\u5173\u7CFB \xB7 \u70B9\u51FB\uFF1A\u56FA\u5B9A\u8BE6\u60C5\n\u53CC\u51FB\u5B50\u5730\u56FE\u8282\u70B9\uFF1A\u4E0B\u6F5C \xB7 Backspace\uFF1A\u8FD4\u56DE\n/\uFF1A\u641C\u7D22 \xB7 F\uFF1A\u5F00\u5173\u81EA\u52A8\u8DDF\u968F\n\u65B9\u5411\u952E\uFF1A\u79FB\u52A8\u89C6\u53E3 \xB7 Esc\uFF1A\u53D6\u6D88\u9009\u62E9\n\u62D6\u52A8\u8BE6\u60C5\u4E0A\u65B9\u7684\u5206\u9694\u6761\uFF1A\u8C03\u6574\u9762\u677F\u9AD8\u5EA6\n\n\u5730\u56FE\u53D8\u66F4\u4F1A\u81EA\u52A8\u540C\u6B65\u3002\u624B\u52A8\u5207\u9875\u4F1A\u56FA\u5B9A\u5F53\u524D\u9875\uFF1B\u5F00\u542F\u81EA\u52A8\u8DDF\u968F\u540E\uFF0C\u4F1A\u8DDF\u968F\u4E0B\u4E00\u6B21\u5730\u56FE\u66F4\u65B0\u3002";
  dialog.showModal();
});
element("delete").addEventListener("click", () => {
  const page = current();
  if (!page) return;
  deletion = { page, revision };
  element("dialog-title").textContent = "\u5220\u9664\u8FD9\u5F20\u5730\u56FE\uFF1F";
  element("dialog-body").textContent = `\u5C06\u5220\u9664\u300C${page.title}\u300D\u7684\u5730\u56FE\u6587\u4EF6\u3002\u6B64\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\uFF1B\u5176\u4ED6\u5730\u56FE\u4E2D\u7684\u5B50\u5730\u56FE\u94FE\u63A5\u4F1A\u4FDD\u7559\u3002`;
  element("dialog-confirm").hidden = false;
  dialog.showModal();
});
element("dialog-cancel").addEventListener("click", () => dialog.close());
element("dialog-confirm").addEventListener("click", async () => {
  if (!deletion) return;
  const confirmed = deletion;
  deletion = void 0;
  dialog.close();
  try {
    const response = await fetch(new URL(`api/pages/${confirmed.page.id || "_default"}`, base), { method: "DELETE", headers: { "If-Match": `"${confirmed.revision}"` }, signal: AbortSignal.timeout(5e3) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "\u5220\u9664\u5931\u8D25");
    toast(result.warning ?? "\u5730\u56FE\u5DF2\u5220\u9664\u3002");
    etag = "";
  } catch (error) {
    toast(String(error));
  }
});
document.addEventListener("keydown", (event) => {
  if (dialog.open || event.target.matches("input,select,textarea")) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "/") {
    event.preventDefault();
    search.focus();
  } else if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoom(1.2);
  } else if (event.key === "-") {
    event.preventDefault();
    zoom(1 / 1.2);
  } else if (event.key === "0") fit();
  else if (event.key.toLowerCase() === "f") setFollow(!follow);
  else if (event.key === "Escape") {
    if (view().selected) select(void 0);
    else goBack();
  } else if (event.key === "Backspace") {
    event.preventDefault();
    goBack();
  } else if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    const v = view().viewport;
    view().viewport = { ...v, x: v.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0), y: v.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) };
    transform();
  }
});
async function poll() {
  try {
    const response = await fetch(new URL("api/state", base), { headers: etag ? { "If-None-Match": etag } : {}, signal: AbortSignal.timeout(5e3) });
    if (response.status !== 304 && !response.ok) throw new Error(`HTTP ${response.status}`);
    element("connection").classList.remove("offline");
    element("connection").innerHTML = "<i></i>\u5B9E\u65F6\u540C\u6B65";
    if (response.status !== 304) {
      const result = await response.json();
      etag = response.headers.get("ETag") ?? "";
      if (result.revision !== revision) {
        const initial = !revision, previous = snapshot, priorPage = current(), priorId = currentId;
        revision = result.revision;
        snapshot = result.value;
        if (initial && !new URLSearchParams(location.search).has("page")) currentId = mostRecentKey(snapshot.pages.map((p) => p.id), (id) => snapshot.pages.find((p) => p.id === id)?.modified) ?? "";
        const changed = snapshot.pages.filter((p) => p.modified > (previous.pages.find((old) => old.id === p.id)?.modified ?? 0));
        if (!initial && follow && !parents.length && changed.length) currentId = mostRecentKey(changed.map((p) => p.id), (id) => changed.find((p) => p.id === id)?.modified) ?? currentId;
        if (priorId !== currentId) {
          hover = void 0;
          search.value = "";
          statusFilter = "all";
          const url = new URL(location.href);
          url.searchParams.set("page", currentId);
          history.replaceState(null, "", url);
        }
        if (initial || JSON.stringify(priorPage) !== JSON.stringify(current())) render();
        else renderHeading();
        element("updated").textContent = `\u5DF2\u540C\u6B65 ${(/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false })}`;
      }
    }
  } catch {
    element("connection").classList.add("offline");
    element("connection").innerHTML = "<i></i>\u8FDE\u63A5\u5DF2\u65AD\u5F00";
    element("updated").textContent = "\u6B63\u5728\u91CD\u8FDE \xB7 \u663E\u793A\u4E0A\u6B21\u6570\u636E";
  } finally {
    setTimeout(() => {
      void poll();
    }, 800);
  }
}
void poll();
