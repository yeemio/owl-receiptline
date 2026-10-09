import { describe, expect, it } from 'vitest'
import {
  assessCitations,
  findUniqueCorrection,
  worstGateState,
  type CitationGateConfig,
  type CitationRef,
  type DeliveryManifestLike,
  type MembershipSidecarLike,
  type RefCheckPolicy,
} from './citation.js'

const SUPPORT: ReadonlySet<string> = new Set(['ADMITTED'])
const DISPLAY: ReadonlySet<string> = new Set(['ADMITTED', 'CONFLICTED'])

const supportPolicy: CitationGateConfig = {
  refPolicy: () => ({ checksDelivery: true, membership: 'support' }),
  supportStatuses: SUPPORT,
  displayStatuses: DISPLAY,
}

/** Conflict discussions may name a CONFLICTED member; tool receipts skip S. */
const mixedPolicy: CitationGateConfig = {
  refPolicy: (kind, purpose): RefCheckPolicy => {
    if (purpose === 'conflict_discussion') return { checksDelivery: true, membership: 'display' }
    if (kind === 'tool_receipt') return { checksDelivery: true, membership: 'none' }
    return { checksDelivery: true, membership: 'support' }
  },
  supportStatuses: SUPPORT,
  displayStatuses: DISPLAY,
}

const manifest: DeliveryManifestLike = {
  hash: 'manifest-hash-1',
  slices: [
    { id: 'ev-market-1', versionHash: 'v1', section: 'odds', view: 'FULL' },
    { id: 'ev-section-1', versionHash: 'v1', section: 'injuries', view: 'EXCERPT' },
    { id: 'ev-catalog-1', versionHash: 'v1', section: null, view: 'CATALOG_HEADER' },
    { id: 'rcpt-1', versionHash: 'v9', section: null, view: 'FULL', bodyHash: 'bh-1' },
    {
      id: 'rcpt-ref-1',
      versionHash: 'v9',
      section: null,
      view: 'IDENTIFIER_ONLY',
      aliasOf: 'rcpt-1',
      bodyHash: 'bh-1',
    },
    {
      id: 'rcpt-bad-hash',
      versionHash: 'v9',
      section: null,
      view: 'IDENTIFIER_ONLY',
      aliasOf: 'rcpt-1',
      bodyHash: 'bh-OTHER',
    },
    {
      id: 'rcpt-ghost-alias',
      versionHash: 'v9',
      section: null,
      view: 'IDENTIFIER_ONLY',
      aliasOf: 'no-such-twin',
      bodyHash: 'bh-1',
    },
    { id: 'ev-spelled-1', versionHash: 'v2', section: null, view: 'EXCERPT' },
    { id: 'ev-amb-1', versionHash: 'v1', section: null, view: 'FULL' },
    { id: 'EV_AMB_2', versionHash: 'v1', section: null, view: 'FULL' },
    { id: 'ev-conflicted-1', versionHash: 'v3', section: null, view: 'FULL' },
  ],
}

const membership: MembershipSidecarLike = {
  hash: 'membership-hash-1',
  cutoffAt: '2026-01-01T00:00:00Z',
  members: [
    { id: 'ev-market-1', status: 'ADMITTED', availableAt: '2025-12-01T00:00:00Z' },
    { id: 'ev-section-1', status: 'ADMITTED', availableAt: '2025-12-01T00:00:00Z' },
    { id: 'ev-spelled-1', status: 'ADMITTED', availableAt: '2025-12-01T00:00:00Z' },
    { id: 'ev-amb-1', status: 'ADMITTED', availableAt: '2025-12-01T00:00:00Z' },
    { id: 'ev-amb-2', status: 'ADMITTED', availableAt: '2025-12-01T00:00:00Z' },
    { id: 'ev-conflicted-1', status: 'CONFLICTED', availableAt: '2025-12-01T00:00:00Z' },
    { id: 'ev-late-1', status: 'ADMITTED', availableAt: '2026-06-01T00:00:00Z' },
    { id: 'rcpt-1', status: 'ADMITTED', availableAt: '2025-12-01T00:00:00Z' },
  ],
  exclusions: ['ev-excluded-1'],
}

const okCore = [{ id: 'identity', value: true, failCode: 'core_identity_mismatch' }]

const ref = (over: Partial<CitationRef> & { id: string }): CitationRef => ({
  kind: 'evidence',
  ...over,
})

