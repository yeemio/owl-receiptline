import { describe, expect, it } from 'vitest'
import { derivedLineage, rootLineage, verifyLineage } from './lineage.js'

const HASH = 'a'.repeat(64)

describe('single-parent lineage', () => {
  it('root lineage round-trips', () => {
    expect(verifyLineage(rootLineage()).ok).toBe(true)
  })

  it('derived lineage round-trips when before == after', () => {
    const lineage = derivedLineage({
      source_ref: 'runs/abc/123',
      source_fingerprint_before: HASH,
      source_fingerprint_after: HASH,
    })
    expect(lineage.source_unchanged).toBe(true)
    expect(verifyLineage(lineage).ok).toBe(true)
  })

  it('refuses to construct a lineage whose source changed during derivation', () => {
    expect(() => derivedLineage({
      source_ref: 'runs/abc/123',
      source_fingerprint_before: HASH,
      source_fingerprint_after: 'b'.repeat(64),
    })).toThrow(/source_changed/)
  })

  it('rejects malformed lineages: mixed nulls, bad hashes, missing unchanged flag', () => {
    expect(verifyLineage({ source_ref: 'x', source_fingerprint_before: null, source_fingerprint_after: HASH, source_unchanged: true }).ok).toBe(false)
    expect(verifyLineage({ source_ref: 'x', source_fingerprint_before: 'short', source_fingerprint_after: 'short', source_unchanged: true }).ok).toBe(false)
    expect(verifyLineage({ source_ref: 'x', source_fingerprint_before: HASH, source_fingerprint_after: HASH }).ok).toBe(false)
    expect(verifyLineage(null).ok).toBe(false)
  })
})
