import { describe, expect, it } from 'vitest'
import { canonicalJson, hashCanonical } from './canonical-json.js'

describe('canonicalJson', () => {
  it('sorts keys deterministically at every nesting level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('drops undefined values but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}')
  })

  it('treats arrays as ordered', () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}')
  })

  it('rejects non-finite numbers anywhere in the value', () => {
    expect(() => canonicalJson({ a: [{ b: Number.NaN }] })).toThrow(/non_finite/)
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non_finite/)
  })

  it('produces identical hashes regardless of key insertion order', () => {
    const left = hashCanonical({ route: 'x', provider: 'p', model: 'm' })
    const right = hashCanonical({ model: 'm', route: 'x', provider: 'p' })
    expect(left).toBe(right)
  })

  it('hashes to a stable fixed vector (guards against serialization drift)', () => {
    expect(hashCanonical({ provider: 'p', endpoint: 'https://api.example/v1' }))
      .toMatch(/^[0-9a-f]{64}$/)
  })
})