describe('worstGateState', () => {
  it('the worst truth wins: FAIL > NOT_EVALUABLE > PASS', () => {
    expect(worstGateState(['PASS', 'FAIL', 'NOT_EVALUABLE'])).toBe('FAIL')
    expect(worstGateState(['PASS', 'NOT_EVALUABLE'])).toBe('NOT_EVALUABLE')
    expect(worstGateState(['PASS', 'PASS'])).toBe('PASS')
    expect(worstGateState([])).toBe('PASS')
  })
})

describe('decisive ref shape and correction', () => {
  it('a malformed decisive ref is FATAL, never waived', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1', shape: 'malformed' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.decisiveState).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_malformed' }),
    )
    expect(result.usable).toBe(false)
  })

  it('an unrecognized ref with no candidate stays NOT_EVALUABLE — not FAIL, not PASS', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-nowhere', recognized: false })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('NOT_EVALUABLE')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'NOT_EVALUABLE', code: 'ref_unresolvable' }),
    )
    expect(result.usable).toBe(false)
  })

  it('a unique near-id candidate with a unique D version and an ADMITTED S member is corrected as ADVISORY', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev_spelled-1', shape: 'unknown' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.corrections).toEqual([{ from: 'ev_spelled-1', to: 'ev-spelled-1' }])
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'ADVISORY', code: 'correction_applied' }),
    )
    expect(result.decisiveState).toBe('PASS')
    expect(result.state).toBe('PASS')
    expect(result.usable).toBe(true)
  })

  it('the raw id itself being in the manifest is never a correction', () => {
    // 'ev-amb-2' exists exactly; 'EV_AMB_2' normalizes to it — no correction.
    expect(findUniqueCorrection(ref({ id: 'ev-amb-2' }), manifest, membership, SUPPORT)).toBeNull()
    expect(findUniqueCorrection(ref({ id: 'EV_AMB_2' }), manifest, membership, SUPPORT)).toBeNull()
  })

  it('ambiguous near-id candidates produce ref_unresolvable', () => {
    // 'ev-alpha_1' and 'ev-alpha-1' both normalize to 'evalpha1'.
    const ambiguous: DeliveryManifestLike = {
      hash: 'm',
      slices: [
        { id: 'ev-alpha_1', versionHash: 'v1', section: null, view: 'FULL' },
        { id: 'ev-alpha-1', versionHash: 'v1', section: null, view: 'FULL' },
      ],
    }
    const ambiguousMembership: MembershipSidecarLike = {
      hash: 's',
      cutoffAt: '2026-01-01T00:00:00Z',
      members: [{ id: 'ev-alpha-1', status: 'ADMITTED' }],
    }
    expect(
      findUniqueCorrection(ref({ id: 'EV_ALPHA_1' }), ambiguous, ambiguousMembership, SUPPORT),
    ).toBeNull()
    const result = assessCitations({
      refs: [{ kind: 'evidence', id: 'EV_ALPHA_1', recognized: false }],
      coreFacts: okCore,
      manifest: ambiguous,
      membership: ambiguousMembership,
      config: supportPolicy,
    })
    expect(result.state).toBe('NOT_EVALUABLE')
    expect(result.corrections).toEqual([])
  })

  it('correction is refused when the sealed member is not support-sufficient', () => {
    // 'ev-CONFLICTED-1' normalizes to 'evconflicted1' — unique candidate —
    // but its member is CONFLICTED, not in supportStatuses.
    expect(
      findUniqueCorrection(ref({ id: 'ev-CONFLICTED-1' }), manifest, membership, SUPPORT),
    ).toBeNull()
    const result = assessCitations({
      refs: [ref({ id: 'ev-CONFLICTED-1', recognized: false })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'NOT_EVALUABLE', code: 'ref_unresolvable' }),
    )
  })

  it('correction is refused when the ref claims a conflicting version', () => {
    const correction = findUniqueCorrection(
      ref({ id: 'ev-spelled_1', versionHash: 'v999' }),
      manifest,
      membership,
      SUPPORT,
    )
    expect(correction).toBeNull()
  })
})

