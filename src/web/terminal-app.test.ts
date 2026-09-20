import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Execute the real browser composition root with DOM/xterm/transport adapters.
 * These tests cover application focus requests, not native dialog restoration,
 * IME behavior, or focus transfer between the host's separate webviews.
 */
function browser() {
  const document = Object.assign(new EventTarget(), { documentElement: new EventTarget(), activeElement: undefined as ElementStub | undefined, hasFocus: vi.fn(() => false), visibilityState: 'visible', getElementById: (id: string) => elements.get(id) });
  class ElementStub extends EventTarget {
    value = '13';
    options = [{ value: '13' }];
    dataset: Record<string, string> = {};
    hidden = false;
    disabled = false;
    open = false;
    textContent = '';
    focus() {
      if (this.disabled) return;
      if (document.activeElement !== this) document.activeElement?.blur();
      document.activeElement = this; document.hasFocus.mockReturnValue(true);
    }
    blur() {
      if (document.activeElement !== this) return;
      document.activeElement = undefined; this.dispatchEvent(new Event('blur'));
    }
    showModal() { this.open = true; }
  }
  const elements = new Map(['terminal', 'connection', 'restart', 'keyboard', 'font-size', 'graphic', 'help', 'help-dialog'].map(id => [id, new ElementStub()]));
  const element = (id: string) => elements.get(id)!;
  const textarea = new ElementStub();
  let dataListener: (data: string) => void;
  let keyHandler: (event: KeyboardEvent) => boolean;
  const terminal = {
    textarea, cols: 80, rows: 24, options: { fontSize: 13 },
    loadAddon: vi.fn(), open: vi.fn(), reset: vi.fn(), dispose: vi.fn(), blur: vi.fn(),
    focus: vi.fn(() => textarea.focus()),
    resize: vi.fn((cols: number, rows: number) => { terminal.cols = cols; terminal.rows = rows; }),
    write: vi.fn((_data: string, complete: () => void) => complete()),
    onData(listener: typeof dataListener) { dataListener = listener; },
    attachCustomKeyEventHandler(handler: typeof keyHandler) { keyHandler = handler; },
  };
  const connections: Socket[] = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    sent: unknown[] = [];
    constructor() { super(); connections.push(this); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    open() { this.readyState = Socket.OPEN; this.dispatchEvent(new Event('open')); }
    disconnect(code = 1006) { this.close(); this.dispatchEvent(Object.assign(new Event('close'), { code })); }
    receive(data: string) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ type: 'data', data }) })); }
  }
  const window = new EventTarget();
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('location', { href: 'http://127.0.0.1:9000/token/?view=terminal' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.doMock('@xterm/xterm', () => ({ Terminal: function (options: typeof terminal.options) { terminal.options = options; return terminal; } }));
  vi.doMock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return { cols: 80, rows: 24 }; } } }));
  const starNotice = vi.fn();
  vi.doMock('./star-reminder.js', () => ({ createStarNotice: () => starNotice }));
  return {
    document, window, terminal, connections, element, starNotice,
    input: (data: string) => dataListener(data),
    activate: () => element('keyboard').dispatchEvent(new Event('click')),
    key: (properties: Partial<KeyboardEvent> = {}) => keyHandler({ type: 'keydown', key: '?', isComposing: false, keyCode: 191, ...properties } as KeyboardEvent),
  };
}

let page: ReturnType<typeof browser>;
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules();
  page = browser();
  await import('./terminal-app.js');
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  vi.doUnmock('@xterm/xterm'); vi.doUnmock('@xterm/addon-fit');
  vi.doUnmock('./star-reminder.js');
});

