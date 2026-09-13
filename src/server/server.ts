/**
 * Layer 3 — the MCP server: six tools over one state file.
 *
 *   mmap_declare  grow the map (title, bands, lanes, groups, nodes, edges)
 *   mmap_update   record progress AND revise (status, evidence, moves, renames)
 *   mmap_remove   take things off the map (edges, nodes, groups, lanes, bands)
 *                 — and whole PAGES, file and all
 *   mmap_view     render the map as text, and name the project's pages
 *   mmap_setup    get/set the mapping policy (when maps open), user-wide by
 *                 default and per-project where a project must differ
 *   mmap_open     put the map on the user's screen — the one tool that reaches
 *                 outside the store, by running the same launcher a human runs
 *
 * Every write and view reports the live watcher and its current page.
 * Heartbeats establish process presence; only a host adapter can verify
 * whether its terminal pane is visible at the time of an explicit open.
 *
 * Every mutating call is load -> apply (all-or-nothing, Layer 2) -> save
 * (atomic, Layer 1). The server holds no map state between calls: the file
 * is the single source of truth, so several sessions against one project
 * stay consistent per call. A save that does not land changes nothing and is
 * reported as such — see saveFailed — so a refused write never leaves the
 * caller believing the ledger recorded something it did not.
 *
 * Deleting a PAGE is the one operation outside that transaction, and it lives
 * here rather than in Layer 2 for exactly that reason: apply.ts revises ONE
 * map as a value, and a page file is not in any map. So `mmap_remove {pages}`
 * is orchestration — validate every slug, apply the call's map edits, then
 * delete the files — and apply.ts stays pure of I/O.
 *
 * The state file lives in the project the CLIENT is working in, resolved in
 * this order: MELLOS_MAPPING_CWD (explicit override for manual runs),
 * CLAUDE_PROJECT_DIR (set by Claude Code for plugin MCP servers — the
 * documented contract), then this process's cwd as the last resort.
 *
 * The mapping policy is the one piece of state that also lives OUTSIDE the
 * project, in the user's own configuration. Both paths are resolved at the
 * entry point and handed to buildServer; nothing below reads an environment
 * variable or a home directory for itself.
 */

import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  type MellosMap,
  type Result,
} from '../domain/types.js';
import { clampZoom, renderMap } from '../render/render.js';
import {
  MAPPING_POLICIES,
  type MappingPolicy,
  type PageId,
  type PolicyScope,
  STATE_FILE_RELATIVE_PATH,
  type StoreError,
  configFilePath,
  deletePageFile,
  describeMappingPolicy,
  describeStoreError,
  effectiveMappingPolicy,
  listPageFiles,
  migrateLegacyStore,
  pageFilePath,
  pageIdOfFile,
  saveMappingPolicy,
  userConfigFilePath,
} from '../store/store.js';
import { applyDeclare, applyRemove, applyUpdate, summarize } from './apply.js';
import { createPreviewPublisher, previewFile } from '../preview/publisher.js';
import { openWebPreview, webRuntimeFile } from '../web/launcher.js';
import { terminalHandoff } from './terminal-handoff.js';

import { declareTool, updateTool, removeTool, setupTool, viewTool, openTool } from './tool-definitions.js';
import { pagesLine, paneLine } from './presence.js';
import { loadOrEmpty, mutateMap } from './map-service.js';
import { type LauncherRun, launchPane, awaitPane, paneShows, launcherViewerPid, PANE_REPORT_TIMEOUT_MS, launcherArgs, projectDirOf, openOutcome } from './pane-launcher.js';
export { type LauncherRun, launcherPath, launcherArgs, projectDirOf, openOutcome } from './pane-launcher.js';

export const SERVER_NAME = 'mellos-mapping';
export const SERVER_VERSION = '0.22.0';

