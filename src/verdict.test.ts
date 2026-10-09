import { describe, expect, it } from 'vitest'
import {
  combineVerdicts,
  disclosureWith,
  fullDisclosure,
  mayClaimCompleteness,
} from './verdict.js'

describe('three-state verdicts', () => {
  it('the worst truth wins: FAIL > PARTIAL_NOT_EVALUABLE > PASS', () => {
    expect(combineVerdicts(['PASS', 'FAIL', 'PARTIAL_NOT_EVALUABLE'])).toBe('FAIL')
    expect(combineVerdicts(['PASS', 'PARTIAL_NOT_EVALUABLE'])).toBe('PARTIAL_NOT_EVALUABLE')
    expect(combineVerdicts(['PASS', 'PASS'])).toBe('PASS')
    expect(combineVerdicts([])).toBe('PASS')
  })

  it('an all-filtered evidence set is not a PASS and not a FAIL', () => {
    expect(combineVerdicts(['PARTIAL_NOT_EVALUABLE'])).toBe('PARTIAL_NOT_EVALUABLE')
  })
})

describe('disclosure', () => {
  it('a full denominator permits completeness claims', () => {
    expect(mayClaimCompleteness(fullDisclosure())).toBe(true)
    expect(mayClaimCompleteness(disclosureWith({ counted: 40 }))).toBe(true)
  })

  it('undatable or unreadable items cap every completeness claim', () => {
    expect(mayClaimCompleteness(disclosureWith({ counted: 37, undatable: ['run-9'] }))).toBe(false)
    expect(mayClaimCompleteness(disclosureWith({ counted: 37, unreadable: ['receipt-2'] }))).toBe(false)
  })

  it('carries the names, not just the counts', () => {
    const disclosure = disclosureWith({ counted: 37, undatable: ['run-9', 'run-12'] })
    expect(disclosure.undatable).toEqual(['run-9', 'run-12'])
    expect(disclosure.counted).toBe(37)
    expect(disclosure.denominator_known).toBe(false)
  })
})
