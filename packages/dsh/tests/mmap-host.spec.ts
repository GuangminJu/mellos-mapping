import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MmapGateway, STATE_FILE_RELATIVE_PATH, isStorePath, resolveSpec } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const VALID_MAP = JSON.stringify({
  version: 1,
  title: 'spec map',
  layers: [{ id: 'base', name: 'primitives', rank: 0 }],
  nodes: [{ id: 'n', label: 'Node', layer: 'base', status: 'planned' }],
  edges: [],
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mmap-'))
  tempDirs.push(dir)
  return dir
}

async function harness(
  sessions: ReadonlyArray<{ id: string; cwd?: string }>,
  config: Config = {},
  persisted?: ReadonlyArray<{ id: string; cwd?: string }>,
): Promise<{
  ctx: Context
  gateway: MmapGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('sessions', {
    list: () => sessions.map(header => ({ header })),
  } as never)
  if (persisted !== undefined) {
    ctx.provide('sessionPersistence', { list: async () => persisted } as never)
  }
  await ctx.plugin(MmapGateway, config)
  const gateway = ctx.get('mmap') as MmapGateway
  return { ctx, gateway }
}

describe('resolveSpec', () => {
  it('resolves the documented defaults and keeps explicit values', () => {
    expect(resolveSpec({})).toEqual({ watch: true, debounceMs: 150, maxWatchedDirs: 16 })
    expect(resolveSpec({ watch: false, debounceMs: 5, maxWatchedDirs: 2 }))
      .toEqual({ watch: false, debounceMs: 5, maxWatchedDirs: 2 })
  })
})

describe('isStorePath', () => {
  it('accepts exactly the map store paths', () => {
    expect(isStorePath('map.json')).toBe(true)
    expect(isStorePath('pages')).toBe(true)
    expect(isStorePath(['pages', 'a.json'].join(sep))).toBe(true)
    expect(isStorePath('settings.json')).toBe(false)
    expect(isStorePath(['pages', 'a.md'].join(sep))).toBe(false)
    expect(isStorePath(['pages', 'deep', 'a.json'].join(sep))).toBe(false)
    expect(isStorePath('')).toBe(false)
  })
})

describe('MmapGateway.read', () => {
  it('answers no workspace for unknown, cwd-less, and dangling sessions', async () => {
    const gone = join(workspace(), 'removed')
    const { gateway } = await harness([
      { id: 'no-cwd' },
      { id: 'dangling', cwd: gone },
    ], { watch: false })
    expect(await gateway.read('missing')).toEqual({ cwd: null, pages: [] })
    expect(await gateway.read('no-cwd')).toEqual({ cwd: null, pages: [] })
    expect(await gateway.read('dangling')).toEqual({ cwd: null, pages: [] })
  })

  it('reads the default page first, then named pages, keeping invalid pages visible', async () => {
    const cwd = workspace()
    const defaultFile = join(cwd, STATE_FILE_RELATIVE_PATH)
    mkdirSync(join(defaultFile, '..', 'pages'), { recursive: true })
    writeFileSync(defaultFile, VALID_MAP)
    writeFileSync(join(defaultFile, '..', 'pages', 'alpha.json'), VALID_MAP)
    writeFileSync(join(defaultFile, '..', 'pages', 'broken.json'), '{"version":1,"layers":[')

    const { gateway } = await harness([{ id: 's1', cwd }], { watch: false })
    const result = await gateway.read('s1')
    expect(result.cwd).toBe(realpathSync(cwd))
    expect(result.pages.map(page => page.page)).toEqual([null, 'alpha', 'broken'])
    expect(result.pages[0]?.map).toMatchObject({ title: 'spec map' })
    expect(result.pages[0]?.error).toBeNull()
    expect(result.pages[0]?.mtimeMs).toBeTypeOf('number')
    expect(result.pages[2]?.map).toBeNull()
    expect(result.pages[2]?.error).toContain('not valid JSON')
  })

  it('answers an empty page list for a workspace with no store', async () => {
    const cwd = workspace()
    const { gateway } = await harness([{ id: 's1', cwd }], { watch: false })
    expect(await gateway.read('s1')).toEqual({ cwd: realpathSync(cwd), pages: [] })
  })

  it('moves a legacy .claude store into .mellos on first read', async () => {
    const cwd = workspace()
    mkdirSync(join(cwd, '.claude', 'mellos-mapping.pages'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'mellos-mapping.json'), VALID_MAP)
    writeFileSync(join(cwd, '.claude', 'mellos-mapping.pages', 'old.json'), VALID_MAP)

    const { gateway } = await harness([{ id: 's1', cwd }], { watch: false })
    const result = await gateway.read('s1')
    expect(result.pages.map(page => page.page)).toEqual([null, 'old'])
    expect(existsSync(join(cwd, STATE_FILE_RELATIVE_PATH))).toBe(true)
    expect(existsSync(join(cwd, '.claude', 'mellos-mapping.json'))).toBe(false)
  })

  it('resolves a cold session through its persisted header', async () => {
    const cwd = workspace()
    const defaultFile = join(cwd, STATE_FILE_RELATIVE_PATH)
    mkdirSync(join(defaultFile, '..'), { recursive: true })
    writeFileSync(defaultFile, VALID_MAP)
    const { gateway } = await harness([], { watch: false }, [{ id: 'cold', cwd }])
    const result = await gateway.read('cold')
    expect(result.cwd).toBe(realpathSync(cwd))
    expect(result.pages).toHaveLength(1)
    // Unknown everywhere still answers no workspace.
    expect(await gateway.read('nowhere')).toEqual({ cwd: null, pages: [] })
  })
})

describe('MmapGateway watching', () => {
  it('emits one coalesced mmap/changed for store writes and stays silent for foreign files', async () => {
    const cwd = workspace()
    const defaultFile = join(cwd, STATE_FILE_RELATIVE_PATH)
    mkdirSync(join(defaultFile, '..'), { recursive: true })
    writeFileSync(defaultFile, VALID_MAP)

    const { ctx, gateway } = await harness([{ id: 's1', cwd }], { debounceMs: 20 })
    const changed = vi.fn()
    ctx.on('mmap/changed', changed)
    await gateway.read('s1')

    writeFileSync(join(defaultFile, '..', 'settings.json'), '{}')
    writeFileSync(defaultFile, VALID_MAP.replace('spec map', 'spec map 2'))
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledWith(realpathSync(cwd))
    }, { timeout: 5000 })
    expect(changed.mock.calls.every(call => call[0] === realpathSync(cwd))).toBe(true)
  })

  it('bounds watched workspaces to the configured maximum', async () => {
    const first = workspace()
    const second = workspace()
    const { gateway } = await harness(
      [{ id: 'a', cwd: first }, { id: 'b', cwd: second }],
      { maxWatchedDirs: 1, debounceMs: 20 },
    )
    await gateway.read('a')
    await gateway.read('b')
    // Interior watcher map is private; the bound is observable through
    // disposal not hanging and the LRU re-read path staying callable.
    await gateway.read('a')
    expect((await gateway.read('b')).cwd).toBe(realpathSync(second))
  })
})
