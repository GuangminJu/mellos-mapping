/** Terminal mode lifetime, independent of map rendering and input decoding. */
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ENTER_SCREEN = '\x1b[?1049h';
const LEAVE_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[H\x1b[2J';
const MOUSE_ON = '\x1b[?1003h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1003l\x1b[?1006l';
const RESET = '\x1b[0m';

export function terminalRestoreSequence(mouseActive: boolean, alternateScreen = false): string {
  return (mouseActive ? MOUSE_OFF : '') + RESET + (alternateScreen ? LEAVE_SCREEN : '') + SHOW_CURSOR +
    (alternateScreen ? '' : '\n');
}

/**
 * Embedded terminals may reset their emulator and replay only recent output
 * when a panel is remounted. The initial DECSET can have left that buffer:
 * the picture returns, but wheel/drag become scrollback/text selection.
 * Reassert mouse modes even on an idle map, without clearing or re-entering
 * the alternate screen. Disposal stops the heartbeat before restoring the
 * shell, so a late refresh cannot steal its mouse back.
 */
export function openTerminalSession(options: {
  readonly interactive: boolean;
  readonly mouse: boolean;
  readonly write: (text: string) => void;
}): { close(): void } {
  const { interactive, write } = options;
  const mouseActive = interactive && options.mouse;
  write((interactive ? ENTER_SCREEN : '') + HIDE_CURSOR + CLEAR_SCREEN + (mouseActive ? MOUSE_ON : ''));
  const timer = mouseActive ? setInterval(() => write(HIDE_CURSOR + MOUSE_ON), 1000) : undefined;
  timer?.unref();
  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      write(terminalRestoreSequence(mouseActive, interactive));
    },
  };
}