describe('D side: delivery manifest', () => {
  it('null manifest is legacy NOT_EVALUABLE — never FAIL, never PASS', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1' })],
      coreFacts: okCore,
      manifest: null,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('NOT_EVALUABLE')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'NOT_EVALUABLE', code: 'delivery_not_recorded' }),
    )
  })

  it('an id with no slice at all is FATAL ref_undelivered', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-absent-1' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_undelivered' }),
    )
  })

  it('a CATALOG_HEADER row never proves the body was read', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-catalog-1' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_not_delivered_in_substantive_view' }),
    )
  })

  it('IDENTIFIER_ONLY passes only through a valid alias: FULL twin, same body hash', () => {
    const result = assessCitations({
      refs: [ref({ kind: 'tool_receipt', id: 'rcpt-ref-1' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: mixedPolicy,
    })
    expect(result.decisiveState).toBe('PASS')
    expect(result.usable).toBe(true)
  })

  it('an alias twin with a different body hash is invalid', () => {
    const result = assessCitations({
      refs: [ref({ id: 'rcpt-bad-hash' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_not_delivered_in_substantive_view' }),
    )
  })

  it('an alias pointing at a missing or non-FULL twin is invalid', () => {
    const ghost = assessCitations({
      refs: [ref({ id: 'rcpt-ghost-alias' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(ghost.fieldResults).toContainEqual(
      expect.objectContaining({ code: 'ref_not_delivered_in_substantive_view' }),
    )
    const catalogTwin: DeliveryManifestLike = {
      hash: 'm',
      slices: [
        { id: 'twin', versionHash: 'v1', section: null, view: 'CATALOG_HEADER' },
        { id: 'ref-slice', versionHash: 'v1', section: null, view: 'IDENTIFIER_ONLY', aliasOf: 'twin', bodyHash: 'b' },
      ],
    }
    const notFull = assessCitations({
      refs: [ref({ id: 'ref-slice' })],
      coreFacts: okCore,
      manifest: catalogTwin,
      membership: null,
      config: { ...supportPolicy, refPolicy: () => ({ checksDelivery: true, membership: 'none' }) },
    })
    expect(notFull.fieldResults).toContainEqual(
      expect.objectContaining({ code: 'ref_not_delivered_in_substantive_view' }),
    )
  })

  it('a claimed version the manifest contradicts is FATAL ref_version_mismatch', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1', versionHash: 'v2' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_version_mismatch' }),
    )
  })

  it('a claimed section an excerpted slice contradicts is FATAL ref_section_mismatch', () => {
    // ev-section-1 is delivered EXCERPT with section 'injuries'; a locator
    // pointing elsewhere fails. (FULL deliveries supersede section locators.)
    const result = assessCitations({
      refs: [ref({ id: 'ev-section-1', section: 'lineups' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_section_mismatch' }),
    )
  })

  it('matching section and version passes; EXCERPT/PROJECTION carry content authority', () => {
    const excerpt = assessCitations({
      refs: [ref({ id: 'ev-section-1', versionHash: 'v1', section: 'injuries' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(excerpt.usable).toBe(true)
    const projectionOnly: DeliveryManifestLike = {
      hash: 'm',
      slices: [{ id: 'ev-p', versionHash: 'v1', section: null, view: 'PROJECTION' }],
    }
    const projection = assessCitations({
      refs: [ref({ id: 'ev-p' })],
      coreFacts: okCore,
      manifest: projectionOnly,
      membership: null,
      config: { ...supportPolicy, refPolicy: () => ({ checksDelivery: true, membership: 'none' }) },
    })
    expect(projection.decisiveState).toBe('PASS')
  })
})

describe('S side: sealed membership', () => {
  it('null membership is NOT_EVALUABLE membership_not_recorded', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1' })],
      coreFacts: okCore,
      manifest,
      membership: null,
      config: supportPolicy,
    })
    expect(result.state).toBe('NOT_EVALUABLE')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'NOT_EVALUABLE', code: 'membership_not_recorded' }),
    )
  })

  it('a member the sidecar never sealed is FATAL ref_not_sealed', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-catalog-1' })],
      coreFacts: okCore,
      manifest: { hash: 'm', slices: [{ id: 'ev-catalog-1', versionHash: 'v1', section: null, view: 'FULL' }] },
      membership,
      config: supportPolicy,
    })
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_not_sealed' }),
    )
  })

  it('a named exclusion refuses membership outright', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-excluded-1' })],
      coreFacts: okCore,
      manifest: {
        hash: 'm',
        slices: [{ id: 'ev-excluded-1', versionHash: 'v1', section: null, view: 'FULL' }],
      },
      membership: {
        ...membership,
        members: [...membership.members, { id: 'ev-excluded-1', status: 'ADMITTED' }],
      },
      config: supportPolicy,
    })
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_not_sealed' }),
    )
  })

  it('support mode: CONFLICTED cannot back an uncontested fact', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-conflicted-1' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_member_status_insufficient' }),
    )
  })

  it('support mode: ADMITTED pre-cutoff member passes', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.decisiveState).toBe('PASS')
    expect(result.usable).toBe(true)
  })

  it('support mode: material first available after the cutoff is FATAL ref_available_after_cutoff', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-late-1' })],
      coreFacts: okCore,
      manifest: { hash: 'm', slices: [{ id: 'ev-late-1', versionHash: 'v1', section: null, view: 'FULL' }] },
      membership: {
        ...membership,
        members: [...membership.members, { id: 'ev-late-1', status: 'ADMITTED' }],
      },
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_available_after_cutoff' }),
    )
  })

  it('available exactly at the cutoff is not after it (strict comparison)', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-edge-1' })],
      coreFacts: okCore,
      manifest: { hash: 'm', slices: [{ id: 'ev-edge-1', versionHash: 'v1', section: null, view: 'FULL' }] },
      membership: {
        ...membership,
        members: [{ id: 'ev-edge-1', status: 'ADMITTED', availableAt: '2026-01-01T00:00:00Z' }],
      },
      config: supportPolicy,
    })
    expect(result.decisiveState).toBe('PASS')
  })

  it('display mode: a CONFLICTED member may be discussed', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-conflicted-1', purpose: 'conflict_discussion' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: mixedPolicy,
    })
    expect(result.decisiveState).toBe('PASS')
    expect(result.usable).toBe(true)
  })

  it('display mode: a REJECTED member is FATAL', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-rejected-1', purpose: 'conflict_discussion' })],
      coreFacts: okCore,
      manifest: { hash: 'm', slices: [{ id: 'ev-rejected-1', versionHash: 'v1', section: null, view: 'FULL' }] },
      membership: {
        ...membership,
        members: [...membership.members, { id: 'ev-rejected-1', status: 'REJECTED' }],
      },
      config: mixedPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_member_status_insufficient' }),
    )
  })

  it('display mode: a post-cutoff member is FATAL too (cutoff binds both modes)', () => {
    const lateDisplay: MembershipSidecarLike = {
      hash: 's',
      cutoffAt: '2026-01-01T00:00:00Z',
      members: [{ id: 'ev-late-display-1', status: 'CONFLICTED', availableAt: '2026-06-01T00:00:00Z' }],
    }
    const result = assessCitations({
      refs: [ref({ id: 'ev-late-display-1', purpose: 'conflict_discussion' })],
      coreFacts: okCore,
      manifest: { hash: 'm', slices: [{ id: 'ev-late-display-1', versionHash: 'v1', section: null, view: 'FULL' }] },
      membership: lateDisplay,
      config: mixedPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_available_after_cutoff' }),
    )
  })

  it('a FULL delivery satisfies a section locator (section only binds excerpted views)', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1', section: 'somewhere-else' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    // ev-market-1 is delivered FULL; the section locator is advisory there.
    expect(result.decisiveState).toBe('PASS')
  })

  it("membership 'none' skips the sealed set entirely — tool receipts ride D alone", () => {
    const result = assessCitations({
      refs: [ref({ kind: 'tool_receipt', id: 'rcpt-1' })],
      coreFacts: okCore,
      manifest,
      membership: null,
      config: mixedPolicy,
    })
    expect(result.decisiveState).toBe('PASS')
    expect(result.usable).toBe(true)
  })
})

