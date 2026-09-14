/** Optional portable provenance; no host paths or I/O in the map format. */
export interface SourceRef { readonly path: string; readonly sha256?: string | undefined }
export interface MapContext { readonly summary?: string | undefined; readonly next?: string | undefined }
export function sourceError(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length > 100) return 'sources must be an array of at most 100 file references';
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'source must be an object';
    const s = item as Record<string, unknown>;
    if (Object.keys(s).some(k => k !== 'path' && k !== 'sha256')) return 'unknown source field';
    if (typeof s.path !== 'string' || s.path.length > 1024 || !s.path || /[\u0000-\u001f\u007f-\u009f\\:]/.test(s.path) || s.path.startsWith('/') || s.path.split('/').some(p => !p || p === '.' || p === '..')) return 'source path must be relative to the project, with forward slashes and no traversal';
    if (s.sha256 !== undefined && (typeof s.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(s.sha256))) return 'source sha256 must be a lowercase SHA256 hash';
  }
  return undefined;
}
export function contextError(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'context must be an object';
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'summary' && key !== 'next') return 'unknown context field';
    if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value)) return 'context fields must be text of at most 2000 characters';
  }
  return undefined;
}