interface ToolText {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function text(s: string, isError = false): ToolText {
  return { content: [{ type: 'text', text: s }], ...(isError ? { isError: true } : {}) };
}

/**
 * The one answer to a write that did not land, so both save sites say the
 * same thing: the previous file is intact, this call changed nothing, and
 * calling again is the whole recovery.
 */
function saveFailed(error: StoreError): ToolText {
  return text(`save failed, nothing changed (retry): ${describeStoreError(error)}`, true);
}

/**
 * Build the MCP server bound to one project's store.
 *
 * @param stateFile - the project's DEFAULT page file; every page and the
 *   project-scope configuration are derived from it.
 * @param userConfigFile - the USER-scope configuration file
 *   ({@link userConfigFilePath}). Passed in rather than resolved here, so a
 *   spec's server can never read — or write — the developer's real one.
 * Exported for tests.
 */
export function buildServer(stateFile: string, userConfigFile: string, launch: (args: readonly string[]) => Promise<LauncherRun> = launchPane): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  // Session-local failure feedback prevents each map write from re-requesting
  // the same unavailable terminal. An explicit successful retry clears it.
  let paneOpenFailure: string | undefined;
  const currentPaneLine = (page: string | undefined): string => paneLine(stateFile, page, paneOpenFailure);
  const projectConfigFile = configFilePath(stateFile);
  const previews = createPreviewPublisher(stateFile);
  const refreshPreview = (page: string | undefined): string => {
    if (!previews.enabled()) return '';
    const published = previews.refresh(page as PageId | undefined);
    return published.ok
      ? `\npreview: updated\nmarkdown: ${published.value.path}\nFile generated; desktop visibility is not tracked.`
      : `\npreview: STALE — map changes were saved, but preview generation failed: ${published.error}. Retry mmap_open {surface: "markdown"}; do not repeat the map mutation.`;
  };

  // The zod PAGE schema enforces the exact PageId grammar, so the cast at
  // this boundary cannot smuggle in an invalid slug.
  const fileOf = (page: string | undefined): string => pageFilePath(stateFile, page as PageId | undefined);

  const mutate = (page: string | undefined, apply: (map: MellosMap) => Result<MellosMap, string>): ToolText => {
    const result = mutateMap(fileOf(page), apply);
    if (!result.ok) {
      const failure = result.error;
      if (failure.kind === 'save') return saveFailed(failure.error);
      return text(failure.kind === 'refused' ? `refused (nothing changed): ${failure.detail}` : failure.detail, true);
    }
    return text(summarize(result.value) + (page !== undefined ? ` [page: ${page}]` : '') + refreshPreview(page));
  };


  /**
   * Append the pane line to a result that actually happened.
   *
   * Refusals and failed saves are left alone: they are about the CALL, and
   * telling a caller who was watching a write that did not occur would only
   * bury the reason it did not.
   */
  const withPane = (result: ToolText, page: string | undefined): ToolText =>
    result.isError === true || previews.enabled() ? result : text(`${result.content[0]?.text ?? ''}\n${existsSync(webRuntimeFile(stateFile)) ? 'web: configured — the browser reads project map updates. Use mmap_open {surface: "web", page} to open or reconnect; desktop visibility is not tracked.' : currentPaneLine(page)}`);
  /** The named pages this project has right now, read from the store. */
  const knownPages = (): PageId[] =>
    listPageFiles(stateFile)
      .map((f) => pageIdOfFile(stateFile, f))
      .filter((p): p is PageId => p !== undefined);

  /**
   * The VALIDATE half of `mmap_remove {pages}` — everything that can be
   * refused while the store is still untouched.
   * @returns the refusal, or undefined when every slug may be deleted.
   *
   * Two rules, both stricter than the store primitive underneath (which
   * happily deletes a page that is already gone):
   *
   *   - A call may not delete the page it is itself editing. `page` chooses
   *     the map this call loads, applies to and saves; deleting that same
   *     page in the same call is a request with two answers, and the save
   *     would simply recreate what the deletion removed.
   *   - An unknown slug is a REFUSAL, not a no-op. deletePageFile treats an
   *     absent file as the goal state already reached, which is right for a
   *     primitive; at the tool surface the caller is a model that just typed
   *     a name, and a name that matches no page is far more likely a typo
   *     than a page someone else deleted a moment ago. The refusal names the
   *     project's real pages, so the next call can be right.
   */
  const refusePageDeletion = (pages: readonly string[], target: string | undefined): ToolText | undefined => {
    if (target !== undefined && pages.includes(target)) {
      return text(
        `refused (nothing changed): pages includes "${target}", the page this call targets — ` +
          'one call must not edit a map it is deleting. Delete it from a call that does not target it.',
        true,
      );
    }
    const known = knownPages() as readonly string[];
    const unknown = pages.filter((p) => !known.includes(p));
    if (unknown.length > 0) {
      return text(
        `refused (nothing changed): no page named ${unknown.map((p) => `"${p}"`).join(', ')}. ` +
          `This project's named pages: ${known.length > 0 ? known.join(', ') : '(none)'}.`,
        true,
      );
    }
    return undefined;
  };