describe('K0 core facts', () => {
  it('a false core fact is FATAL with its own fail code and kills usability', () => {
    const result = assessCitations({
      refs: [],
      coreFacts: [{ id: 'binding', value: false, failCode: 'snapshot_binding_mismatch' }],
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ path: 'core.binding', severity: 'FATAL', code: 'snapshot_binding_mismatch' }),
    )
    expect(result.decisiveState).toBe('PASS')
    expect(result.usable).toBe(false)
  })

  it('an unknown core fact is NOT_EVALUABLE with the _unknown code', () => {
    const result = assessCitations({
      refs: [],
      coreFacts: [{ id: 'identity', value: null, failCode: 'core_identity_mismatch' }],
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('NOT_EVALUABLE')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({
        severity: 'NOT_EVALUABLE',
        code: 'core_identity_mismatch_unknown',
      }),
    )
    expect(result.usable).toBe(false)
  })

  it('true core facts produce no rows; all true + decisive PASS is usable', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1' })],
      coreFacts: [
        { id: 'identity', value: true, failCode: 'core_identity_mismatch' },
        { id: 'binding', value: true, failCode: 'snapshot_binding_mismatch' },
      ],
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.fieldResults.filter((row) => row.path.startsWith('core.'))).toEqual([])
    expect(result.state).toBe('PASS')
    expect(result.usable).toBe(true)
  })
})

