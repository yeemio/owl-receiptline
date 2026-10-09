// Land artifacts once, write a receipt, then verify the directory later,
// byte for byte — including a tamper check.
//
// Run: npm install && npm run build && node examples/write-and-verify.mjs

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildDirectoryManifest,
  makeEnvelope,
  readStableRegularFile,
  verifyDirectory,
  verifyEnvelope,
  writeAppendOnlyJson,
} from '../dist/index.js'

const runDir = path.join(tmpdir(), `receiptline-example-${Date.now()}`)
mkdirSync(path.join(runDir, 'nested'), { recursive: true })
writeFileSync(path.join(runDir, 'decision.json'), '{"pick":"away","confidence":0.61}')
writeFileSync(path.join(runDir, 'nested', 'evidence.txt'), 'line 1\nline 2\n')

// 1. Build the manifest (the receipt file itself is excluded — a receipt
//    never hashes itself) and land the receipt exactly once.
const manifest = buildDirectoryManifest({ directory: runDir, exclude: ['receipt.json'] })
if (!manifest.ok) throw new Error(`manifest failed: ${manifest.reason}`)
writeAppendOnlyJson({
  file: path.join(runDir, 'receipt.json'),
  value: makeEnvelope({
    artifact_version: 'example-run-receipt.v1',
    payload: { fingerprint: manifest.fingerprint, output_files: manifest.entries },
  }),
})
console.log('receipt written. fingerprint =', manifest.fingerprint.slice(0, 16), '…')

// 2. Verify later, from an untrusted copy of the whole directory.
const receiptBytes = readStableRegularFile({ directory: runDir, relativePath: 'receipt.json' })
if (!receiptBytes.ok) throw new Error('receipt read failed')
const envelope = verifyEnvelope({
  value: JSON.parse(receiptBytes.bytes.toString('utf8')),
  expected_artifact_version: 'example-run-receipt.v1',
})
if (!envelope.ok) throw new Error(`envelope failed: ${envelope.reason}`)
const verification = verifyDirectory({
  directory: runDir,
  manifest: manifest.entries,
  fingerprint: envelope.payload.fingerprint,
  exclude: ['receipt.json'],
})
console.log('clean verify:', verification.ok)

// 3. Tamper with one byte; verification must fail with hash_mismatch.
writeFileSync(path.join(runDir, 'decision.json'), '{"pick":"home","confidence":0.61}')
const tampered = verifyDirectory({
  directory: runDir,
  manifest: manifest.entries,
  fingerprint: envelope.payload.fingerprint,
  exclude: ['receipt.json'],
})
console.log('tampered verify:', tampered.ok ? 'UNEXPECTED PASS' : tampered.reason)

rmSync(runDir, { recursive: true, force: true })
