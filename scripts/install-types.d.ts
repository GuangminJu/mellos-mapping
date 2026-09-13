/** Type-only contracts shared by the dependency-free installation adapters. */
export interface ReleaseManifest {
  edition: 'claude' | 'chatgpt-app';
  version: string;
  sha256: Record<string, string>;
}
export interface HostResult {
  status: number | null;
  stdout?: string | Buffer | undefined;
  stderr?: string | Buffer | undefined;
  error?: Error | undefined;
}
export type HostRunner = (args: string[]) => HostResult;
export interface HostPlugin {
  id?: string;
  pluginId?: string;
  enabled?: boolean;
  version?: string;
  installPath?: string;
  source?: { path?: string };
}
