import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from 'node:fs'
import path from 'node:path'

export type StableReadFailure =
  | 'not_regular'
  | 'changed_during_read'

export type StableReadResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: StableReadFailure }

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

/**
 * Read a file once, defensively, exactly as it exists on disk:
 *
 * - reject symlinks and hard links (nlink > 1) — a receipt must not be a
 *   pointer someone can repoint after hashing;
 * - resolve the parent directory's realpath once, so a swapped intermediate
 *   directory cannot redirect the read;
 * - open with O_NOFOLLOW and compare lstat/fstat identity (device, inode,
 *   size, mtimes) before AND after reading, so bytes swapped mid-read are
 *   caught (TOCTOU);
 * - never expose filesystem error internals; failures are stable reasons.
 */
export function readStableRegularFile(input: {
  readonly directory: string
  readonly relativePath: string
}): StableReadResult {
  const file = path.resolve(input.directory, ...input.relativePath.split('/'))
  if (!pathWithin(input.directory, file) || file === input.directory) {
    return { ok: false, reason: 'not_regular' }
  }
  let realDirectory: string
  try {
    realDirectory = realpathSync(input.directory)
  } catch {
    return { ok: false, reason: 'not_regular' }
  }
  let before: Stats
  try {
    before = lstatSync(file)
  } catch {
    return { ok: false, reason: 'not_regular' }
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    return { ok: false, reason: 'not_regular' }
  }
  const expectedRealPath = path.resolve(realDirectory, ...input.relativePath.split('/'))
  try {
    if (realpathSync(file) !== expectedRealPath) return { ok: false, reason: 'not_regular' }
  } catch {
    return { ok: false, reason: 'not_regular' }
  }
  let descriptor: number | null = null
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    const openedBefore = fstatSync(descriptor)
    if (!sameFileIdentity(before, openedBefore)) return { ok: false, reason: 'changed_during_read' }
    const bytes = readFileSync(descriptor)
    const openedAfter = fstatSync(descriptor)
    const after = lstatSync(file)
    if (
      !sameFileIdentity(openedBefore, openedAfter)
      || !sameFileIdentity(openedAfter, after)
      || realpathSync(file) !== expectedRealPath
    ) return { ok: false, reason: 'changed_during_read' }
    return { ok: true, bytes }
  } catch {
    return { ok: false, reason: 'changed_during_read' }
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

function pathWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}
