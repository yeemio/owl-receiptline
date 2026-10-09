/**
 * Three-state verdict. NOT_EVALUABLE never collapses into FAIL or PASS:
 * "all evidence was filtered out" and "evidence proved the claim wrong"
 * are different facts, and pretending otherwise is how audits lie.
 * Order: FAIL > PARTIAL_NOT_EVALUABLE > PASS — the worst truth wins.
 */
export type Verdict = 'FAIL' | 'PARTIAL_NOT_EVALUABLE' | 'PASS'

const VERDICT_ORDER: Readonly<Record<Verdict, number>> = {
  FAIL: 2,
  PARTIAL_NOT_EVALUABLE: 1,
  PASS: 0,
}

export function combineVerdicts(verdicts: readonly Verdict[]): Verdict {
  let worst: Verdict = 'PASS'
  for (const verdict of verdicts) {
    if (VERDICT_ORDER[verdict] > VERDICT_ORDER[worst]) worst = verdict
  }
  return worst
}

/**
 * Disclosure for things that could not be measured. Items that cannot be
 * dated, counted or read are NOT silently dropped: they are named, the
 * count is carried, and `denominator_known: false` caps every completeness
 * claim downstream — "37 of 40 checks passed" only means something when
 * the 40 is known to be the real denominator.
 */
export interface Disclosure {
  readonly undatable: readonly string[]
  readonly unreadable: readonly string[]
  readonly denominator_known: boolean
  readonly counted: number
}

export function fullDisclosure(): Disclosure {
  return Object.freeze({
    undatable: Object.freeze([]),
    unreadable: Object.freeze([]),
    denominator_known: true,
    counted: 0,
  })
}

export function disclosureWith(input: {
  readonly undatable?: readonly string[]
  readonly unreadable?: readonly string[]
  readonly counted: number
}): Disclosure {
  return Object.freeze({
    undatable: Object.freeze([...(input.undatable ?? [])]),
    unreadable: Object.freeze([...(input.unreadable ?? [])]),
    denominator_known: (input.undatable?.length ?? 0) === 0 && (input.unreadable?.length ?? 0) === 0,
    counted: input.counted,
  })
}

/** A completeness claim may only be made when the denominator is known. */
export function mayClaimCompleteness(disclosure: Disclosure): boolean {
  return disclosure.denominator_known
}
