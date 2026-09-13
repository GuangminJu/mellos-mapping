/** Watcher arguments shared by terminal adapters and the copyable fallback. */
export function watcherArgs(cfg, watchPath, mapFile) {
  const args = [watchPath, '--file', mapFile, ...cfg.watcherFlags];
  if (cfg.pageSlug !== undefined) args.push('--page', cfg.pageSlug);
  return args;
}

/** POSIX shell quoting is only for the human fallback; adapters use argv. */
export function manualWatcherCommand(cfg, watchPath, mapFile, nodePath = process.execPath) {
  return [nodePath, ...watcherArgs(cfg, watchPath, mapFile)]
    .map(arg => "'" + arg.replaceAll("'", "'\"'\"'") + "'").join(' ');
}

export function paneFailureMessage(error, cfg, watchPath, mapFile, platform = process.platform) {
  return platform === 'win32' ? error : `${error}\nAutomatic opening failed. Do not retry until the terminal environment changes. Run this command in a visible terminal:\n${manualWatcherCommand(cfg, watchPath, mapFile)}`;
}
