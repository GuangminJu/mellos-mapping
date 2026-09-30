import { describe, expect, it } from 'vitest';
import { displayWidth, fitWidth, wrapWidth } from './width.js';

describe('readable terminal wrapping', () => {
  it('keeps English words together when they fit on the next line', () => {
    expect(wrapWidth('alpha beta gamma delta', 10)).toEqual(['alpha beta', 'gamma', 'delta']);
    expect(wrapWidth('readable labels instead of broken words', 16))
      .toEqual(['readable labels', 'instead of', 'broken words']);
  });

  it('wraps Chinese and mixed-language text by terminal columns', () => {
    expect(wrapWidth('一二三四五', 4)).toEqual(['一二', '三四', '五']);
    const mixed = wrapWidth('中文 readable labels 状态 verification', 16);
    expect(mixed.join(' ')).toContain('readable');
    expect(mixed.join(' ')).toContain('verification');
    expect(mixed.every(line => displayWidth(line) <= 16)).toBe(true);
  });

  it('hard-wraps only a word too large to fit and keeps combining marks with it', () => {
    expect(wrapWidth('prefix abcdefghij', 6)).toEqual(['prefix', 'abcdef', 'ghij']);
    expect(wrapWidth('cafe\u0301 cafe\u0301', 4)).toEqual(['cafe\u0301', 'cafe\u0301']);
    expect(wrapWidth('𠮷𠮷𠮷', 4)).toEqual(['𠮷𠮷', '𠮷']);
  });

  it('preserves explicit blank lines and indentation without carrying wrap spaces', () => {
    expect(wrapWidth('first\n\tsecond\n\nlast\n', 20)).toEqual(['first', '  second', '', 'last']);
    expect(wrapWidth('alpha   beta', 7)).toEqual(['alpha', 'beta']);
    expect(wrapWidth('', 10)).toEqual([]);
  });

  it('never emits a wider line or an empty overflow row for an impossibly narrow glyph', () => {
    expect(wrapWidth('一二', 1)).toEqual(['…', '…']);
    for (const width of [0, -1, NaN]) {
      expect(wrapWidth('text', width)).toEqual([]);
      expect(fitWidth('text', width)).toBe('');
    }
    expect(fitWidth('状态存储状态存储', 8)).toBe('状态存…');
  });

  it('bounds every emitted line across narrow and roomy multilingual widths', () => {
    const text = 'Core 数据结构验证 𠮷 🚀 cafe\u0301 longestidentifierwithoutspaces\n  indented evidence';
    for (let width = 1; width <= 45; width++) {
      const lines = wrapWidth(text, width);
      expect(lines.every(line => displayWidth(line) <= width), `width ${width}`).toBe(true);
      expect(displayWidth(fitWidth(text, width))).toBeLessThanOrEqual(width);
    }
  });

  it('still treats terminal controls as data rather than executable sequences', () => {
    const text = '\x1b[2J before\x07after\x9b';
    expect(wrapWidth(text, 12).join('')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(fitWidth(text, 50)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });
});
