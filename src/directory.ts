import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { hashCanonical } from './canonical-json.js'
import { readStableRegularFile } from './stable-read.js'

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u

/** One file in a manifest: sorted by relative_path, hashed by content,
 * counted by size. Nothing else. */
export interface ManifestEntry {
  readonly relative_path: string
  readonly size: number
  readonly sha256: string
}

export type DirectoryVerification =
  | {
    readonly ok: true
    readonly fingerprint: string
    readonly verified: Readonly<Record<string, Buffer>>
  }
  | {
    readonly ok: false
    readonly reason:
      | 'manifest_invalid'
      | 'manifest_path_invalid'
      | 'fingerprint_mismatch'
      | 'file_set_mismatch'
      | 'file_not_regular'
      | 'file_changed_during_read'
      | 'size_mismatch'
      | 'hash_mismatch'
  }

export function isSafeManifestRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value !== ''
    && !value.includes('\\')
    && !value.includes('\0')
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value.split('/').every((component) => component !== '' && component !== '.' && component !== '..')
}

/**
 * The fingerprint of a directory: the canonical-JSON hash of its sorted
 * manifest. Identical byte-for-byte content under identical paths yields
 * identical fingerprints; any add/remove/edit/in-place-rename changes it.
 * `exclude` names files that are part of the receipt machinery itself
 * (e.g. the receipt file) — a receipt must not hash itself.
 */
export function directoryFingerprint(input: {
  readonly entries: readonly ManifestEntry[]
}): string {
  const sorted = [...input.entries].sort((left, right) => comparePaths(left.relative_path, right.relative_path))
  return hashCanonical(sorted)
}

