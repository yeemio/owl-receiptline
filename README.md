# owl-receiptline

**An auditable receipt protocol for AI decision pipelines.**

When an AI system makes decisions that matter, "trust me" is not an audit. owl-receiptline is the file-level protocol for making every step of a pipeline provable after the fact: what was computed, from which frozen inputs, whether the inputs moved while you worked, and — just as important — what could **not** be verified. It is a zero-dependency TypeScript library extracted from a system that survived dozens of adversarial acceptance rounds on exactly these properties (see PROVENANCE.md).

## The protocol in one breath

Every artifact directory ends with a **receipt**: a self-hashed JSON envelope carrying a manifest of `{relative_path, size, sha256}` for every file, the fingerprint of that manifest, and — if the run derived from a prior run — a single-parent lineage proving the source's fingerprint was identical before and after derivation. Verification re-reads the directory **byte for byte** with TOCTOU defenses, requires the manifest and the actual file set to match **in both directions**, and refuses anything that changed, appeared, disappeared, or is a symlink or hard link.

## Modules

### `envelope` — self-hashed receipts

`makeEnvelope` wraps `artifact_version + payload` into an envelope whose `hash` is the canonical-JSON SHA-256 of everything else. `verifyEnvelope` re-derives the hash and requires the **exact key set**: one extra field fails, so nobody can smuggle data past the hash, and a receipt written by schema v2 can never pass as v1.

### `directory` — fingerprints and byte-exact re-verification

`buildDirectoryManifest` / `directoryFingerprint` turn a directory into a sorted, hashed manifest (excluding the receipt itself — a receipt must not hash itself). `verifyDirectory` checks manifest shape (safe, sorted, unique paths), recomputes the fingerprint, requires manifest ↔ disk equality in **both** directions, then re-reads every file defensively and matches size + SHA-256. Failures are stable machine-readable reasons (`hash_mismatch`, `file_set_mismatch`, `fingerprint_mismatch`, …), never filesystem internals.

### `stable-read` — reads that cannot be lied to

`readStableRegularFile` rejects symlinks and hard links, opens with `O_NOFOLLOW`, and compares file identity (device, inode, size, mtimes) before and after reading — bytes swapped mid-read are caught, and a receipt can never be a pointer someone repoints after hashing.

### `append-only` — land once, then read-only

`writeAppendOnlyJson` creates with `O_EXCL` (a second write is **refused**, never overwritten), fsyncs the file, chmods to 0o400, and fsyncs the directory. Idempotency by refusal.

### `lineage` — single-parent provenance

`rootLineage` / `derivedLineage`: a derived run names exactly one source and carries the source's fingerprint **before and after** — construction throws if they differ, proving the source was frozen during derivation. No merge semantics, no long chains: one parent, proven unchanged.

### `verdict` — honest three-state results and disclosure

`Verdict = FAIL | PARTIAL_NOT_EVALUABLE | PASS`; `combineVerdicts` lets the worst truth win. "All evidence was filtered out" is **not** PASS and **not** FAIL. `Disclosure` carries the names of undatable/unreadable items, and `denominator_known: false` caps every completeness claim — "37 of 40 checks passed" only means something when the 40 is known to be real.

### `citation` — did the decision actually see what it cites?

`assessCitations` checks every decisive reference against two receipt artifacts: the **delivery manifest** (D — was the cited body handed to the model in a substantive view: FULL/EXCERPT/PROJECTION, or via an alias to a FULL slice with the same body hash?) and the **sealed membership sidecar** (S — is the cited id sealed, status-sufficient, and available before the cutoff?; discussion may name conflicted members, support may not). Core identity facts fold in tri-state: false is FATAL, unknown is NOT_EVALUABLE. A null manifest or sidecar is the legacy sentinel — NOT_EVALUABLE, never FAIL and never a vacuous PASS; zero refs with an incomplete host extraction stays NOT_EVALUABLE; an unresolvable decisive citation is named, not dropped. The only spelling correction allowed is a unique near-id candidate (case/`_`/`-` normalized) that is uniquely versioned in D and support-admitted in S — recorded as ADVISORY, never waiving a FATAL. Domain policy (which kinds check delivery, support vs. display statuses) is injected via `refPolicy` and status sets.

## Quick look

```ts
import {
  buildDirectoryManifest, makeEnvelope, verifyEnvelope,
  writeAppendOnlyJson, rootLineage,
} from 'owl-receiptline'

// 1. Compute your artifacts into some directory ...
// 2. Build the manifest (the receipt file itself is excluded):
const manifest = buildDirectoryManifest({ directory: runDir, exclude: ['receipt.json'] })
if (!manifest.ok) throw new Error('artifacts not landable')

// 3. Write the receipt exactly once:
writeAppendOnlyJson({
  file: `${runDir}/receipt.json`,
  value: makeEnvelope({
    artifact_version: 'my-run-receipt.v1',
    payload: {
      fingerprint: manifest.fingerprint,
      output_files: manifest.entries,
      lineage: rootLineage(),
    },
  }),
})

// Later, from an untrusted copy of the whole directory:
const raw = JSON.parse(readReceiptBytes.toString('utf8'))
const verified = verifyEnvelope<{ fingerprint: string; output_files: unknown[] }>({
  value: raw, expected_artifact_version: 'my-run-receipt.v1',
})
```

## Design boundaries

- Pure protocol, zero runtime dependencies, no database. Files on disk are the ledger.
- Failures return stable reason codes; filesystem internals are never exposed.
- Research/audit tooling for decision pipelines; carries no opinion about what your pipeline decides.

## License

MIT — see [LICENSE](./LICENSE). Source-system provenance and deliberate differences are documented in [PROVENANCE.md](./PROVENANCE.md).
