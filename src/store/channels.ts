import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type PageId, makePageId } from './format.js';
import { isRecord, stripBom } from './json-text.js';
import { viewersDirPath } from './viewers.js';

// ---------------------------------------------------------------------------
// focus requests — "show this page" messages from pane openers to the watcher
// ---------------------------------------------------------------------------
//
// State files flow one way, MCP server → watcher; a launcher that wants an
// ALREADY-RUNNING pane to show a particular page has no channel to it. The
// focus file is that channel, one-shot on purpose: the watcher consumes the
// request AND DELETES the file, so a request lives about one poll tick —
// nothing stale survives to misdirect tomorrow's pane, and the project's git
// status barely ever sees the file exist.

/** Sibling of the default file carrying a one-shot "show this page" request. */
export const FOCUS_FILE_NAME = 'focus';

export function focusFilePath(defaultFile: string, pid?: number): string {
  return paneChannelPath(defaultFile, FOCUS_FILE_NAME, pid);
}

/** A targeted message cannot be consumed by another pane of the same project. */
function paneChannelPath(defaultFile: string, channel: string, pid?: number): string {
  if (pid === undefined) return join(dirname(defaultFile), channel);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid pane process id');
  return join(viewersDirPath(defaultFile), `${pid}.${channel}`);
}

/** A consumed focus request: the page to show (undefined = the default page). */
export interface FocusRequest {
  readonly page: PageId | undefined;
}

/**
 * Consume a pending focus request: read it, delete the file, return it.
 * Absent file — the overwhelmingly common case — or junk content means no
 * request; the channel is best-effort and junk is swept by the same delete.
 */
export function takeFocusRequest(defaultFile: string, pid?: number): FocusRequest | undefined {
  const targeted = pid === undefined ? undefined : focusFilePath(defaultFile, pid);
  const path = targeted !== undefined && existsSync(targeted) ? targeted : focusFilePath(defaultFile);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    rmSync(path, { force: true });
  } catch {
    // deletion is a courtesy: re-consuming next tick is harmless because
    // switching to the already-shown page is a no-op
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const page = (parsed as { readonly page?: unknown }).page;
  if (page === undefined || page === null) return { page: undefined };
  if (typeof page !== 'string') return undefined;
  const id = makePageId(page);
  return id.ok ? { page: id.value } : undefined;
}

// ---------------------------------------------------------------------------
// quit requests — "close yourself" messages from the toggle to the watcher
// ---------------------------------------------------------------------------
//
// The mirror of the focus file, and there for the same reason: a human who
// types `mmap` in some OTHER terminal has no channel to the pane that is
// already running. The quit file is that channel, one-shot on purpose — the
// watcher consumes the request AND DELETES the file, so a request lives about
// one poll tick and nothing stale survives to close tomorrow's pane.
//
// The request carries no payload. A pane belongs to one store, so "close the
// pane watching this store" has nothing to say beyond being asked.

/** Sibling of the default file carrying a one-shot "close the pane" request. */
export const QUIT_FILE_NAME = 'quit';

export function quitFilePath(defaultFile: string, pid?: number): string {
  return paneChannelPath(defaultFile, QUIT_FILE_NAME, pid);
}

/**
 * Consume a pending quit request: read it, delete the file, say whether there
 * was one. Absent file — the overwhelmingly common case — or content that is
 * not a JSON object means NO request; the channel is best-effort and junk is
 * swept by the same delete.
 *
 * The empty JSON object is the whole grammar. It exists so that a stray file
 * of this name — an editor backup, a half-written write from a foreign tool —
 * cannot take a live pane down by accident; a pane closing is the one thing
 * in this channel a user cannot undo by waiting.
 */
export function takeQuitRequest(defaultFile: string, pid?: number): boolean {
  const targeted = pid === undefined ? undefined : quitFilePath(defaultFile, pid);
  const path = targeted !== undefined && existsSync(targeted) ? targeted : quitFilePath(defaultFile);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  sweepQuitRequest(defaultFile, path === targeted ? pid : undefined);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch {
    return false;
  }
  return isRecord(parsed);
}

/**
 * Delete a quit request WITHOUT acting on it — the same file, read as a
 * leftover rather than as a message.
 *
 * A toggle that wrote the request and then lost its watcher (a crash, a
 * closed window, a `taskkill`) leaves the file behind, and the next pane to
 * open would consume it on its first tick and close instantly. The watcher
 * sweeps at STARTUP for exactly that: a request that predates the pane cannot
 * have been addressed to it. Best-effort, like every delete in this channel.
 */
export function sweepQuitRequest(defaultFile: string, pid?: number): void {
  try {
    rmSync(quitFilePath(defaultFile, pid), { force: true });
  } catch {
    // The file is unreachable for some reason the next tick will meet again;
    // re-consuming a request we cannot delete only closes a pane the user
    // asked to close.
  }
}
