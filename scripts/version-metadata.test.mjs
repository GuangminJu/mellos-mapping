import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { updateLockVersion } from './version-metadata.mjs';

describe('release version metadata', () => {
  it('retains all dependency and optional-platform entries byte-for-byte as JSON values', () => {
    const original = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    const changed = JSON.parse(updateLockVersion(JSON.stringify(original), '99.88.77'));
    expect(changed.version).toBe('99.88.77');
    expect(changed.packages[''].version).toBe('99.88.77');
    changed.version = original.version;
    changed.packages[''].version = original.packages[''].version;
    expect(changed).toEqual(original);
  });

  it('rejects unsupported lock data before it can be written', () => {
    expect(() => updateLockVersion('{}', '1.0.0')).toThrow('package lock');
    expect(() => updateLockVersion('{', '1.0.0')).toThrow();
  });
});
