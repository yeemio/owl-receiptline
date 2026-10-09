import { describe, expect, it } from 'vitest'
import { canonicalJson, hashCanonical } from './canonical-json.js'
import { makeEnvelope, verifyEnvelope } from './envelope.js'
import {
  latestOf,
  makeSupersede,
  SUPERSEDE_ARTIFACT_VERSION,
  verifySupersedeChain,
  type SupersedeRecord,
} from './supersede.js'

const HASH = 'a'.repeat(64)

/** Deterministic receipt identity: a slot id plus a real content hash. */
const receiptOf = (name: string) => ({ id: `receipts/${name}.json`, hash: hashCanonical(name) })

const link = (from: string, to: string, overrides: Partial<SupersedeRecord> = {}) =>
  makeSupersede({
    supersedes: receiptOf(from),
    replacement: receiptOf(to),
    reason: `correction ${from} -> ${to}`,
    superseded_at: 1,
    ...overrides,
  })

describe('makeSupersede', () => {
  it('builds an immutable additive record embedding the superseded identity', () => {
    const record = makeSupersede({
      supersedes: receiptOf('delivery'),
      replacement: { id: 'receipts/DELIVERY_R1.json', hash: HASH },
      reason: 'rework: predecessor image kept, correction added',
      superseded_at: 42,
      evidence_hash: hashCanonical('repair-plan'),
    })
    expect(record.artifact_version).toBe(SUPERSEDE_ARTIFACT_VERSION)
    expect(record.supersedes).toEqual(receiptOf('delivery'))
    expect(record.replacement).toEqual({ id: 'receipts/DELIVERY_R1.json', hash: HASH })
    expect(record.reason).toContain('rework')
    expect(record.superseded_at).toBe(42)
    expect(record.evidence_hash).toBe(hashCanonical('repair-plan'))
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.supersedes)).toBe(true)
    expect(Object.isFrozen(record.replacement)).toBe(true)
  })

  it('refuses malformed construction: bad hash, empty reason, bad time, bad evidence, self-reference', () => {
    expect(() => makeSupersede({
      supersedes: { id: 'a', hash: 'short' },
      replacement: receiptOf('b'),
      reason: 'r',
      superseded_at: 1,
    })).toThrow(/target_invalid/)
    expect(() => makeSupersede({
      supersedes: receiptOf('a'),
      replacement: receiptOf('b'),
      reason: '   ',
      superseded_at: 1,
    })).toThrow(/reason_invalid/)
    expect(() => makeSupersede({
      supersedes: receiptOf('a'),
      replacement: receiptOf('b'),
      reason: 'r',
      superseded_at: Number.POSITIVE_INFINITY,
    })).toThrow(/time_invalid/)
    expect(() => makeSupersede({
      supersedes: receiptOf('a'),
      replacement: receiptOf('b'),
      reason: 'r',
      superseded_at: 1,
      evidence_hash: 'deadbeef',
    })).toThrow(/evidence_hash_invalid/)
    expect(() => makeSupersede({
      supersedes: receiptOf('a'),
      replacement: receiptOf('a'),
      reason: 'r',
      superseded_at: 1,
    })).toThrow(/self_reference/)
  })
})

