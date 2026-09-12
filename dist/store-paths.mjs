// src/store/store.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// src/domain/types.ts
var ok = (value) => ({ ok: true, value });
var err = (error) => ({ ok: false, error });
var ID_RULE = /^[a-z0-9][a-z0-9-]{0,63}$/;
var ID_RULE_TEXT = "lowercase letters, digits and dashes, starting with a letter or digit, 1-64 chars";
var RANK_MIN = 0;
var RANK_MAX = 99;
var RANK_RULE_TEXT = `an integer in ${RANK_MIN}..${RANK_MAX}, 0 = bottom / most primitive`;

// src/store/format.ts
function makePageId(raw) {
  return ID_RULE.test(raw) ? ok(raw) : err({ kind: "invalid-id", raw, rule: ID_RULE_TEXT });
}

// src/store/store.ts
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}
var STORE_DIR_NAME = ".mellos";
var STATE_FILE_RELATIVE_PATH = join(STORE_DIR_NAME, "map.json");
var PAGES_DIR_NAME = "pages";
var FOCUS_FILE_NAME = "focus";
function focusFilePath(defaultFile, pid) {
  return paneChannelPath(defaultFile, FOCUS_FILE_NAME, pid);
}
function paneChannelPath(defaultFile, channel, pid) {
  if (pid === void 0) return join(dirname(defaultFile), channel);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid pane process id");
  return join(viewersDirPath(defaultFile), `${pid}.${channel}`);
}
var QUIT_FILE_NAME = "quit";
function quitFilePath(defaultFile, pid) {
  return paneChannelPath(defaultFile, QUIT_FILE_NAME, pid);
}
var VIEWERS_DIR_NAME = "viewers";
var VIEWER_FILE_VERSION = 1;
var VIEWER_STALE_MS = 5e3;
var VIEWER_SWEEP_MS = 6e4;
function viewersDirPath(defaultFile) {
  return join(dirname(defaultFile), VIEWERS_DIR_NAME);
}
function viewerPidOf(fileName) {
  const m = /^(\d+)\.json$/.exec(fileName);
  return m === null ? void 0 : Number(m[1]);
}
function parseViewerReport(raw) {
  let parsed;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch {
    return void 0;
  }
  if (!isRecord(parsed)) return void 0;
  if (parsed["version"] !== VIEWER_FILE_VERSION) return void 0;
  const follow = parsed["follow"];
  if (typeof follow !== "boolean") return void 0;
  const owner = parsed["owner"];
  if (owner !== void 0 && (typeof owner !== "string" || !makePageId(owner).ok)) return void 0;
  const binding = owner === void 0 ? {} : { owner };
  const page = parsed["page"];
  if (page === null || page === void 0) return { page: void 0, follow, ...binding };
  if (typeof page !== "string") return void 0;
  const id = makePageId(page);
  return id.ok ? { page: id.value, follow, ...binding } : void 0;
}
function readLiveViewers(defaultFile, nowMs) {
  const dir = viewersDirPath(defaultFile);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    const pid = viewerPidOf(name);
    if (pid === void 0) continue;
    const path = join(dir, name);
    let raw;
    let ageMs;
    try {
      ageMs = Math.max(0, nowMs - statSync(path).mtimeMs);
      if (ageMs > VIEWER_SWEEP_MS) {
        rmSync(path, { force: true });
        continue;
      }
      if (ageMs > VIEWER_STALE_MS) continue;
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const report = parseViewerReport(raw);
    if (report !== void 0) live.push({ ...report, pid, ageMs });
  }
  return live.sort((a, b) => a.ageMs - b.ageMs || a.pid - b.pid);
}
var LEGACY_STATE_FILE_RELATIVE_PATH = join(".claude", "mellos-mapping.json");
export {
  FOCUS_FILE_NAME,
  ID_RULE,
  PAGES_DIR_NAME,
  QUIT_FILE_NAME,
  STATE_FILE_RELATIVE_PATH,
  VIEWERS_DIR_NAME,
  focusFilePath,
  quitFilePath,
  readLiveViewers
};
