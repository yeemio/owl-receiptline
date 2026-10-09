import { SHA256_PATTERN } from './envelope.js'

/**
 * Explicit supersession: a receipt is NEVER overwritten. A correction is a
 * new record that embeds the full identity (id + content hash) of the
 * receipt it replaces and names its reason — the superseded receipt's bytes
 * stay untouched, and the chain of records is the only evidence a
 * correction ever happened.
 *
 * Source semantics (OwlFootball round05 canonical rebound): the rebound is
 * an additive binding that embeds the complete superseded snapshot seal
 * (`supersedes_snapshot_seal`), carries a named `reason_code` and its own
 * new seal, and leaves the original binding array byte-identical; the
 * resolver prefers the rebound for the identity slot. Same discipline as
 * the docs/receipts rework convention: a rework lands as a new `_R0`/`_R1`
 * predecessor image, never as an edit of the original file.
 */
export const SUPERSEDE_ARTIFACT_VERSION = 'receipt-supersede-record.v1'

/** The identity of a receipt: a caller-defined slot id plus its content hash. */
export interface SupersedeIdentity {
  readonly id: string
  readonly hash: string
}

/**
 * One explicit replacement. Links the superseded receipt's identity to the
 * replacement's identity by content, never by position or clock.
 */
export interface SupersedeRecord {
  readonly artifact_version: string
  /** Full identity of the superseded receipt — embedded, not pointed at. */
  readonly supersedes: SupersedeIdentity
  /** Identity of the new, currently-valid receipt. */
  readonly replacement: SupersedeIdentity
  /** Named, human-auditable cause of the correction; never empty. */
  readonly reason: string
  /**
   * Recorded provenance only (ordinal or epoch, caller's choice). NEVER
   * trusted for chain order: linkage is structural (id + hash); clocks lie.
   */
  readonly superseded_at: number
  /** Optional hash of the evidence that justified the correction. */
  readonly evidence_hash?: string
}

const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/iu

function requireIdentity(value: unknown, field: string): SupersedeIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`receiptline_supersede_${field}_invalid`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new Error(`receiptline_supersede_${field}_invalid`)
  }
  if (typeof record.hash !== 'string' || !SHA256_PATTERN.test(record.hash)) {
    throw new Error(`receiptline_supersede_${field}_invalid`)
  }
  return Object.freeze({ id: record.id, hash: record.hash })
}

/**
 * Construct an immutable supersede record. Throws on malformed identities,
 * empty reasons, non-finite timestamps, and exact self-reference (a record
 * whose supersedes identity equals its replacement identity corrected
 * nothing and is not a correction).
 */
export function makeSupersede(input: {
  readonly supersedes: SupersedeIdentity
  readonly replacement: SupersedeIdentity
  readonly reason: string
  readonly superseded_at: number
  readonly evidence_hash?: string
  readonly artifact_version?: string
}): SupersedeRecord {
  const artifactVersion = input.artifact_version ?? SUPERSEDE_ARTIFACT_VERSION
  if (!VERSION_PATTERN.test(artifactVersion)) {
    throw new Error('receiptline_supersede_version_invalid')
  }
  const supersedes = requireIdentity(input.supersedes, 'target')
  const replacement = requireIdentity(input.replacement, 'replacement')
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    throw new Error('receiptline_supersede_reason_invalid')
  }
  if (typeof input.superseded_at !== 'number' || !Number.isFinite(input.superseded_at)) {
    throw new Error('receiptline_supersede_time_invalid')
  }
  if (input.evidence_hash !== undefined
    && (typeof input.evidence_hash !== 'string' || !SHA256_PATTERN.test(input.evidence_hash))) {
    throw new Error('receiptline_supersede_evidence_hash_invalid')
  }
  if (supersedes.id === replacement.id && supersedes.hash === replacement.hash) {
    throw new Error('receiptline_supersede_self_reference')
  }
  const record = {
    artifact_version: artifactVersion,
    supersedes,
    replacement,
    reason: input.reason,
    superseded_at: input.superseded_at,
    ...(input.evidence_hash !== undefined ? { evidence_hash: input.evidence_hash } : {}),
  }
  return Object.freeze(record)
}

export type SupersedeChainFailure =
  | { readonly reason: 'invalid_record'; readonly index: number }
  | { readonly reason: 'double_supersede'; readonly indices: readonly number[]; readonly target: SupersedeIdentity }
  | { readonly reason: 'dangling_target'; readonly index: number; readonly target: SupersedeIdentity }
  | { readonly reason: 'forked_replacement'; readonly indices: readonly number[]; readonly replacement: SupersedeIdentity }
  | { readonly reason: 'cycle_detected'; readonly indices: readonly number[] }

/** One verified chain, ordered from the head (the original receipt) to the tail. */
export interface SupersedeChain {
  /** Identity of the original receipt the chain starts from. */
  readonly head: SupersedeIdentity
  /** The supersede records in causal order. */
  readonly records: readonly SupersedeRecord[]
  /** The chain tail — the currently-valid receipt. */
  readonly latest: SupersedeIdentity
}

export type SupersedeChainVerification =
  | { readonly ok: true; readonly chains: readonly SupersedeChain[] }
  | { readonly ok: false; readonly failures: readonly SupersedeChainFailure[] }

function identityKey(identity: SupersedeIdentity): string {
  return JSON.stringify([identity.id, identity.hash])
}

