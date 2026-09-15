import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStarReminder, isNpmInstallation, starReminderFile } from './star-reminder.js';
import { withStoreLock } from '../store/transaction.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const DAY = 86_400_000, start = Date.UTC(2026, 0, 1, 12);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mellos-star-')); roots.push(root);
  const pkg = join(root, 'node_modules', 'mellos-mapping');
  const entry = join(pkg, 'dist', 'web.mjs'); mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, ''); writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'mellos-mapping', bin: { mmap: 'dist/mmap.mjs' } }));
  const userBase = join(root, 'user'), file = starReminderFile(userBase);
  let now = start;
  const options = { entry, userBase, env: {}, now: () => now };
  return { root, pkg, entry, userBase, file, options, at: (days: number) => { now = start + days * DAY; } };
}

describe('npm-only one-time Star reminder', () => {
  it('requires seven full days and three distinct use dates, not repeated calls or projects', () => {
    const f = fixture(), reminder = createStarReminder(f.options);
    expect(reminder.visit()).toBe(false);
    for (let i = 0; i < 5; i++) expect(createStarReminder(f.options).visit()).toBe(false);
    f.at(1); expect(reminder.visit()).toBe(false);
    f.at(2); expect(reminder.visit()).toBe(false);
    f.at(6.99); expect(reminder.visit()).toBe(false);
    f.at(7); expect(reminder.visit()).toBe(true);
    f.at(365); expect(createStarReminder(f.options).visit()).toBe(false);
    const saved = JSON.parse(readFileSync(f.file, 'utf8'));
    expect(Object.keys(saved).sort()).toEqual(['days', 'firstSeen', 'lastDay', 'notified', 'version']);
    expect(saved).toMatchObject({ days: 3, notified: true });
  });
  it('does not remind a user who only returned once after a week', () => {
    const f = fixture(), reminder = createStarReminder(f.options);
    reminder.visit(); f.at(8); expect(reminder.visit()).toBe(false);
    expect(reminder.visit()).toBe(false);
    f.at(9); expect(reminder.visit()).toBe(true);
  });
  it('excludes source checkouts, plugin editions and linked source directories', () => {
    const f = fixture(); expect(isNpmInstallation(f.entry)).toBe(true);
    mkdirSync(join(f.pkg, '.codex-plugin')); expect(isNpmInstallation(f.entry)).toBe(false);
    rmSync(join(f.pkg, '.codex-plugin'), { recursive: true });
    mkdirSync(join(f.pkg, '.claude-plugin')); expect(isNpmInstallation(f.entry)).toBe(false);
    rmSync(join(f.pkg, '.claude-plugin'), { recursive: true });
    mkdirSync(join(f.pkg, '.git')); expect(isNpmInstallation(f.entry)).toBe(false);
    rmSync(join(f.pkg, '.git'), { recursive: true });
    const source = join(f.root, 'checkout'); mkdirSync(join(source, 'dist'), { recursive: true });
    writeFileSync(join(source, 'package.json'), readFileSync(join(f.pkg, 'package.json'))); writeFileSync(join(source, 'dist', 'web.mjs'), '');
    symlinkSync(source, join(f.root, 'node_modules', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(isNpmInstallation(join(f.root, 'node_modules', 'linked', 'dist', 'web.mjs'))).toBe(false);
    writeFileSync(join(f.pkg, 'package.json'), '{broken');
    expect(createStarReminder(f.options).visit()).toBe(false); expect(existsSync(f.file)).toBe(false);
  });
  it('handles npx/pnpm locations by the real installed package, not cwd or npm environment variables', () => {
    const f = fixture();
    const nested = join(f.root, '.npm', '_npx', 'cache', 'node_modules', 'mellos-mapping');
    mkdirSync(join(nested, 'dist'), { recursive: true });
    writeFileSync(join(nested, 'package.json'), readFileSync(join(f.pkg, 'package.json'))); writeFileSync(join(nested, 'dist', 'web.mjs'), '');
    expect(isNpmInstallation(join(nested, 'dist', 'web.mjs'))).toBe(true);
    expect(isNpmInstallation(join(f.root, 'missing.mjs'))).toBe(false);
  });
  it.each([{ CI: 'true' }, { MELLOS_MAPPING_NO_STAR: '1' }])('opts out without writing any usage data: %j', env => {
    const f = fixture(); expect(createStarReminder({ ...f.options, env }).visit()).toBe(false);
    expect(existsSync(join(f.userBase, '.mellos'))).toBe(false);
  });
  it('keeps corrupt, unknown and unreadable state silent and untouched', () => {
    const f = fixture(); mkdirSync(dirname(f.file), { recursive: true });
    for (const body of ['{bad', '{"version":99}', '{"version":1,"notified":true}']) {
      writeFileSync(f.file, body); expect(createStarReminder(f.options).visit()).toBe(false);
      expect(readFileSync(f.file, 'utf8')).toBe(body);
    }
    rmSync(f.file); mkdirSync(f.file); expect(createStarReminder(f.options).visit()).toBe(false);
  });
  it('does not reset history on a backward clock or remind without a durable write', () => {
    const f = fixture(), reminder = createStarReminder(f.options);
    reminder.visit(); const before = readFileSync(f.file, 'utf8'); f.at(-1);
    expect(reminder.visit()).toBe(false); expect(readFileSync(f.file, 'utf8')).toBe(before);
    const blockedHome = join(f.root, 'not-a-directory'); writeFileSync(blockedHome, '');
    expect(createStarReminder({ ...f.options, userBase: blockedHome }).visit()).toBe(false);
  });
  it('skips contention without waiting and lets only one viewer claim the eligible notice', () => {
    const f = fixture(), one = createStarReminder(f.options), two = createStarReminder(f.options);
    one.visit(); f.at(1); one.visit(); f.at(7);
    withStoreLock(f.file, () => { expect(two.visit()).toBe(false); });
    expect(one.visit()).toBe(true); expect(two.visit()).toBe(false);
  });
});
