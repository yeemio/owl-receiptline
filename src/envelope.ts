import { canonicalJson, hashCanonical } from './canonical-json.js'

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u

/**
 * A self-hashed receipt envelope: `artifact_version` identifies the schema,
 * the payload carries the record, and `hash` is the canonical-JSON SHA-256
 * of everything else in the envelope. Verification re-derives the hash and
 * additionally requires the EXACT key set — one extra or missing key fails,
 * so a receipt written by a different schema version can never pass as
 * this one, and nobody can smuggle fields past the hash.
 */
export interface SelfHashedEnvelope<TPayload> {
  readonly artifact_version: string
  readonly payload: TPayload
  readonly hash: string
}

export interface EnvelopeOptions {
  /** Where the hash lives. Defaults to `hash`. */
  readonly hash_field?: string
  /** Extra top-level fields to carry alongside version/payload/hash.
   * They enter the hashed body — verification still requires the exact
   * key set. */
  readonly extra?: Readonly<Record<string, unknown>>
}

export function makeEnvelope<TPayload extends Record<string, unknown>>(input: {
  readonly artifact_version: string
  readonly payload: TPayload
  readonly options?: EnvelopeOptions
}): SelfHashedEnvelope<TPayload> & EnvelopeOptions['extra'] {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(input.artifact_version)) {
    throw new Error('receiptline_envelope_version_invalid')
  }
  const hashField = input.options?.hash_field ?? 'hash'
  const extra = input.options?.extra ?? {}
  const body: Record<string, unknown> = {
    artifact_version: input.artifact_version,
    payload: input.payload,
    ...extra,
  }
  const hash = hashCanonical(body)
  const envelope: Record<string, unknown> = { ...body, [hashField]: hash }
  return Object.freeze(envelope) as SelfHashedEnvelope<TPayload> & EnvelopeOptions['extra']
}

export type EnvelopeVerification<TPayload> =
  | { ok: true; payload: TPayload }
  | { ok: false; reason: 'shape_invalid' | 'version_mismatch' | 'hash_mismatch' }

/**
 * Verify an untrusted envelope against an expected artifact version.
 * Accepts `unknown` from `JSON.parse` output.
 */
export function verifyEnvelope<TPayload extends Record<string, unknown>>(input: {
  readonly value: unknown
  readonly expected_artifact_version: string
  readonly options?: EnvelopeOptions
}): EnvelopeVerification<TPayload> {
  const hashField = input.options?.hash_field ?? 'hash'
  if (input.value === null || typeof input.value !== 'object' || Array.isArray(input.value)) {
    return { ok: false, reason: 'shape_invalid' }
  }
  const record = input.value as Record<string, unknown>
  const claimedHash = record[hashField]
  if (typeof claimedHash !== 'string' || !SHA256_PATTERN.test(claimedHash)) {
    return { ok: false, reason: 'shape_invalid' }
  }
  const { [hashField]: _hash, ...body } = record
  if (record.artifact_version !== input.expected_artifact_version) {
    return { ok: false, reason: 'version_mismatch' }
  }
  if (hashCanonical(body) !== claimedHash) {
    return { ok: false, reason: 'hash_mismatch' }
  }
  const payload = body.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'shape_invalid' }
  }
  return { ok: true, payload: payload as TPayload }
}
