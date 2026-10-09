import { describe, expect, it } from 'vitest'
import { makeEnvelope, verifyEnvelope } from './envelope.js'

describe('makeEnvelope / verifyEnvelope', () => {
  const envelope = makeEnvelope({
    artifact_version: 'my-receipt.v1',
    payload: { decision: 'pass', inputs: 3 },
  })

  it('round-trips a well-formed envelope', () => {
    const verdict = verifyEnvelope<{ decision: string; inputs: number }>({
      value: JSON.parse(JSON.stringify(envelope)),
      expected_artifact_version: 'my-receipt.v1',
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.payload.decision).toBe('pass')
  })

  it('rejects a tampered payload (hash mismatch)', () => {
    const tampered = { ...envelope, payload: { decision: 'fail', inputs: 3 } }
    const verdict = verifyEnvelope({ value: tampered, expected_artifact_version: 'my-receipt.v1' })
    expect(verdict).toEqual({ ok: false, reason: 'hash_mismatch' })
  })

  it('rejects an extra un-hashed field smuggled into the envelope', () => {
    const smuggled = { ...envelope, extra_note: 'trust me' }
    const verdict = verifyEnvelope({ value: smuggled, expected_artifact_version: 'my-receipt.v1' })
    expect(verdict).toEqual({ ok: false, reason: 'hash_mismatch' })
  })

  it('rejects a different artifact version even with a valid hash', () => {
    const other = makeEnvelope({ artifact_version: 'my-receipt.v2', payload: { decision: 'pass', inputs: 3 } })
    const verdict = verifyEnvelope({ value: other, expected_artifact_version: 'my-receipt.v1' })
    expect(verdict).toEqual({ ok: false, reason: 'version_mismatch' })
  })

  it('rejects non-object shapes and malformed hashes', () => {
    expect(verifyEnvelope({ value: null, expected_artifact_version: 'x.v1' }).ok).toBe(false)
    expect(verifyEnvelope({ value: [], expected_artifact_version: 'x.v1' }).ok).toBe(false)
    expect(verifyEnvelope({ value: { artifact_version: 'x.v1', payload: {}, hash: 'deadbeef' }, expected_artifact_version: 'x.v1' }).ok)
      .toBe(false)
  })

  it('supports a custom hash field name and extra hashed fields', () => {
    const custom = makeEnvelope({
      artifact_version: 'x.v1',
      payload: { a: 1 },
      options: { hash_field: 'content_hash', extra: { run_id: 'r-1' } },
    })
    expect(verifyEnvelope({
      value: custom,
      expected_artifact_version: 'x.v1',
      options: { hash_field: 'content_hash', extra: { run_id: 'r-1' } },
    }).ok).toBe(true)
    const tamperedExtra = { ...custom, run_id: 'r-2' }
    expect(verifyEnvelope({
      value: tamperedExtra,
      expected_artifact_version: 'x.v1',
      options: { hash_field: 'content_hash' },
    })).toEqual({ ok: false, reason: 'hash_mismatch' })
  })
})
