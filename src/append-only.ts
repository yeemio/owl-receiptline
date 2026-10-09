import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

export type AppendOnlyWriteResult =
  | { ok: true; file: string }
  | { ok: false; reason: 'already_exists' }

/**
 * Land a receipt file exactly once, durably, and read-only:
 *
 * - `O_EXCL` create: a second write to the same path is rejected
 *   (idempotency by refusal, never by overwrite);
 * - write → fsync(file) → chmod 0o400 → fsync(directory): the content is
 *   durable, then locked against accidental edits, then the directory
 *   entry itself is durable;
 * - the file is created 0o600 and ends 0o400.
 */
export function writeAppendOnlyFile(input: {
  readonly file: string
  readonly bytes: string | Uint8Array
}): AppendOnlyWriteResult {
  const directory = path.dirname(input.file)
  mkdirSync(directory, { recursive: true })
  let descriptor: number
  try {
    descriptor = openSync(input.file, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, reason: 'already_exists' }
    }
    throw error
  }
  try {
    writeFileSync(descriptor, input.bytes)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  chmodSync(input.file, 0o400)
  syncDirectory(directory)
  return { ok: true, file: input.file }
}

export function writeAppendOnlyJson(input: {
  readonly file: string
  readonly value: unknown
}): AppendOnlyWriteResult {
  return writeAppendOnlyFile({ file: input.file, bytes: `${JSON.stringify(input.value, null, 2)}\n` })
}

function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
