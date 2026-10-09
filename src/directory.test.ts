import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDirectoryManifest, directoryFingerprint, verifyDirectory } from './directory.js'

const tempRoot = mkdtempSync(path.join(tmpdir(), 'receiptline-dir-'))
const caseDir = (name: string): string => {
  const dir = path.join(tempRoot, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function fixture(name: string, files: Record<string, string>): string {
  const dir = caseDir(name)
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, { flag: 'wx' })
  }
  return dir
}

describe('directory fingerprint and verification', () => {
  it('builds a manifest and verifies it round-trip, excluding the receipt itself', () => {
    const dir = fixture('roundtrip', {
      'a.json': '{"a":1}',
      'nested/b.json': 'b-content',
      'receipt.json': 'meta',
    })
    const manifest = buildDirectoryManifest({ directory: dir, exclude: ['receipt.json'] })
    expect(manifest.ok).toBe(true)
    if (!manifest.ok) return
    expect(manifest.entries.map((entry) => entry.relative_path)).toEqual(['a.json', 'nested/b.json'])
    const verification = verifyDirectory({
      directory: dir,
      manifest: manifest.entries,
      fingerprint: manifest.fingerprint,
      exclude: ['receipt.json'],
    })
    expect(verification.ok).toBe(true)
    if (verification.ok) {
      expect(verification.verified['a.json']?.toString()).toBe('{"a":1}')
      expect(verification.verified['receipt.json']).toBeUndefined()
    }
  })

  it('identical content under identical paths yields identical fingerprints', () => {
    const left = fixture('stable-a', { 'a.json': 'same', 'b/c.json': 'same2' })
    const right = fixture('stable-b', { 'a.json': 'same', 'b/c.json': 'same2' })
    const leftManifest = buildDirectoryManifest({ directory: left })
    const rightManifest = buildDirectoryManifest({ directory: right })
    if (!leftManifest.ok || !rightManifest.ok) throw new Error('fixture build failed')
    expect(leftManifest.fingerprint).toBe(rightManifest.fingerprint)
  })

  it('fails on size_mismatch then hash_mismatch when a file was modified after the receipt', () => {
    const dir = fixture('modified', { 'a.json': 'before' })
    const manifest = buildDirectoryManifest({ directory: dir })
    if (!manifest.ok) throw new Error('fixture build failed')
    writeFileSync(path.join(dir, 'a.json'), 'shorter')
    expect(verifyDirectory({
      directory: dir, manifest: manifest.entries, fingerprint: manifest.fingerprint,
    })).toEqual({ ok: false, reason: 'size_mismatch' })
    writeFileSync(path.join(dir, 'a.json'), 'aftex!')
    expect(verifyDirectory({
      directory: dir, manifest: manifest.entries, fingerprint: manifest.fingerprint,
    })).toEqual({ ok: false, reason: 'hash_mismatch' })
  })

  it('fails on file_set_mismatch when a file was added or removed, in both directions', () => {
    const dir = fixture('set-drift', { 'a.json': 'a', 'b.json': 'b' })
    const manifest = buildDirectoryManifest({ directory: dir })
    if (!manifest.ok) throw new Error('fixture build failed')
    writeFileSync(path.join(dir, 'c.json'), 'c', { flag: 'wx' })
    expect(verifyDirectory({
      directory: dir, manifest: manifest.entries, fingerprint: manifest.fingerprint,
    }).ok).toBe(false)
    const phantomDir = fixture('set-drift-phantom', { 'b.json': 'b' })
    const bRead = buildDirectoryManifest({ directory: phantomDir })
    if (!bRead.ok) throw new Error('fixture build failed')
    const bEntry = bRead.entries[0]!
    const phantomManifest = [
      { ...bEntry, relative_path: 'a.json' },
      bEntry,
    ]
    const phantomResult = verifyDirectory({
      directory: phantomDir,
      manifest: phantomManifest,
      fingerprint: directoryFingerprint({ entries: phantomManifest }),
    })
    if (phantomResult.ok) throw new Error('expected verification failure')
    expect(phantomResult.reason).toBe('file_set_mismatch')
  })

  it('rejects a manifest whose recomputed fingerprint does not match the claim', () => {
    const dir = fixture('fp-drift', { 'a.json': 'a' })
    const manifest = buildDirectoryManifest({ directory: dir })
    if (!manifest.ok) throw new Error('fixture build failed')
    expect(verifyDirectory({
      directory: dir, manifest: manifest.entries, fingerprint: '0'.repeat(64),
    })).toEqual({ ok: false, reason: 'fingerprint_mismatch' })
  })

  it('rejects unsafe manifest paths (traversal, duplicates, unsorted)', () => {
    const dir = fixture('bad-paths', { 'a.json': 'a' })
    const base = { relative_path: 'a.json', size: 1, sha256: 'a'.repeat(64) }
    const reasonOf = (result: ReturnType<typeof verifyDirectory>): string => {
      if (result.ok) throw new Error('expected verification failure')
      return result.reason
    }
    expect(reasonOf(verifyDirectory({
      directory: dir,
      manifest: [{ ...base, relative_path: '../escape' }],
      fingerprint: directoryFingerprint({ entries: [{ ...base, relative_path: '../escape' }] }),
    }))).toBe('manifest_path_invalid')
    expect(reasonOf(verifyDirectory({
      directory: dir,
      manifest: [base, base],
      fingerprint: directoryFingerprint({ entries: [base, base] }),
    }))).toBe('manifest_path_invalid')
  })

  it('fails on symlinks anywhere in the tree — building AND verifying', () => {
    const dir = fixture('symlink', { 'real.json': 'r' })
    symlinkSync(path.join(dir, 'real.json'), path.join(dir, 'alias.json'))
    // Building refuses: the manifest cannot silently coexist with a
    // repointable entry.
    const manifest = buildDirectoryManifest({ directory: dir })
    expect(manifest).toEqual({ ok: false, reason: 'file_not_regular' })

    // Verifying refuses too, even when the symlink is NOT in the manifest
    // (an extra irregular file must fail the whole walk, not be skipped).
    const clean = fixture('symlink-verify', { 'real.json': 'r' })
    const cleanManifest = buildDirectoryManifest({ directory: clean })
    if (!cleanManifest.ok) throw new Error('fixture build failed')
    symlinkSync(path.join(clean, 'real.json'), path.join(clean, 'planted-alias.json'))
    expect(verifyDirectory({
      directory: clean, manifest: cleanManifest.entries, fingerprint: cleanManifest.fingerprint,
    })).toEqual({ ok: false, reason: 'file_not_regular' })
  })
})
