import { SHA256_PATTERN } from './envelope.js'

/**
 * Single-parent lineage for a derived receipt: the output was computed
 * from exactly one source, and the source's fingerprint was taken BEFORE
 * and AFTER the derivation — both must match, proving the source did not
 * change while the output was being produced. No long hash chains, no
 * merge semantics: one parent, proven frozen.
 */
export interface SingleParentLineage {
  readonly source_ref: string | null
  readonly source_fingerprint_before: string | null
  readonly source_fingerprint_after: string | null
  /** Always true when a source exists; the invariant is enforced here. */
  readonly source_unchanged: true
}

export function rootLineage(): SingleParentLineage {
  return Object.freeze({
    source_ref: null,
    source_fingerprint_before: null,
    source_fingerprint_after: null,
    source_unchanged: true,
  })
}

export function derivedLineage(input: {
  readonly source_ref: string
  readonly source_fingerprint_before: string
  readonly source_fingerprint_after: string
}): SingleParentLineage {
  if (input.source_fingerprint_before !== input.source_fingerprint_after) {
    throw new Error('receiptline_lineage_source_changed')
  }
  return Object.freeze({ ...input, source_unchanged: true })
}

export function verifyLineage(value: unknown): { ok: true; lineage: SingleParentLineage } | { ok: false } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  const record = value as Record<string, unknown>
  const nullLineage = record.source_ref === null
    && record.source_fingerprint_before === null
    && record.source_fingerprint_after === null
  const presentLineage = typeof record.source_ref === 'string'
    && record.source_ref.trim() !== ''
    && typeof record.source_fingerprint_before === 'string'
    && SHA256_PATTERN.test(record.source_fingerprint_before)
    && typeof record.source_fingerprint_after === 'string'
    && SHA256_PATTERN.test(record.source_fingerprint_after)
    && record.source_fingerprint_before === record.source_fingerprint_after
  if (record.source_unchanged !== true || (!nullLineage && !presentLineage)) return { ok: false }
  return {
    ok: true,
    lineage: Object.freeze({
      source_ref: record.source_ref as string | null,
      source_fingerprint_before: record.source_fingerprint_before as string | null,
      source_fingerprint_after: record.source_fingerprint_after as string | null,
      source_unchanged: true,
    }),
  }
}