function comparePaths(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Re-verify a directory against a manifest, byte for byte:
 *
 * 1. manifest shape: exact key sets, safe sorted unique paths, sha256
 *    fields, non-negative integer sizes;
 * 2. manifest fingerprint matches the claimed one;
 * 3. the manifest and the actual regular-file set (minus `exclude`) are
 *    EQUAL IN BOTH DIRECTIONS — a file that appeared or disappeared since
 *    the receipt was written fails, not just modified files;
 * 4. every file is re-read defensively (no symlinks/hard links, no
 *    mid-read swaps) and its size + sha256 must match.
 *
 * Returns the verified bytes for `return_files` (defaults to all files).
 */
export function verifyDirectory(input: {
  readonly directory: string
  readonly manifest: readonly ManifestEntry[]
  readonly fingerprint: string
  readonly exclude?: readonly string[]
  readonly return_files?: readonly string[]
}): DirectoryVerification {
  if (!Array.isArray(input.manifest) || input.manifest.length === 0) {
    return { ok: false, reason: 'manifest_invalid' }
  }
  const seen = new Set<string>()
  let previous: string | null = null
  const entries: ManifestEntry[] = []
  for (const candidate of input.manifest) {
    if (candidate === null || typeof candidate !== 'object'
      || Object.keys(candidate).sort().join(',') !== 'relative_path,sha256,size') {
      return { ok: false, reason: 'manifest_invalid' }
    }
    if (!isSafeManifestRelativePath(candidate.relative_path)
      || seen.has(candidate.relative_path)
      || (previous !== null && comparePaths(previous, candidate.relative_path) >= 0)) {
      return { ok: false, reason: 'manifest_path_invalid' }
    }
    if (!SHA256_PATTERN.test(candidate.sha256)
      || !Number.isSafeInteger(candidate.size)
      || candidate.size < 0) {
      return { ok: false, reason: 'manifest_invalid' }
    }
    entries.push(candidate)
    seen.add(candidate.relative_path)
    previous = candidate.relative_path
  }
  if (directoryFingerprint({ entries }) !== input.fingerprint) {
    return { ok: false, reason: 'fingerprint_mismatch' }
  }

  const exclude = new Set(input.exclude ?? [])
  const listed = listRegularFiles({ directory: input.directory })
  if (!listed.ok) return { ok: false, reason: 'file_not_regular' }
  const actualFiles = listed.files.filter((file) => !exclude.has(file))
  const expectedFiles = entries.map((entry) => entry.relative_path).filter((file) => !exclude.has(file))
  if (actualFiles.length !== expectedFiles.length
    || actualFiles.some((file, index) => file !== expectedFiles[index])) {
    return { ok: false, reason: 'file_set_mismatch' }
  }

  const wanted = input.return_files ? new Set(input.return_files) : null
  const verified: Record<string, Buffer> = {}
  for (const entry of entries) {
    if (exclude.has(entry.relative_path)) continue
    const read = readStableRegularFile({
      directory: input.directory,
      relativePath: entry.relative_path,
    })
    if (!read.ok) {
      return { ok: false, reason: read.reason === 'not_regular' ? 'file_not_regular' : 'file_changed_during_read' }
    }
    if (read.bytes.byteLength !== entry.size) return { ok: false, reason: 'size_mismatch' }
    if (createHash('sha256').update(read.bytes).digest('hex') !== entry.sha256) {
      return { ok: false, reason: 'hash_mismatch' }
    }
    if (wanted === null || wanted.has(entry.relative_path)) {
      verified[entry.relative_path] = read.bytes
    }
  }
  return { ok: true, fingerprint: input.fingerprint, verified }
}

/**
 * Build a manifest for a directory as it currently stands (for the write
 * side): regular files only, no symlinks or hard links, sorted by path,
 * with `exclude` (the receipt file itself) left out.
 */
export function buildDirectoryManifest(input: {
  readonly directory: string
  readonly exclude?: readonly string[]
}): { ok: true; entries: ManifestEntry[]; fingerprint: string } | { ok: false; reason: 'file_not_regular' } {
  const exclude = new Set(input.exclude ?? [])
  const listed = listRegularFiles({ directory: input.directory })
  if (!listed.ok) return { ok: false, reason: 'file_not_regular' }
  const relativePaths = listed.files.filter((file) => !exclude.has(file))
  const entries: ManifestEntry[] = []
  for (const relativePath of relativePaths) {
    const read = readStableRegularFile({ directory: input.directory, relativePath })
    if (!read.ok) return { ok: false, reason: 'file_not_regular' }
    entries.push({
      relative_path: relativePath,
      size: read.bytes.byteLength,
      sha256: createHash('sha256').update(read.bytes).digest('hex'),
    })
  }
  return { ok: true, entries, fingerprint: directoryFingerprint({ entries }) }
}

function listRegularFiles(input: { directory: string }): { ok: true; files: string[] } | { ok: false; reason: 'file_not_regular' } {
  let realDirectory: string
  try {
    realDirectory = realpathSync(input.directory)
  } catch {
    return { ok: false, reason: 'file_not_regular' }
  }
  const files: string[] = []
  const fail = (): { ok: false; reason: 'file_not_regular' } => ({ ok: false, reason: 'file_not_regular' })
  const walk = (directory: string): { ok: true } | { ok: false; reason: 'file_not_regular' } => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return fail()
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(input.directory, absolutePath).split(path.sep).join('/')
      let metadata
      try {
        metadata = lstatSync(absolutePath)
      } catch {
        return fail()
      }
      // An irregular entry (symlink, hard link, device, …) ANYWHERE in the
      // tree fails the walk: a receipt must never silently coexist with a
      // repointable entry, manifest-listed or not.
      if (metadata.isSymbolicLink()) return fail()
      const expectedRealPath = path.resolve(realDirectory, ...relativePath.split('/'))
      try {
        if (realpathSync(absolutePath) !== expectedRealPath) return fail()
      } catch {
        return fail()
      }
      if (metadata.isDirectory()) {
        const descended = walk(absolutePath)
        if (!descended.ok) return descended
      } else if (metadata.isFile() && metadata.nlink === 1) {
        files.push(relativePath)
      } else {
        return fail()
      }
    }
    return { ok: true }
  }
  const walked = walk(input.directory)
  if (!walked.ok) return walked
  return { ok: true, files: files.sort(comparePaths) }
}