describe('verifySupersedeChain', () => {
  it('verifies a single-step chain and reports head, records and latest', () => {
    const record = link('delivery', 'DELIVERY_R1')
    const verdict = verifySupersedeChain({ records: [record] })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.chains.length).toBe(1)
      const chain = verdict.chains[0]!
      expect(chain.head).toEqual(receiptOf('delivery'))
      expect(chain.records).toEqual([record])
      expect(chain.latest).toEqual(receiptOf('DELIVERY_R1'))
    }
  })

  it('verifies a multi-level chain regardless of record order', () => {
    const r0 = link('delivery', 'DELIVERY_R0')
    const r1 = makeSupersede({
      supersedes: receiptOf('DELIVERY_R0'),
      replacement: receiptOf('DELIVERY_R1'),
      reason: 'second rework',
      superseded_at: 2,
    })
    const r2 = makeSupersede({
      supersedes: receiptOf('DELIVERY_R1'),
      replacement: receiptOf('DELIVERY_R2'),
      reason: 'third rework',
      superseded_at: 3,
    })
    const verdict = verifySupersedeChain({ records: [r2, r0, r1] })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      const chain = verdict.chains[0]!
      expect(chain.records).toEqual([r0, r1, r2])
      expect(chain.head).toEqual(receiptOf('delivery'))
      expect(chain.latest).toEqual(receiptOf('DELIVERY_R2'))
    }
  })

  it('rejects double supersession of the same receipt identity', () => {
    const first = link('delivery', 'DELIVERY_R1')
    const second = link('delivery', 'DELIVERY_R1_ALT')
    const verdict = verifySupersedeChain({ records: [first, second] })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.failures[0]).toMatchObject({
        reason: 'double_supersede',
        target: receiptOf('delivery'),
      })
    }
  })

  it('rejects a forked replacement (two histories producing one identity)', () => {
    const verdict = verifySupersedeChain({ records: [link('a', 'shared'), link('b', 'shared')] })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.failures[0]).toMatchObject({
        reason: 'forked_replacement',
        replacement: receiptOf('shared'),
      })
    }
  })

  it('rejects a self-referencing record as a cycle', () => {
    const selfRef = {
      artifact_version: SUPERSEDE_ARTIFACT_VERSION,
      supersedes: receiptOf('a'),
      replacement: receiptOf('a'),
      reason: 'no-op correction',
      superseded_at: 1,
    }
    const verdict = verifySupersedeChain({ records: [selfRef] })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.failures[0]!.reason).toBe('cycle_detected')
  })

  it('rejects a two-record cycle', () => {
    const ab = link('a', 'b')
    const ba = link('b', 'a')
    const verdict = verifySupersedeChain({ records: [ab, ba] })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.failures[0]).toMatchObject({ reason: 'cycle_detected', indices: [0, 1] })
    }
  })

  it('rejects a dangling target when known heads are provided', () => {
    const heads = [receiptOf('delivery')]
    const dangling = {
      ...link('ghost-receipt', 'DELIVERY_R1'),
    }
    const verdict = verifySupersedeChain({ records: [dangling], heads })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.failures[0]).toMatchObject({
        reason: 'dangling_target',
        target: receiptOf('ghost-receipt'),
      })
    }
  })

  it('rejects malformed records with the offending index', () => {
    const malformed = [
      { ...link('a', 'b'), supersedes: { id: 'a', hash: 'short' } },
      { ...link('a', 'b'), reason: '' },
      { ...link('a', 'b'), superseded_at: 'yesterday' },
      null,
    ]
    const verdict = verifySupersedeChain({ records: malformed })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.failures.map((failure) => failure.reason === 'invalid_record' ? failure.index : -1))
        .toEqual([0, 1, 2, 3])
    }
  })

  it('derives order from linkage, never from timestamps', () => {
    const early = makeSupersede({
      supersedes: receiptOf('a'),
      replacement: receiptOf('b'),
      reason: 'rework 0',
      superseded_at: 1000,
    })
    const late = makeSupersede({
      supersedes: receiptOf('b'),
      replacement: receiptOf('c'),
      reason: 'rework 1',
      superseded_at: 5,
    })
    const verdict = verifySupersedeChain({ records: [late, early] })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.chains[0]!.latest).toEqual(receiptOf('c'))
  })

  it('verifies multiple independent chains side by side', () => {
    const verdict = verifySupersedeChain({ records: [link('a', 'a_R1'), link('b', 'b_R1')] })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.chains.length).toBe(2)
      expect(verdict.chains.map((chain) => chain.latest.id).sort())
        .toEqual(['receipts/a_R1.json', 'receipts/b_R1.json'])
    }
  })

  it('accepts an empty record set', () => {
    const verdict = verifySupersedeChain({ records: [] })
    expect(verdict).toEqual({ ok: true, chains: [] })
  })
})

describe('latestOf', () => {
  it('returns the tail replacement across single and multi-level chains', () => {
    expect(latestOf([])).toBe(null)
    expect(latestOf([link('a', 'b')])).toEqual(receiptOf('b'))
    expect(latestOf([link('a', 'b'), link('b', 'c'), link('c', 'd')])).toEqual(receiptOf('d'))
  })
})

describe('composition with the envelope', () => {
  it('superseding never mutates the superseded receipt', () => {
    const original = makeEnvelope({
      artifact_version: 'run-receipt.v1',
      payload: { decision: 'pass', fingerprint: hashCanonical('run') },
    })
    const before = canonicalJson(original)
    const corrected = makeEnvelope({
      artifact_version: 'run-receipt.v1',
      payload: { decision: 'fail', fingerprint: hashCanonical('run') },
    })
    makeSupersede({
      supersedes: { id: 'receipts/run.json', hash: original.hash },
      replacement: { id: 'receipts/run.json', hash: corrected.hash },
      reason: 'verdict corrected after re-read',
      superseded_at: 7,
    })
    expect(canonicalJson(original)).toBe(before)
    expect(original.hash).toBe(hashCanonical({
      artifact_version: 'run-receipt.v1',
      payload: { decision: 'pass', fingerprint: hashCanonical('run') },
    }))
  })

  it('the supersede record itself self-hashes and round-trips through the envelope', () => {
    const record = link('delivery', 'DELIVERY_R1')
    const envelope = makeEnvelope({
      artifact_version: SUPERSEDE_ARTIFACT_VERSION,
      payload: record as unknown as Record<string, unknown>,
    })
    const verdict = verifyEnvelope<Record<string, unknown>>({
      value: JSON.parse(JSON.stringify(envelope)),
      expected_artifact_version: SUPERSEDE_ARTIFACT_VERSION,
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.payload).toEqual(record)
  })
})
