import { describe, expect, it } from 'vitest';
import { parseSessionProbe } from './terminal-session.mjs';

describe('session probe boundary', () => {
  it('separates candidate consoles from a positively identified window', () => {
    expect(parseSessionProbe('CONSOLE=split-1-20\r\nCONSOLE=split-3-40\r\nOWNER=split-3-40\r\nIDENT=88\r\n'))
      .toEqual({ owners: ['split-1-20', 'split-3-40'], owner: 'split-3-40', hwnd: '88' });
  });
  it('never invents a target from a missing or malformed probe', () => {
    for (const output of ['', 'IDENT=0', 'OWNER=split-3-40\nIDENT=88', 'CONSOLE=../../bad\nIDENT=88']) {
      expect(parseSessionProbe(output)).toEqual({ owners: [] });
    }
    expect(parseSessionProbe('CONSOLE=split-3-40\nIDENT=0')).toEqual({ owners: ['split-3-40'] });
  });
});
