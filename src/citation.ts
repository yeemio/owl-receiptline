/**
 * Citation gate: prove that the evidence a decision cites actually reached the
 * model and still stands in the sealed record. Three states, worst truth wins
 * (`worstGateState`: FAIL > NOT_EVALUABLE > PASS):
 *   - FAIL — a confirmed violation: a malformed decisive ref, a citation whose
 *     body was never delivered in a substantive view, a version or section the
 *     manifest contradicts, a member that is unsealed, status-insufficient or
 *     post-cutoff, or a false core identity fact. ADVISORY rows never waive a
 *     FATAL.
 *   - NOT_EVALUABLE — the check could not be adjudicated at all: a null
 *     manifest or membership sidecar (the legacy sentinel — history without
 *     receipts is an honest unknown, never FAIL and never a vacuous PASS), an
 *     unresolvable decisive citation, or a host that reports its extraction
 *     was incomplete while naming zero refs.
 *   - PASS — every core fact true and every decisive ref both delivered and
 *     sealed.
 *
 * The domain is injected, not hardcoded: which ref kinds check delivery and
 * how they may use the sealed set (support / display / not at all) comes from
 * `refPolicy`; status vocabularies come from config; core facts are an opaque
 * list. This library owns none of the source system's namespaces, kinds or
 * correction word lists.
 */

export type GateState = 'PASS' | 'FAIL' | 'NOT_EVALUABLE'

const GATE_STATE_ORDER: Readonly<Record<GateState, number>> = {
  FAIL: 2,
  NOT_EVALUABLE: 1,
  PASS: 0,
}

/** Worst-state fold: FAIL > NOT_EVALUABLE > PASS (never collapse). */
export function worstGateState(states: readonly GateState[]): GateState {
  let worst: GateState = 'PASS'
  for (const state of states) {
    if (GATE_STATE_ORDER[state] > GATE_STATE_ORDER[worst]) worst = state
  }
  return worst
}

export type CitationShape = 'legal' | 'unknown' | 'malformed'

export interface CitationRef {
  kind: string
  id: string
  /** Version the citation claims; compared against D when present. */
  versionHash?: string | null
  /** The decisive field/section the ref supports (locator, not delivery). */
  section?: string | null
  /** Host-defined intent (e.g. fact support vs. display discussion). */
  purpose?: string | null
  /** False — the citation names no known id in this request's namespace. */
  recognized?: boolean
  /** Every non-empty explicit citation has a shape; unknown needs correction. */
  shape?: CitationShape
}

export interface RefCheckPolicy {
  /** Does this ref need delivered content authority in the manifest (D)? */
  checksDelivery: boolean
  /** How the sealed membership may back this ref (S): support, display, none. */
  membership: 'support' | 'display' | 'none'
}

export interface GateFieldResult {
  path: string
  severity: 'FATAL' | 'NOT_EVALUABLE' | 'ADVISORY'
  code: string
  /** Raw ref label the finding is about, kept uncorrected for audit. */
  ref?: string
  manifestHash?: string | null
}

export interface DeliverySlice {
  id: string
  versionHash: string | null
  section: string | null
  view: 'FULL' | 'EXCERPT' | 'PROJECTION' | 'CATALOG_HEADER' | 'IDENTIFIER_ONLY'
  /** Set when this slice inherits content authority from a named twin. */
  aliasOf?: string | null
  bodyHash?: string | null
}

export interface DeliveryManifestLike {
  hash: string
  membershipHash?: string | null
  slices: readonly DeliverySlice[]
}

export interface SealedMember {
  id: string
  status: string
  /** Sealed version of this member, when the sidecar records one; compared
   * against a ref's `versionHash` so an old version can never back a
   * current reference. */
  versionHash?: string | null
  availableAt?: string | null
}

export interface MembershipSidecarLike {
  hash: string
  cutoffAt: string
  members: readonly SealedMember[]
  /** Ids explicitly refused at seal time — never granted membership. */
  exclusions?: readonly string[]
}

