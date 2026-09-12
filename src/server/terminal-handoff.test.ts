import { describe, expect, it } from 'vitest';
import { terminalHandoff } from './terminal-handoff.js';

describe('desktop terminal handoff', () => {
  it('keeps executable arguments intact and quotes shell metacharacters as data', () => {
    const result = terminalHandoff("C:/Node JS/node.exe", "C:/O'Brien/$tools/watch.mjs", "C:/项目 & files/.mellos/map.json", 'plan');
    expect(result.args).toEqual(["C:/O'Brien/$tools/watch.mjs", '--file', 'C:/项目 & files/.mellos/map.json', '--page', 'plan']);
    expect(result.powershell).toContain("'C:/O''Brien/$tools/watch.mjs'");
    expect(result.posix).toContain("'C:/O'\"'\"'Brien/$tools/watch.mjs'");
    expect(result.hostOpen).toEqual({ placement: 'right', target: { type: 'terminal' } });
    expect(terminalHandoff('node', '/watch', '/map').args).toEqual(['/watch', '--file', '/map']);
  });

  it('rejects line breaks instead of producing a multi-command paste', () => {
    expect(() => terminalHandoff('node', '/watch', '/a\nb')).toThrow('one line');
  });
});
