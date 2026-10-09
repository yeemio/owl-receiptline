import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAppendOnlyFile, writeAppendOnlyJson } from './append-only.js'

const tempRoot = mkdtempSync(path.join(tmpdir(), 'receiptline-append-'))

describe('writeAppendOnlyFile / writeAppendOnlyJson', () => {
  it('lands the file exactly once, read-only, with a trailing newline for JSON', () => {
    const dir = path.join(tempRoot, 'once')
    const file = path.join(dir, 'receipt.json')
    const result = writeAppendOnlyJson({ file, value: { a: 1 } })
    expect(result.ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('{\n  "a": 1\n}\n')
    expect(statSync(file).mode & 0o777).toBe(0o400)
  })

  it('refuses a second write to the same path instead of overwriting', () => {
    const dir = path.join(tempRoot, 'conflict')
    const file = path.join(dir, 'receipt.json')
    expect(writeAppendOnlyFile({ file, bytes: 'first' }).ok).toBe(true)
    const second = writeAppendOnlyFile({ file, bytes: 'second' })
    expect(second).toEqual({ ok: false, reason: 'already_exists' })
    expect(readFileSync(file, 'utf8')).toBe('first')
  })

  it('can append alongside an existing file without touching it', () => {
    const dir = path.join(tempRoot, 'sibling')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'existing.txt'), 'keep', { flag: 'wx' })
    expect(writeAppendOnlyFile({ file: path.join(dir, 'new.json'), bytes: 'new' }).ok).toBe(true)
    expect(readFileSync(path.join(dir, 'existing.txt'), 'utf8')).toBe('keep')
  })

  it('overwrites nothing even when the existing file was made writable again', () => {
    const dir = path.join(tempRoot, 're chmod')
    const file = path.join(dir, 'receipt.json')
    writeAppendOnlyFile({ file, bytes: 'first' })
    chmodSync(file, 0o600)
    expect(writeAppendOnlyFile({ file, bytes: 'second' }).ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('first')
  })
})