export interface CoreFactCheck {
  id: string
  value: boolean | null
  failCode: string
}

export interface CitationGateConfig {
  refPolicy: (kind: string, purpose?: string | null) => RefCheckPolicy
  /** Statuses that may back an uncontested fact (e.g. {'ADMITTED'}). */
  supportStatuses: ReadonlySet<string>
  /** Statuses that may appear in discussion (e.g. {'ADMITTED','CONFLICTED'}). */
  displayStatuses: ReadonlySet<string>
}

export interface CitationAssessment {
  state: GateState
  decisiveState: GateState
  fieldResults: readonly GateFieldResult[]
  corrections: ReadonlyArray<{ from: string; to: string }>
  /** Every core fact true AND every decisive ref PASS. */
  usable: boolean
}

/**
 * Views that prove the body was actually handed over. A CATALOG_HEADER or
 * IDENTIFIER_ONLY row is navigation, never content: citing it as support
 * claims a read that did not happen.
 */
const NAVIGATION_ONLY_VIEWS: ReadonlySet<string> = new Set(['CATALOG_HEADER', 'IDENTIFIER_ONLY'])

const carriesContentAuthority = (slice: DeliverySlice): boolean =>
  slice.view === 'FULL' || slice.view === 'EXCERPT' || slice.view === 'PROJECTION'

const normalizeIdToken = (id: string): string => id.toLowerCase().replace(/[-_]/g, '')

/**
 * Correct a near-id spelling slip, and only when the correction is unique and
 * authoritative: exactly one manifest slice id matches the ref id up to
 * case/underscore/hyphen differences (and the raw id itself is NOT in the
 * manifest), that slice set carries exactly one version, the ref claims no
 * conflicting version, and the sealed set holds exactly one member with a
 * support-sufficient status for the corrected id. This is deliberately not
 * fuzzy matching — ambiguity, conflicting versions or insufficient status
 * produce no correction, and the ref stays unresolvable.
 */
export function findUniqueCorrection(
  ref: CitationRef,
  manifest: DeliveryManifestLike | null,
  membership: MembershipSidecarLike | null,
  supportStatuses: ReadonlySet<string>,
): string | null {
  if (manifest === null || membership === null) return null
  if (manifest.slices.some((slice) => slice.id === ref.id)) return null
  const normalized = normalizeIdToken(ref.id)
  const candidateIds = new Set<string>()
  for (const slice of manifest.slices) {
    if (slice.id !== ref.id && normalizeIdToken(slice.id) === normalized) candidateIds.add(slice.id)
  }
  if (candidateIds.size !== 1) return null
  let correctedId: string | null = null
  for (const id of candidateIds) correctedId = id
  if (correctedId === null) return null
  const candidateSlices = manifest.slices.filter((slice) => slice.id === correctedId)
  const versions = new Set(candidateSlices.map((slice) => slice.versionHash))
  if (versions.size !== 1) return null
  if (ref.versionHash != null) {
    let candidateVersion: string | null = null
    for (const slice of candidateSlices) candidateVersion = slice.versionHash
    if (candidateVersion !== ref.versionHash) return null
  }
  const supportingMembers = membership.members.filter(
    (member) => member.id === correctedId && supportStatuses.has(member.status),
  )
  if (supportingMembers.length !== 1) return null
  return correctedId
}

/**
 * D side: does the manifest prove this ref's body was delivered in a
 * substantive view? Version mismatch (id delivered, claimed version absent)
 * is judged before existence; section equality is judged per slice except
 * on FULL views (a full delivery supersedes any section locator); a
 * navigation-only view passes only through a valid alias — a twin that exists
 * in this same manifest as a FULL slice with the same body hash. Returns the
 * named failure code, or null when supported.
 */