  /**
   * The COMMIT half of `mmap_remove {pages}`: every slug is known to exist
   * and none is this call's own page. Deletions are not a transaction — a
   * file that is gone cannot come back if the next one fails — so a partial
   * batch reports exactly which pages went and which did not, rather than
   * pretending it rolled anything back.
   * @param summary - the map-edit summary to carry, already newline-ended.
   */
  const deletePages = (pages: readonly string[], summary: string): ToolText => {
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const p of pages) {
      const removed = deletePageFile(pageFilePath(stateFile, p as PageId));
      if (removed.ok) deleted.push(p);
      else failed.push(`${p} (${describeStoreError(removed.error)})`);
    }
    const gone = `deleted page(s): ${deleted.length > 0 ? deleted.join(', ') : '(none)'}` + (deleted.length ? refreshPreview(undefined) : '');
    if (failed.length === 0) return text(`${summary}${gone}`);
    return text(
      `${summary}${gone}; could NOT delete: ${failed.join('; ')}. ` +
        'Deleting files is not a transaction: what is named deleted above is gone for good, ' +
        'and only the failures are worth retrying.',
      true,
    );
  };

  /**
   * The last-resort acquisition path for the setup question.
   *
   * A declare carries this note only while NEITHER scope has a policy — so it
   * fires at most until the user's one-time, user-level answer, and after that
   * it is silent forever, in every project they ever open.
   *
   * Why it survives at all now that Claude Code asks the question from a
   * SessionStart hook (src/hook/session-start.ts): other hosts have no hooks.
   * Under Codex CLI, or any bare MCP client, this note is the ONLY thing that
   * ever tells the assistant to ask. It never blocks (the ledger is not a
   * judge); a broken config file is surfaced here the same way instead of
   * being silently treated as unset.
   */
  const setupNudge = (): string => {
    const scopes = effectiveMappingPolicy(projectConfigFile, userConfigFile);
    if (!scopes.ok) return `\nnote: ${describeStoreError(scopes.error)} — fix it or rerun setup (mmap_setup).`;
    if (scopes.value.effective !== undefined) return '';
    return (
      '\nnote: no mapping policy has been chosen yet. Ask the user when maps should open — ' +
      MAPPING_POLICIES.map((p) => `${p} (${describeMappingPolicy(p)})`).join('; ') +
      ' — then record the answer with mmap_setup. It is asked once ever, not once per project.'
    );
  };

  server.registerTool(
    'mmap_declare',
    declareTool(),
    (input) => {
      const result = withPane(mutate(input.page, (map) => applyDeclare(map, input)), input.page);
      if (result.isError === true) return result;
      const nudge = setupNudge();
      return nudge === '' ? result : text((result.content[0]?.text ?? '') + nudge);
    },
  );

  server.registerTool(
    'mmap_update',
    updateTool(),
    (input) => withPane(mutate(input.page, (map) => applyUpdate(map, input)), input.page),
  );

  server.registerTool(
    'mmap_remove',
    removeTool(),
    (input) => {
      if (input.pages === undefined) return withPane(mutate(input.page, (map) => applyRemove(map, input)), input.page);
      // validate → prepare → commit: everything refusable is refused before
      // the first file is touched, because a deletion has no rollback.
      const refusal = refusePageDeletion(input.pages, input.page);
      if (refusal !== undefined) return refusal;
      const editsAnything =
        (input.edges?.length ?? 0) +
          (input.nodes?.length ?? 0) +
          (input.groups?.length ?? 0) +
          (input.lanes?.length ?? 0) +
          (input.layers?.length ?? 0) >
        0;
      let summary = '';
      if (editsAnything) {
        // A call that only deletes pages must touch no map at all: mutate
        // would load a missing default page as EMPTY_MAP and save it, so a
        // bare `{pages: [...]}` would create the very file it never named.
        const edited = mutate(input.page, (map) => applyRemove(map, input));
        if (edited.isError === true) return edited; // edits refused: nothing deleted either
        summary = `${edited.content[0]?.text ?? ''}\n`;
      }
      return withPane(deletePages(input.pages, summary), input.page);
    },
  );

  server.registerTool(
    'mmap_setup',
    setupTool(),
    (input) => {
      // zod enforced both enums; the casts at this boundary cannot widen them
      const scope = (input.scope ?? 'user') as PolicyScope;
      const configFile = scope === 'project' ? projectConfigFile : userConfigFile;
      if (input.policy !== undefined) {
        const policy = input.policy as MappingPolicy;
        const saved = saveMappingPolicy(configFile, policy);
        if (!saved.ok) return saveFailed(saved.error);
        const reach =
          scope === 'user'
            ? 'applies to EVERY project this user opens; a single project can still override it with ' +
              'mmap_setup {policy, scope: "project"}'
            : 'applies to THIS project only, overriding the user-level choice';
        return text(
          `mapping policy set (${scope} scope): ${policy} — ${describeMappingPolicy(policy)}. ` +
            `${reach}. [${configFile}]`,
        );
      }
      const scopes = effectiveMappingPolicy(projectConfigFile, userConfigFile);
      if (!scopes.ok) return text(describeStoreError(scopes.error), true);
      const { user, project, effective, source } = scopes.value;
      const said = (p: MappingPolicy | undefined): string => (p === undefined ? 'not set' : p);
      const heading = `mapping policy — user: ${said(user)}; project: ${said(project)}`;
      if (effective === undefined) {
        return text(
          `${heading}. Nobody has chosen yet. Ask the user to choose one of: ` +
            MAPPING_POLICIES.map((p) => `${p} (${describeMappingPolicy(p)})`).join('; ') +
            ' — then call mmap_setup with their choice (scope defaults to user, which is what you want: ' +
            'the question is asked once ever). Until then act as complex.',
        );
      }
      return text(`${heading}. In effect: ${effective} (${source} scope) — ${describeMappingPolicy(effective)}`);
    },
  );

  server.registerTool(
    'mmap_view',
    viewTool(),
    (input) => {
      const current = loadOrEmpty(fileOf(input.page));
      if (!current.ok) return text(current.error, true);
      const zoom = clampZoom(input.zoom ?? 0);
      const picture = renderMap(current.value, { color: false, unicode: true, spinnerFrame: 0, zoom }).join('\n');
      const surface = previews.enabled()
        ? `markdown: ${previewFile(stateFile, input.page as PageId | undefined)}\nUse mmap_open {surface: "markdown", page} to regenerate. Desktop visibility is not tracked.`
        : existsSync(webRuntimeFile(stateFile)) ? 'web: configured — use mmap_open {surface: "web", page} to open or reconnect. Desktop visibility is not tracked.' : currentPaneLine(input.page);
      return text(`${picture}\n${pagesLine(stateFile, input.page)}\n${surface}`);
    },
  );

  server.registerTool(
    'mmap_open',
    openTool(),
    async (input) => {
      if (input.surface === 'codex-terminal') {
        if (input.window === true) return text('codex-terminal uses the current conversation panel; window: true is not supported.', true);
        if (input.page && !listPageFiles(stateFile).some(file => pageIdOfFile(stateFile, file) === input.page)) {
          return text(`Unknown page: ${input.page}. ${pagesLine(stateFile, input.page)}`, true);
        }
        const handoff = terminalHandoff(process.execPath, fileURLToPath(new URL('./watch.mjs', import.meta.url)), stateFile, input.page);
        return text('terminal: ready-to-start\n' + JSON.stringify(handoff, null, 2) + '\n' +
          'Use open_in_codex with hostOpen in the CURRENT conversation, without a threadId. ' +
          'If a supported host tool can run commands in that user terminal, use it. Otherwise give the user the command for their shell to paste once. ' +
          'An exec_command session_id belongs to the agent PTY, not this terminal. queued is not visible, and opened is not running. ' +
          'Use read_thread_terminal to confirm the map title and controls after startup. Preserve a page the user pinned.');
      }
      if (input.surface === 'web' || input.surface === 'web-terminal') {
        if (input.window === true) return text('surface: "web" cannot be combined with window: true. Open the returned URL using the desktop host.', true);
        try {
          const url = await openWebPreview(stateFile, fileURLToPath(new URL('./web.mjs', import.meta.url)), input.page, input.surface === 'web-terminal');
          return text(`surface: ${input.surface}\nhostOpen: ${JSON.stringify({ placement: 'right', target: { type: 'browser', url } })}\npreview: ready\nweb: ${url}\nOpen this URL in the current conversation's right browser panel using the host tool. The viewer refreshes from project maps while open. Existing Markdown previews remain enabled. Desktop visibility is not confirmed by this tool.`);
        } catch (error) { return text(`Could not open web preview: ${String(error)}`, true); }
      }
      if (input.surface === 'markdown') {
        if (input.window === true) return text('surface: "markdown" cannot be combined with window: true. Open the returned file using the desktop host.', true);
        const published = previews.activate(input.page as PageId | undefined);
        if (!published.ok) return text(`Could not generate Markdown preview: ${published.error}`, true);
        return text(`preview: ready\nmarkdown: ${published.value.path}\nindex: ${published.value.index}\n` +
          'Automatic preview updates are enabled for this project. Open the Markdown file in the current conversation\'s right file panel using the host tool. ' +
          'No terminal was launched. Visibility and automatic file-viewer refresh are not confirmed by this tool.');
      }
      const run = await launch(launcherArgs(projectDirOf(stateFile), input.page, input.window === true));
      const viewers = run.ok ? await awaitPane(stateFile, input.page, Date.now() + PANE_REPORT_TIMEOUT_MS, launcherViewerPid(run)) : [];
      const outcome = openOutcome(run, viewers, input.page);
      const failed = !run.ok || !paneShows(viewers, input.page);
      paneOpenFailure = failed ? outcome : undefined;
      return text(outcome, failed);
    },
  );

  return server;
}