describe('terminal browser input ownership', () => {
  it('connects in the background without requesting keyboard focus', () => {
    page.document.visibilityState = 'hidden';
    page.connections[0]!.open();
    expect(page.element('connection').dataset.state).toBe('connected');
    expect(page.connections[0]!.sent).toContainEqual({ type: 'start', cols: 80, rows: 24 });
    expect(page.terminal.focus).not.toHaveBeenCalled();
    expect(page.document.hasFocus()).toBe(false);
    page.terminal.textarea.focus();
    expect(page.document.activeElement).toBeUndefined();
    expect(page.terminal.textarea.disabled).toBe(true);
  });

  it('does not take focus when an interrupted connection recovers', () => {
    page.connections[0]!.open();
    page.connections[0]!.disconnect();
    vi.advanceTimersByTime(1000);
    expect(page.connections).toHaveLength(2);
    page.connections[1]!.open();
    expect(page.terminal.focus).not.toHaveBeenCalled();
    expect(page.document.hasFocus()).toBe(false);
  });

  it('preserves existing terminal focus through reset and reconnection', () => {
    page.activate();
    page.connections[0]!.open();
    page.connections[0]!.disconnect();
    vi.advanceTimersByTime(1000);
    page.connections[1]!.open();
    expect(page.terminal.reset).toHaveBeenCalledTimes(2);
    expect(page.document.activeElement).toBe(page.terminal.textarea);
    expect(page.terminal.blur).not.toHaveBeenCalled();
    expect(page.terminal.focus).not.toHaveBeenCalled();
  });

  it('restores a cached page without taking focus', () => {
    page.connections[0]!.open();
    page.activate();
    page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(page.connections).toHaveLength(2);
    page.connections[1]!.open();
    expect(page.terminal.dispose).not.toHaveBeenCalled();
    expect(page.terminal.focus).not.toHaveBeenCalled();
    expect(page.terminal.textarea.disabled).toBe(true);
  });

  it('reconnects without activating keyboard input', () => {
    page.connections[0]!.open();
    page.connections[0]!.disconnect(1000);
    page.element('restart').focus();
    page.element('restart').dispatchEvent(new Event('click'));
    expect(page.terminal.focus).not.toHaveBeenCalled();
    expect(page.terminal.textarea.disabled).toBe(true);
    // A background document can retain its remembered active element.
    page.document.hasFocus.mockReturnValue(false);
    page.connections[1]!.open();
    expect(page.terminal.focus).not.toHaveBeenCalled();
    expect(page.document.hasFocus()).toBe(false);
  });

  it('keeps focus on the font selector across consecutive changes', () => {
    const font = page.element('font-size'); font.focus();
    for (const size of ['14', '15']) {
      font.value = size; font.dispatchEvent(new Event('change'));
      expect(page.terminal.options.fontSize).toBe(Number(size));
      expect(page.document.activeElement).toBe(font);
    }
    expect(page.terminal.focus).not.toHaveBeenCalled();
  });

  it('does not override the browser-restored help button on dialog close', () => {
    const button = page.element('help'); button.focus(); button.dispatchEvent(new Event('click'));
    const dialog = page.element('help-dialog'); expect(dialog.open).toBe(true);
    // Native dialog focus restoration happens before its queued close event.
    dialog.open = false; button.focus(); dialog.dispatchEvent(new Event('close'));
    expect(page.document.activeElement).toBe(button);
    expect(page.terminal.focus).not.toHaveBeenCalled();
  });

  it('does not steal focus through a delayed dialog close notification', () => {
    page.activate();
    expect(page.key()).toBe(false);
    expect(page.document.activeElement).toBe(page.element('keyboard'));
    expect(page.terminal.textarea.disabled).toBe(true);
    const dialog = page.element('help-dialog'); expect(dialog.open).toBe(true);
    dialog.open = false; page.document.hasFocus.mockReturnValue(false);
    dialog.dispatchEvent(new Event('close'));
    expect(page.terminal.focus).not.toHaveBeenCalled();
    expect(page.document.hasFocus()).toBe(false);
  });

  it('continues forwarding mouse data and rendering while the document is unfocused', () => {
    const socket = page.connections[0]!; socket.open();
    const mouse = '\x1b[<65;30;10M'; page.input(mouse);
    expect(socket.sent).toContainEqual({ type: 'input', data: mouse });
    socket.receive('updated map');
    expect(page.terminal.write).toHaveBeenCalledWith('updated map', expect.any(Function));
    expect(socket.sent).toContainEqual({ type: 'ack' });
    expect(page.terminal.options).not.toHaveProperty('disableStdin', true);
    expect(page.terminal.focus).not.toHaveBeenCalled();
  });

  it('continues notifying the optional star notice when the viewed page changes', () => {
    const socket = page.connections[0]!; socket.open();
    socket.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ type: 'view', page: 'next-map' }) }));
    expect(page.starNotice).toHaveBeenCalledWith('next-map');
    expect(page.terminal.focus).not.toHaveBeenCalled();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])('leaves composing question marks to xterm: %j', properties => {
    page.activate();
    expect(page.key(properties)).toBe(true);
    expect(page.element('help-dialog').open).toBe(false);
  });

  it.each(['window blur', 'textarea blur', 'pointer leave', 'page pointer leave', 'hidden page'])('revokes keyboard input on %s and rejects late keyup', reason => {
    page.activate();
    expect(page.document.activeElement).toBe(page.terminal.textarea);
    if (reason === 'window blur') {
      page.document.hasFocus.mockReturnValue(false); page.window.dispatchEvent(new Event('blur'));
    } else if (reason === 'textarea blur') page.element('font-size').focus();
    else if (reason === 'pointer leave') page.element('terminal').dispatchEvent(new Event('pointerleave'));
    else if (reason === 'page pointer leave') page.document.documentElement.dispatchEvent(new Event('pointerleave'));
    else { page.document.visibilityState = 'hidden'; page.document.dispatchEvent(new Event('visibilitychange')); }
    const owner = page.document.activeElement;
    expect(page.terminal.textarea.disabled).toBe(true);
    expect(page.key({ type: 'keyup', key: 'a' })).toBe(false);
    // xterm or the host may still attempt focus even with application calls removed.
    page.terminal.textarea.focus();
    expect(page.document.activeElement).toBe(owner);
    page.document.visibilityState = 'visible'; page.window.dispatchEvent(new Event('focus'));
    expect(page.terminal.textarea.disabled).toBe(true);
    page.activate();
    expect(page.document.activeElement).toBe(page.terminal.textarea);
  });

  it('releases keyboard ownership with Escape and leaves an accessible activation button', () => {
    page.activate();
    expect(page.key({ key: 'Escape' })).toBe(false);
    expect(page.terminal.textarea.disabled).toBe(true);
    expect(page.document.activeElement).toBe(page.element('keyboard'));
    expect(page.element('keyboard').disabled).toBe(false);
  });

  it('removes activation listeners when the page is disposed', () => {
    page.activate();
    page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
    page.activate();
    expect(page.terminal.textarea.disabled).toBe(true);
    expect(page.terminal.dispose).toHaveBeenCalledOnce();
  });
});
