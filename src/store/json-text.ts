
// ---------------------------------------------------------------------------
// reading text that a human may have touched — shared by every load below
// ---------------------------------------------------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Drop a leading UTF-8 byte-order mark. Windows editors (Notepad, some
 * PowerShell redirections) add one when a human edits a state file by hand,
 * and JSON.parse refuses the result — an invisible character would otherwise
 * read as "your map is corrupt". The BOM carries no meaning for us: the
 * files are UTF-8 by contract.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