function checkDelivery(
  manifest: DeliveryManifestLike,
  refId: string,
  ref: CitationRef,
): string | null {
  const all = manifest.slices.filter((slice) => slice.id === refId)
  let candidates = all
  if (ref.versionHash != null) {
    const versioned = all.filter((slice) => slice.versionHash === ref.versionHash)
    if (all.length > 0 && versioned.length === 0) return 'ref_version_mismatch'
    candidates = versioned
  }
  if (candidates.length === 0) return 'ref_undelivered'
  const authorityFirst = [...candidates].sort(
    (a, b) => Number(carriesContentAuthority(b)) - Number(carriesContentAuthority(a)),
  )
  let firstFailure: string | null = null
  for (const slice of authorityFirst) {
    if (NAVIGATION_ONLY_VIEWS.has(slice.view) && !aliasIsValid(manifest, slice)) {
      if (firstFailure === null) firstFailure = 'ref_not_delivered_in_substantive_view'
      continue
    }
    if (ref.section != null && slice.section !== ref.section && slice.view !== 'FULL') {
      if (firstFailure === null) firstFailure = 'ref_section_mismatch'
      continue
    }
    return null
  }
  return firstFailure
}

/** Alias validity: the twin exists in THIS manifest, carries content
 * authority itself (any substantive view), and — when both sides declare
 * body hashes — they match. */
function aliasIsValid(manifest: DeliveryManifestLike, slice: DeliverySlice): boolean {
  const target = slice.aliasOf
  if (target == null) return false
  const twin = manifest.slices.find((item) => item.id === target)
  if (twin === undefined || !carriesContentAuthority(twin)) return false
  if (slice.bodyHash != null && twin.bodyHash != null) {
    return slice.bodyHash === twin.bodyHash
  }
  return true
}

/**
 * S side: does the sealed set still stand behind this id? Named exclusions
 * refuse membership outright; support mode demands a support-sufficient
 * status, display mode a display-sufficient status (discussion may name a
 * conflicted member; it cannot be support); BOTH demand pre-cutoff
 * availability and, when the ref pins a version and the sidecar records
 * one, that the versions agree. Returns the named failure code, or null
 * when sealed.
 */
function checkMembership(
  membership: MembershipSidecarLike,
  refId: string,
  mode: 'support' | 'display',
  config: CitationGateConfig,
  refVersionHash?: string | null,
): string | null {
  const excluded = membership.exclusions?.includes(refId) ?? false
  const member = membership.members.find((item) => item.id === refId)
  if (member === undefined || excluded) return 'ref_not_sealed'
  const allowed = mode === 'support' ? config.supportStatuses : config.displayStatuses
  if (!allowed.has(member.status)) return 'ref_member_status_insufficient'
  if (refVersionHash != null && member.versionHash != null && member.versionHash !== refVersionHash) {
    return 'ref_member_version_mismatch'
  }
  if (member.availableAt != null) {
    const availableMs = Date.parse(member.availableAt)
    const cutoffMs = Date.parse(membership.cutoffAt)
    if (Number.isFinite(availableMs) && Number.isFinite(cutoffMs) && availableMs > cutoffMs) {
      return 'ref_available_after_cutoff'
    }
  }
  return null
}

/**
 * Assess the citation gate for one decision. Never throws on business
 * findings — every finding is a named field result; states only fold
 * FAIL/NOT_EVALUABLE, so an ADVISORY correction can never waive a FATAL.
 * `hostExtractionComplete` defaults to true; a host that knows its extraction
 * was incomplete and names zero refs gets NOT_EVALUABLE, never a vacuous PASS
 * ("all citations filtered out" is not "nothing to verify").
 */