function isSupersedeShape(value: unknown): value is SupersedeRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const identity = (value: unknown): boolean =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).id === 'string'
    && ((value as Record<string, unknown>).id as string).trim() !== ''
    && typeof (value as Record<string, unknown>).hash === 'string'
    && SHA256_PATTERN.test((value as Record<string, unknown>).hash as string)
  return typeof record.artifact_version === 'string'
    && record.artifact_version.trim() !== ''
    && identity(record.supersedes)
    && identity(record.replacement)
    && typeof record.reason === 'string'
    && record.reason.trim() !== ''
    && typeof record.superseded_at === 'number'
    && Number.isFinite(record.superseded_at)
    && (record.evidence_hash === undefined
      || (typeof record.evidence_hash === 'string' && SHA256_PATTERN.test(record.evidence_hash)))
}

/**
 * Verify a set of supersede records (order-independent, accepts untrusted
 * input). Checks:
 * - every record is well-formed;
 * - no receipt identity is superseded twice (`double_supersede` — the
 *   current receipt of a slot must never be ambiguous, mirroring the
 *   source resolver's single-binding-per-slot lookup);
 * - no replacement has two competing histories (`forked_replacement`);
 * - when `heads` (identities of receipts known to exist) is provided,
 *   every superseded identity must exist — either a known head or another
 *   record's replacement (`dangling_target`);
 * - the records decompose into acyclic, root-to-tail-traversable chains
 *   (`cycle_detected`); the chain start is the record whose superseded
 *   identity is a known head, or — when no heads are given — any identity
 *   outside the record set (the original receipt, which is not itself a
 *   supersede record).
 */
export function verifySupersedeChain(input: {
  readonly records: readonly unknown[]
  readonly heads?: readonly SupersedeIdentity[]
}): SupersedeChainVerification {
  const records = input.records
  const failures: SupersedeChainFailure[] = []
  for (let index = 0; index < records.length; index++) {
    if (!isSupersedeShape(records[index])) failures.push({ reason: 'invalid_record', index })
  }
  if (failures.length > 0) return { ok: false, failures: Object.freeze(failures) }
  const valid = records as readonly SupersedeRecord[]

  const supersededBy = new Map<string, number[]>()
  for (let index = 0; index < valid.length; index++) {
    const key = identityKey(valid[index]!.supersedes)
    const seen = supersededBy.get(key)
    if (seen) seen.push(index)
    else supersededBy.set(key, [index])
  }
  for (const indices of supersededBy.values()) {
    if (indices.length > 1) {
      failures.push({
        reason: 'double_supersede',
        indices: Object.freeze([...indices]),
        target: valid[indices[0]!]!.supersedes,
      })
    }
  }
  if (failures.length > 0) return { ok: false, failures: Object.freeze(failures) }

  const successorOf = new Map<string, number>()
  const replacementsBy = new Map<string, number[]>()
  for (let index = 0; index < valid.length; index++) {
    successorOf.set(identityKey(valid[index]!.supersedes), index)
    const key = identityKey(valid[index]!.replacement)
    const seen = replacementsBy.get(key)
    if (seen) seen.push(index)
    else replacementsBy.set(key, [index])
  }
  for (const indices of replacementsBy.values()) {
    if (indices.length > 1) {
      failures.push({
        reason: 'forked_replacement',
        indices: Object.freeze([...indices]),
        replacement: valid[indices[0]!]!.replacement,
      })
    }
  }
  if (failures.length > 0) return { ok: false, failures: Object.freeze(failures) }

  const heads = input.heads
  if (heads !== undefined) {
    const known = new Set<string>([
      ...heads.map(identityKey),
      ...[...replacementsBy.keys()],
    ])
    for (let index = 0; index < valid.length; index++) {
      const target = valid[index]!.supersedes
      if (!known.has(identityKey(target))) {
        failures.push({ reason: 'dangling_target', index, target })
      }
    }
    if (failures.length > 0) return { ok: false, failures: Object.freeze(failures) }
  }

  const isReplacement = new Set([...replacementsBy.keys()])
  const visited = new Set<number>()
  const chains: SupersedeChain[] = []
  for (let root = 0; root < valid.length; root++) {
    if (isReplacement.has(identityKey(valid[root]!.supersedes))) continue
    const order: number[] = []
    let step: number | undefined = root
    while (step !== undefined && !visited.has(step) && order.length <= valid.length) {
      visited.add(step)
      order.push(step)
      step = successorOf.get(identityKey(valid[step]!.replacement))
    }
    const last = valid[order[order.length - 1]!]!
    chains.push(Object.freeze({
      head: valid[root]!.supersedes,
      records: Object.freeze(order.map((index) => valid[index]!)),
      latest: last.replacement,
    }))
  }
  const cyclic: number[] = []
  for (let index = 0; index < valid.length; index++) {
    if (!visited.has(index)) cyclic.push(index)
  }
  if (cyclic.length > 0) {
    return {
      ok: false,
      failures: Object.freeze([
        { reason: 'cycle_detected', indices: Object.freeze(cyclic) } as SupersedeChainFailure,
      ]),
    }
  }
  return { ok: true, chains: Object.freeze(chains) }
}

/**
 * The chain tail — the currently-valid receipt of an ordered supersede
 * chain. `null` for an empty chain.
 */
export function latestOf(chain: readonly SupersedeRecord[]): SupersedeIdentity | null {
  if (chain.length === 0) return null
  return chain[chain.length - 1]!.replacement
}
