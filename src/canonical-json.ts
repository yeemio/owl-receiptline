import { createHash } from 'node:crypto'

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('failgate_canonical_json_non_finite_number')
  }
  return value
}

/**
 * Deterministic JSON serialization: object keys sorted by UTF-16 code unit,
 * `undefined` values dropped, non-finite numbers rejected. Same value in,
 * same bytes out — across processes and platforms — so hashes keyed on it
 * (circuit scopes, identity keys) stay stable.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashCanonical(value: unknown): string {
  return sha256(canonicalJson(value))
}