export function assessCitations(input: {
  refs: readonly CitationRef[]
  coreFacts: readonly CoreFactCheck[]
  manifest: DeliveryManifestLike | null
  membership: MembershipSidecarLike | null
  config: CitationGateConfig
  hostExtractionComplete?: boolean
}): CitationAssessment {
  const { refs, coreFacts, manifest, membership, config } = input
  const extractionComplete = input.hostExtractionComplete ?? true
  const manifestHash = manifest?.hash ?? null

  const fieldResults: GateFieldResult[] = []
  const corrections: Array<{ from: string; to: string }> = []

  // K0 core facts: identity/binding class — false is fatal, unknown is an
  // honest NOT_EVALUABLE, and neither ever collapses into the other.
  const coreStates: GateState[] = []
  for (const fact of coreFacts) {
    if (fact.value === false) {
      coreStates.push('FAIL')
      fieldResults.push({ path: `core.${fact.id}`, severity: 'FATAL', code: fact.failCode })
    } else if (fact.value === null) {
      coreStates.push('NOT_EVALUABLE')
      fieldResults.push({
        path: `core.${fact.id}`,
        severity: 'NOT_EVALUABLE',
        code: `${fact.failCode}_unknown`,
      })
    } else {
      coreStates.push('PASS')
    }
  }
  const coreState = worstGateState(coreStates)

  // K1 decisive refs: every one must resolve, be delivered (D) and be sealed
  // (S) per its injected policy. Non-decisive structure and coverage are the
  // host's business — this library judges only the decisive closure.
  const decisiveStates: GateState[] = []
  if (refs.length === 0 && !extractionComplete) {
    decisiveStates.push('NOT_EVALUABLE')
    fieldResults.push({
      path: 'decisive_refs',
      severity: 'NOT_EVALUABLE',
      code: 'decisive_refs_not_extracted',
      manifestHash,
    })
  }
  for (const [index, rawRef] of refs.entries()) {
    const path = `decisive_refs[${index}]`
    const refLabel = `${rawRef.kind}:${rawRef.id}`
    const refResult = (severity: GateFieldResult['severity'], code: string): GateFieldResult => ({
      path,
      severity,
      code,
      ref: refLabel,
      manifestHash,
    })
    if (rawRef.shape === 'malformed') {
      decisiveStates.push('FAIL')
      fieldResults.push(refResult('FATAL', 'ref_malformed'))
      continue
    }
    let refId = rawRef.id
    if (rawRef.recognized === false || rawRef.shape === 'unknown') {
      const correctedId = findUniqueCorrection(rawRef, manifest, membership, config.supportStatuses)
      if (correctedId === null) {
        decisiveStates.push('NOT_EVALUABLE')
        fieldResults.push(refResult('NOT_EVALUABLE', 'ref_unresolvable'))
        continue
      }
      corrections.push({ from: rawRef.id, to: correctedId })
      fieldResults.push(refResult('ADVISORY', 'correction_applied'))
      refId = correctedId
    }
    const policy = config.refPolicy(rawRef.kind, rawRef.purpose ?? null)
    if (policy.checksDelivery) {
      if (manifest === null) {
        decisiveStates.push('NOT_EVALUABLE')
        fieldResults.push(refResult('NOT_EVALUABLE', 'delivery_not_recorded'))
        continue
      }
      const delivery = checkDelivery(manifest, refId, rawRef)
      if (delivery !== null) {
        decisiveStates.push('FAIL')
        fieldResults.push(refResult('FATAL', delivery))
        continue
      }
    }
    if (policy.membership !== 'none') {
      if (membership === null) {
        decisiveStates.push('NOT_EVALUABLE')
        fieldResults.push(refResult('NOT_EVALUABLE', 'membership_not_recorded'))
        continue
      }
      const sealed = checkMembership(membership, refId, policy.membership, config, rawRef.versionHash)
      if (sealed !== null) {
        decisiveStates.push('FAIL')
        fieldResults.push(refResult('FATAL', sealed))
        continue
      }
    }
    decisiveStates.push('PASS')
  }
  const decisiveState = worstGateState(decisiveStates)

  return {
    state: worstGateState([coreState, decisiveState]),
    decisiveState,
    fieldResults: Object.freeze(fieldResults),
    corrections: Object.freeze(corrections),
    usable: coreState === 'PASS' && decisiveState === 'PASS',
  }
}