/** Resolve where the map file lives; see module header for the precedence contract. */
export function resolveStateFile(env: NodeJS.ProcessEnv, cwd: string): string {
  const projectDir = env['MELLOS_MAPPING_CWD'] ?? env['CLAUDE_PROJECT_DIR'] ?? cwd;
  return join(projectDir, STATE_FILE_RELATIVE_PATH);
}

/**
 * Resolve where the USER-scope configuration lives. The home directory is
 * read HERE, at the entry point, and nowhere else: everything below takes the
 * resolved path, so no spec can be one refactor away from writing the
 * developer's own configuration.
 */
export function resolveUserConfigFile(home: string): string {
  return userConfigFilePath(home);
}

async function main(): Promise<void> {
  const stateFile = resolveStateFile(process.env, process.cwd());
  const userConfigFile = resolveUserConfigFile(homedir());
  // One-time move of a pre-0.20 `.claude` store into `.mellos` (store.ts).
  // Say so on stderr — stdout is the MCP protocol — or the move looks like the
  // server deleting a tracked directory behind the user's back.
  if (migrateLegacyStore(stateFile)) console.error('mellos-mapping: moved the legacy .claude map store to .mellos/ — commit the move.');
  const server = buildServer(stateFile, userConfigFile);
  await server.connect(new StdioServerTransport());
}

/**
 * Run only as an entry point; importing this module (tests) must be inert.
 * npm bin shims launch through a symlink and shells may pass relative paths,
 * so argv[1] is compared by real path, with URL equality as the fallback
 * when either path cannot be resolved.
 */
export function launchedAsEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return pathToFileURL(argv1).href === moduleUrl;
  }
}

if (launchedAsEntry(process.argv[1], import.meta.url)) {
  // A rejected connect leaves nothing to recover — surface it and exit non-zero.
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