describe('extraction completeness and usable', () => {
  it('zero refs with an incomplete host extraction is NOT_EVALUABLE, not a vacuous PASS', () => {
    const result = assessCitations({
      refs: [],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
      hostExtractionComplete: false,
    })
    expect(result.state).toBe('NOT_EVALUABLE')
    expect(result.decisiveState).toBe('NOT_EVALUABLE')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ code: 'decisive_refs_not_extracted' }),
    )
    expect(result.usable).toBe(false)
  })

  it('zero refs with complete extraction is a legitimate PASS', () => {
    const result = assessCitations({
      refs: [],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('PASS')
    expect(result.usable).toBe(true)
  })

  it('extraction-incomplete does not shadow a non-empty decisive set', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
      hostExtractionComplete: false,
    })
    expect(result.decisiveState).toBe('PASS')
    expect(result.usable).toBe(true)
  })

  it('usable needs both halves: core PASS + decisive FAIL is not usable', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-absent-1' })],
      coreFacts: okCore,
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.usable).toBe(false)
  })

  it('usable needs both halves: core FAIL + decisive PASS is not usable', () => {
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1' })],
      coreFacts: [{ id: 'binding', value: false, failCode: 'snapshot_binding_mismatch' }],
      manifest,
      membership,
      config: supportPolicy,
    })
    expect(result.decisiveState).toBe('PASS')
    expect(result.usable).toBe(false)
  })

  it('FATAL is never waived by a coexisting ADVISORY correction', () => {
    // 'ev-late_1' corrects to 'ev-late-1' (unique, ADMITTED) — ADVISORY — but
    // the member is post-cutoff, so the S check still lands FATAL.
    const lateMembership: MembershipSidecarLike = {
      hash: 's',
      cutoffAt: '2026-01-01T00:00:00Z',
      members: [{ id: 'ev-late-1', status: 'ADMITTED', availableAt: '2026-06-01T00:00:00Z' }],
    }
    const lateManifest: DeliveryManifestLike = {
      hash: 'm',
      slices: [{ id: 'ev-late-1', versionHash: 'v1', section: null, view: 'FULL' }],
    }
    const result = assessCitations({
      refs: [ref({ id: 'ev-late_1', shape: 'unknown' })],
      coreFacts: okCore,
      manifest: lateManifest,
      membership: lateMembership,
      config: supportPolicy,
    })
    expect(result.corrections).toEqual([{ from: 'ev-late_1', to: 'ev-late-1' }])
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'ADVISORY', code: 'correction_applied' }),
    )
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_available_after_cutoff' }),
    )
    expect(result.state).toBe('FAIL')
    expect(result.usable).toBe(false)
  })

  it('a ref pinning a version the sealed member does not carry is FATAL', () => {
    const versionedMembership: MembershipSidecarLike = {
      ...membership,
      members: [{ id: 'ev-market-1', status: 'ADMITTED', versionHash: 'v1' }],
    }
    // Delivery carries v2 (D side passes); the sealed member is still v1.
    const versionedManifest: DeliveryManifestLike = {
      ...manifest,
      slices: [{ id: 'ev-market-1', versionHash: 'v2', section: null, view: 'FULL' }],
    }
    const result = assessCitations({
      refs: [ref({ id: 'ev-market-1', versionHash: 'v2' })],
      coreFacts: okCore,
      manifest: versionedManifest,
      membership: versionedMembership,
      config: supportPolicy,
    })
    expect(result.state).toBe('FAIL')
    expect(result.fieldResults).toContainEqual(
      expect.objectContaining({ severity: 'FATAL', code: 'ref_member_version_mismatch' }),
    )
    // Matching versions (or a member without a recorded version) pass.
    const matching = assessCitations({
      refs: [ref({ id: 'ev-market-1', versionHash: 'v1' })],
      coreFacts: okCore,
      manifest,
      membership: versionedMembership,
      config: supportPolicy,
    })
    expect(matching.decisiveState).toBe('PASS')
    // Versions absent on BOTH sides never trip the check (it is optional).
    const unrecorded = assessCitations({
      refs: [ref({ id: 'ev-market-1', versionHash: null })],
      coreFacts: okCore,
      manifest: {
        ...manifest,
        slices: [{ id: 'ev-market-1', versionHash: null, section: null, view: 'FULL' }],
      },
      membership,
      config: supportPolicy,
    })
    expect(unrecorded.decisiveState).toBe('PASS')
  })
})
