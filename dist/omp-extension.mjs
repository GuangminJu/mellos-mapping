// src/host/omp/extension.ts
import { dirname as dirname5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/hook/session-start.ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync as readFileSync2, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname4, join as join4 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/domain/types.ts
var ok = (value) => ({ ok: true, value });
var err = (error) => ({ ok: false, error });
var RANK_MIN = 0;
var RANK_MAX = 99;
var RANK_RULE_TEXT = `an integer in ${RANK_MIN}..${RANK_MAX}, 0 = bottom / most primitive`;

// src/store/pages.ts
import { basename, dirname, join } from "node:path";
var STORE_DIR_NAME = ".mellos";
var STATE_FILE_RELATIVE_PATH = join(STORE_DIR_NAME, "map.json");
var PAGES_DIR_NAME = "pages";

// src/store/json-text.ts
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}

// src/store/policy.ts
import { readFileSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
var CONFIG_FILE_NAME = "config.json";
var CONFIG_FILE_VERSION = 1;
function configFilePath(defaultFile) {
  return join2(dirname2(defaultFile), CONFIG_FILE_NAME);
}
function userConfigFilePath(userBase) {
  return join2(userBase, STORE_DIR_NAME, CONFIG_FILE_NAME);
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

// src/store/migration.ts
import { dirname as dirname3, join as join3 } from "node:path";
var LEGACY_STATE_FILE_RELATIVE_PATH = join3(".claude", "mellos-mapping.json");

// src/hook/session-start.ts
function sessionStartContext(input) {
  const { policy, hasStore } = input;
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
    "  2. Read existing pages and context with mmap_read; a new conversation is not a new effort.",
    "     Reuse the matching page and verified nodes. Use mmap_declare only for missing structure.",
    "  3. Open the map pane WITHOUT asking \u2014 the recorded policy is the user's standing consent:",
    '       mmap_open {page: "<the page this effort lives on>"}',
    "     It opens the pane beside this conversation, or retargets one that is already open.",
    "  4. Watch the `pane:` line every write answers with: it says whether anybody is actually",
    "     looking. `pane: CLOSED` means the user cannot see this map \u2014 call mmap_open then too.",
    "  5. Keep the map current as the work proceeds: in-progress when a node is started,",
    "     done WITH EVIDENCE when its verification passes, regressed when something breaks.",
    "     Save a concise context.next checkpoint and use expectedRevision for incremental writes.",
    "An explicit request from the user always outranks this."
  ].join("\n");
}
function hasMap(stateFile) {
  return existsSync(stateFile) || existsSync(join4(dirname4(stateFile), PAGES_DIR_NAME));
}
function mmapBinDir(localAppData) {
  return join4(localAppData, "mellos-mapping", "bin");
}
function mmapShimFilePath(localAppData) {
  return join4(mmapBinDir(localAppData), "mmap.cmd");
}
function mmapFallbackDirs(localAppData, home) {
  return [join4(localAppData, "Microsoft", "WindowsApps"), join4(home, ".local", "bin")];
}
function pathNames(rawPath, dir) {
  const norm = (s) => s.trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "").toLowerCase();
  return rawPath.split(";").some((entry) => entry.trim() !== "" && norm(entry) === norm(dir));
}
function readIfPresent(path) {
  try {
    return readFileSync2(path, "utf8");
  } catch {
    return void 0;
  }
}
function mmapShimCurrent(shimContent, mmapPath) {
  if (shimContent === void 0) return false;
  return shimContent.includes(`"${mmapPath}"`) || shimContent.includes(`"${mmapPath.replaceAll("\\", "/")}"`);
}
function shimIsOurs(content) {
  if (content.includes("mellos-mapping mmap shim")) return true;
  const quoted = /"([^"]*mmap\.mjs)"/.exec(content)?.[1];
  return quoted !== void 0 && /mellos-mapping/i.test(quoted);
}
function mmapCommandResolves(localAppData, mmapPath, environment, read, exists) {
  if (pathNames(environment.path, mmapBinDir(localAppData))) return true;
  if (environment.home === void 0 || environment.home === "") return false;
  for (const dir of mmapFallbackDirs(localAppData, environment.home)) {
    if (!exists(dir) || !pathNames(environment.path, dir)) continue;
    const files = ["mmap.cmd", "mmap"].map((name) => read(join4(dir, name))).filter((content) => content !== void 0);
    if (files.length === 0) continue;
    const ours = files.filter((content) => shimIsOurs(content));
    if (ours.length === 0) return true;
    return ours.every((content) => mmapShimCurrent(content, mmapPath));
  }
  return false;
}
function installContextLine(outcome) {
  if (typeof outcome !== "object" || outcome === null) return void 0;
  const o = outcome;
  if (o.kind !== "installed" || typeof o.binDir !== "string") return void 0;
  if (o.path === "updated") {
    return [
      "mellos-mapping: the `mmap` terminal command was just installed for the user",
      `(${o.binDir} was added to their user PATH). Typed in any project terminal, \`mmap\``,
      "toggles the map pane. The PATH change reaches only NEW processes \u2014 and a new tab of",
      "a running Windows Terminal inherits the old environment, so if the user says `mmap`",
      "is not recognized, tell them to close Windows Terminal entirely and reopen it."
    ].join("\n");
  }
  if (o.path === "refused" || o.path === "error") {
    const reason = typeof o.reason === "string" ? o.reason : "the PATH edit failed";
    const aliasDir = typeof o.alias === "object" && o.alias !== null && "dir" in o.alias && typeof o.alias.dir === "string" ? o.alias.dir : void 0;
    if (aliasDir !== void 0) {
      return [
        `mellos-mapping: the \`mmap\` terminal command should work: its shims live in`,
        `${o.binDir}, and \u2014 because the user PATH could not be changed (${reason}) \u2014 a second copy`,
        `was written to ${aliasDir}, a directory PATH already names (so \`mmap\` resolves there unless`,
        "something earlier in PATH claims the name first).",
        "The user can therefore type `mmap` in a new terminal right now; the command opens the map",
        "pane for the project it is typed in, or closes the open one."
      ].join("\n");
    }
    return [
      `mellos-mapping: the \`mmap\` command's launcher was written to ${o.binDir},`,
      `but the user PATH was NOT changed: ${reason}.`,
      "If the user wants the `mmap` pane-toggle command, tell them to add that directory to",
      'their user PATH (Settings > "Edit environment variables for their account").'
    ].join("\n");
  }
  return void 0;
}
function ensureMmapCommand(pluginRoot) {
  if (process.platform !== "win32") return void 0;
  const localAppData = process.env["LOCALAPPDATA"];
  if (localAppData === void 0 || localAppData === "") return void 0;
  const mmapPath = join4(pluginRoot, "dist", "mmap.mjs");
  const shim = readIfPresent(mmapShimFilePath(localAppData));
  const resolves = mmapShimCurrent(shim, mmapPath) && mmapCommandResolves(
    localAppData,
    mmapPath,
    { path: process.env["PATH"] ?? "", home: process.env["USERPROFILE"] ?? process.env["HOME"] },
    readIfPresent,
    existsSync
  );
  if (resolves) return void 0;
  const runtime = "bun" in process.versions ? "node" : process.execPath;
  const run = spawnSync(
    runtime,
    [join4(pluginRoot, "scripts", "install-mmap-command.mjs"), "--json"],
    { encoding: "utf8", windowsHide: true, timeout: 15e3 }
  );
  if (run.status !== 0 || typeof run.stdout !== "string") return void 0;
  let outcome;
  try {
    outcome = JSON.parse(run.stdout);
  } catch {
    return void 0;
  }
  return installContextLine(outcome);
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
  const stateFile = join4(projectDir, STATE_FILE_RELATIVE_PATH);
  const scopes = effectiveMappingPolicy(configFilePath(stateFile), userConfigFilePath(homedir()));
  if (!scopes.ok) return;
  const pluginRoot = dirname4(dirname4(fileURLToPath(import.meta.url)));
  const context = sessionStartContext({
    policy: scopes.value.effective,
    hasStore: hasMap(stateFile)
  });
  let installNote;
  try {
    installNote = ensureMmapCommand(pluginRoot);
  } catch {
    installNote = void 0;
  }
  const parts = [context, installNote].filter((p) => p !== void 0);
  if (parts.length > 0) process.stdout.write(hookOutput(parts.join("\n\n")));
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

// src/host/session-context.ts
import { homedir as homedir2 } from "node:os";
import { join as join5 } from "node:path";
var SESSION_CONTEXT_TYPE = "mellos-mapping.session-context";
function sessionParagraph(projectDir) {
  const stateFile = join5(projectDir, STATE_FILE_RELATIVE_PATH);
  const scopes = effectiveMappingPolicy(configFilePath(stateFile), userConfigFilePath(homedir2()));
  if (!scopes.ok) return void 0;
  return sessionStartContext({ policy: scopes.value.effective, hasStore: hasMap(stateFile) });
}
function storeIsReadable(projectDir) {
  const stateFile = join5(projectDir, STATE_FILE_RELATIVE_PATH);
  return effectiveMappingPolicy(configFilePath(stateFile), userConfigFilePath(homedir2())).ok;
}

// src/host/omp/extension.ts
function mellosMappingOmp(pi) {
  const pluginRoot = dirname5(dirname5(fileURLToPath2(import.meta.url)));
  let armed = true;
  let installNote;
  let told;
  const rearm = async () => {
    armed = true;
  };
  pi.setLabel?.("Mellos Mapping");
  pi.on("session_start", async () => {
    armed = true;
    try {
      installNote = ensureMmapCommand(pluginRoot);
    } catch {
      installNote = void 0;
    }
  });
  pi.on("session_switch", rearm);
  pi.on("session_branch", rearm);
  pi.on("session_compact", rearm);
  pi.on("before_agent_start", async (_event, ctx) => {
    const cwd = ctx !== null && typeof ctx === "object" && "cwd" in ctx ? ctx.cwd : void 0;
    const projectDir = typeof cwd === "string" && cwd !== "" ? cwd : process.cwd();
    let paragraph;
    let broken = false;
    try {
      paragraph = sessionParagraph(projectDir);
    } catch {
      paragraph = void 0;
    }
    if (paragraph === void 0) {
      broken = !storeIsReadable(projectDir);
    }
    const content = [paragraph, installNote].filter((part) => part !== void 0).join("\n\n");
    const owed = armed || paragraph !== void 0 && paragraph !== told;
    if (!owed || broken || content === "") {
      if (!broken) armed = false;
      return void 0;
    }
    armed = false;
    told = paragraph;
    const message = {
      customType: SESSION_CONTEXT_TYPE,
      content,
      // Standing instruction, not conversation: the model reads it, and the
      // transcript does not grow a message the user never sent.
      display: false,
      attribution: "agent"
    };
    return { message };
  });
}
export {
  mellosMappingOmp as default
};
