#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/hook/session-start.ts
import { existsSync as existsSync2, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/store/store.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// src/domain/types.ts
var ok = (value) => ({ ok: true, value });
var err = (error) => ({ ok: false, error });
var RANK_MIN = 0;
var RANK_MAX = 99;
var RANK_RULE_TEXT = `an integer in ${RANK_MIN}..${RANK_MAX}, 0 = bottom / most primitive`;

// src/store/store.ts
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}
var STORE_DIR_NAME = ".mellos";
var STATE_FILE_RELATIVE_PATH = join(STORE_DIR_NAME, "map.json");
var CONFIG_FILE_NAME = "config.json";
var CONFIG_FILE_VERSION = 1;
function configFilePath(defaultFile) {
  return join(dirname(defaultFile), CONFIG_FILE_NAME);
}
function userConfigFilePath(userBase) {
  return join(userBase, STORE_DIR_NAME, CONFIG_FILE_NAME);
}
var MAPPING_POLICIES = ["always", "complex", "on-request"];
function makeMappingPolicy(raw) {
  return MAPPING_POLICIES.includes(raw) ? ok(raw) : err({ kind: "invalid-policy", raw, allowed: MAPPING_POLICIES });
}
function describeMappingPolicy(policy) {
  switch (policy) {
    case "always":
      return "map every structured task \u2014 workflows, designs, architecture, technical dependencies";
    case "complex":
      return "map only medium or complex tasks \u2014 several modules, a new subsystem, roughly an hour or more";
    case "on-request":
      return "map only when the user explicitly asks";
  }
}
function loadMappingPolicy(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return ok(void 0);
    throw e;
  }
  let raw;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (e) {
    return err({ kind: "malformed-json", path, detail: e.message });
  }
  if (!isRecord(raw)) return err({ kind: "bad-shape", path, detail: "root is not an object" });
  if (raw["version"] !== CONFIG_FILE_VERSION) {
    return err({ kind: "bad-shape", path, detail: `version is ${String(raw["version"])}, expected ${CONFIG_FILE_VERSION}` });
  }
  const rawPolicy = raw["policy"];
  if (rawPolicy === void 0) return ok(void 0);
  if (typeof rawPolicy !== "string") return err({ kind: "bad-shape", path, detail: "policy is not a string" });
  const policy = makeMappingPolicy(rawPolicy);
  return policy.ok ? ok(policy.value) : err({ kind: "bad-shape", path, detail: `policy is "${rawPolicy}", expected one of: ${MAPPING_POLICIES.join(" | ")}` });
}
function effectiveMappingPolicy(projectConfigFile, userConfigFile) {
  const project = loadMappingPolicy(projectConfigFile);
  if (!project.ok) return project;
  const user = loadMappingPolicy(userConfigFile);
  if (!user.ok) return user;
  const effective = project.value ?? user.value;
  const source = project.value !== void 0 ? "project" : user.value !== void 0 ? "user" : void 0;
  return ok({ project: project.value, user: user.value, effective, source });
}
var LEGACY_STATE_FILE_RELATIVE_PATH = join(".claude", "mellos-mapping.json");

// src/hook/session-start.ts
function openPaneCommand(pluginRoot, projectDir) {
  return `node "${join2(pluginRoot, "scripts", "open-pane.mjs")}" "${projectDir}" --page <slug>`;
}
function sessionStartContext(input) {
  const { policy, hasStore, projectDir, pluginRoot } = input;
  if (policy === void 0) {
    return [
      "mellos-mapping \u2014 first-run setup. This question is asked ONCE EVER, not once per project.",
      "Before starting structured work here, ask the user how eager mapping should be:",
      ...MAPPING_POLICIES.map((p) => `  ${p} \u2014 ${describeMappingPolicy(p)}`),
      'Record their answer with mmap_setup {policy: "<their choice>", scope: "user"} \u2014 it then applies',
      'to every project they open, and a single project can still override it with scope: "project".',
      "Do not choose for them, and do not ask again once it is recorded."
    ].join("\n");
  }
  if (policy === "on-request") {
    return hasStore ? "mellos-mapping: this project has a Mellos map. The user's policy is on-request \u2014 use the mmap tools only when they ask." : void 0;
  }
  const scope = policy === "always" ? "For ANY structured task in this project \u2014 workflows, designs, architecture, technical dependencies:" : "For any MEDIUM OR COMPLEX task in this project \u2014 several modules, a new subsystem, roughly an hour of work or more (skip trivial edits):";
  return [
    `mellos-mapping policy: ${policy} \u2014 ${describeMappingPolicy(policy)}.`,
    scope,
    "  1. Load the mellos-mapping skill and follow it.",
    "  2. Declare the whole ghost design with mmap_declare BEFORE writing code.",
    "  3. Open the map pane WITHOUT asking \u2014 the recorded policy is the user's standing consent:",
    `       ${openPaneCommand(pluginRoot, projectDir)}`,
    "     (the slug is the page this effort lives on; the launcher retargets an already-open pane)",
    "  4. Keep the map current as the work proceeds: in-progress when a node is started,",
    "     done WITH EVIDENCE when its verification passes, regressed when something breaks.",
    "An explicit request from the user always outranks this."
  ].join("\n");
}
function parseHookInput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { cwd: void 0 };
  }
  if (typeof parsed !== "object" || parsed === null) return { cwd: void 0 };
  const cwd = parsed.cwd;
  return { cwd: typeof cwd === "string" && cwd !== "" ? cwd : void 0 };
}
function hookOutput(additionalContext) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } });
}
async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const raw = process.stdin.isTTY === true ? "" : await readAll(process.stdin);
  const projectDir = parseHookInput(raw).cwd ?? process.cwd();
  const stateFile = join2(projectDir, STATE_FILE_RELATIVE_PATH);
  const scopes = effectiveMappingPolicy(configFilePath(stateFile), userConfigFilePath(homedir()));
  if (!scopes.ok) return;
  const context = sessionStartContext({
    policy: scopes.value.effective,
    hasStore: existsSync2(join2(projectDir, STORE_DIR_NAME)),
    projectDir,
    // The bundle lives at <plugin root>/dist/, so the root is two up. Derived
    // rather than read from CLAUDE_PLUGIN_ROOT: the hook always knows where it
    // was installed, and an env var is one host contract more than it needs.
    pluginRoot: dirname2(dirname2(fileURLToPath(import.meta.url)))
  });
  if (context !== void 0) process.stdout.write(hookOutput(context));
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
  main().catch(() => process.exit(0));
}
export {
  hookOutput,
  launchedAsEntry,
  parseHookInput,
  sessionStartContext
};
