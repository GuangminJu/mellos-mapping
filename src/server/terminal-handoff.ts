/** Values for a host-owned terminal. Preparing a command never opens a window. */
export function terminalHandoff(node: string, watcher: string, stateFile: string, page?: string) {
  const args = [watcher, '--file', stateFile, ...(page ? ['--page', page] : [])];
  const tokens = [node, ...args];
  if (tokens.some(token => /[\r\n\0]/.test(token))) throw new Error('Terminal paths must fit on one line.');
  const powershell = (token: string) => `'${token.replaceAll("'", "''")}'`;
  const posix = (token: string) => `'${token.replaceAll("'", "'\"'\"'")}'`;
  return {
    command: node, args,
    powershell: `& ${tokens.map(powershell).join(' ')}`,
    posix: tokens.map(posix).join(' '),
    hostOpen: { placement: 'right', target: { type: 'terminal' } },
  };
}
