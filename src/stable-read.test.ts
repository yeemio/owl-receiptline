import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readStableRegularFile } from './stable-read.js'

const tempRoot = mkdtempSync(path.join(tmpdir(), 'receiptline-read-'))
const caseDir = (name: string): string => {
  const dir = path.join(tempRoot, name)
  mkdirSync(dir, { recursive: true })
  return dir
}
afterAll(() => {
  // OS temp cleanup; contents are tiny.
})

describe('readStableRegularFile', () => {
  it('reads a regular file', () => {
    const dir = caseDir('ok')
    writeFileSync(path.join(dir, 'a.txt'), 'hello', { flag: 'wx' })
    const result = readStableRegularFile({ directory: dir, relativePath: 'a.txt' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bytes.toString()).toBe('hello')
  })

  it('rejects symlinks', () => {
    const dir = caseDir('symlink')
    writeFileSync(path.join(dir, 'real.txt'), 'hello', { flag: 'wx' })
    symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'alias.txt'))
    expect(readStableRegularFile({ directory: dir, relativePath: 'alias.txt' }))
      .toEqual({ ok: false, reason: 'not_regular' })
  })

  it('rejects hard links (nlink > 1)', () => {
    const dir = caseDir('hardlink')
    writeFileSync(path.join(dir, 'real.txt'), 'hello', { flag: 'wx' })
    linkSync(path.join(dir, 'real.txt'), path.join(dir, 'alias.txt'))
    expect(readStableRegularFile({ directory: dir, relativePath: 'real.txt' }))
      .toEqual({ ok: false, reason: 'not_regular' })
  })

  it('rejects path traversal outside the directory', () => {
    const dir = caseDir('traversal')
    writeFileSync(path.join(tempRoot, 'outside.txt'), 'x', { flag: 'wx' })
    expect(readStableRegularFile({ directory: dir, relativePath: '../outside.txt' }))
      .toEqual({ ok: false, reason: 'not_regular' })
  })

  it('rejects missing files', () => {
    const dir = caseDir('missing')
    expect(readStableRegularFile({ directory: dir, relativePath: 'nope.txt' }))
      .toEqual({ ok: false, reason: 'not_regular' })
  })
})
