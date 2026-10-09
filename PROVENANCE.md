# PROVENANCE

owl-receiptline is a whitelist extraction from OwlFootball, a production AI decision pipeline whose acceptance process leaned on exactly these receipt properties. The source repository stays untouched; this library generalizes its receipt machinery.

## Source mapping

| owl-receiptline module | OwlFootball source (paths relative to `server/`) |
|---|---|
| `src/canonical-json.ts` | `merm-v0/canonical-json.ts` (shared with owl-failgate; both copies stay in sync semantically — see "Deliberate generalizations" in each) |
| `src/envelope.ts` | Exact-key-set validation + self-hash pattern from `run-fingerprint-receipt-v1.ts` (`hasExactKeys`, `REQUIRED_TOP_LEVEL_KEYS`, L18–29/L77–81/L235–270) and `analysis-execution-boundary-receipt-verifier-v1.ts` (canonicalJson hashing, L73–91) |
| `src/stable-read.ts` | `run-fingerprint-receipt-v1.ts` `stableRegularFileBytes` (L97–141): lstat → O_NOFOLLOW → fstat identity compare before/after → realpath; symlink/hardlink rejection |
| `src/directory.ts` | `run-fingerprint-receipt-v1.ts` manifest verification (L263–334): sorted unique safe paths, sha256/size checks, bidirectional file-set equality, per-file byte re-hash; directory fingerprint from `run-protocol-trace-v1.ts` `fingerprintRunDirectoryV1` (L17–38); "receipt excluded from its own manifest" (L147) |
| `src/append-only.ts` | `historical-blind-replay-v1.ts` `writeJsonCreateOnly` (L821–842): open 'wx' 0o600 → write → fsync → chmod 0o400 → fsync(directory), EEXIST → named conflict error |
| `src/lineage.ts` | `run-fingerprint-receipt-v1.ts` lineage validation (L243–261): null-or-present single-parent lineage, before==after enforced, `source_run_unchanged: true` |
| `src/verdict.ts` | Three-state verdict ordering from `ownerpick/citation-verdict-v1.ts` (FAIL > PARTIAL_NOT_EVALUABLE > PASS, L134–139; empty-filtered ≠ PASS, L287–299); undatable/denominator disclosure from `merm-insight/four-column-routes-v1.ts` (L1000–1034, undatable roots named and disclosed, never silently dropped) and `model-route-ops/projection-v1.ts` (`undatable_run_dirs` + `denominator_known: false` capping) |

Extraction date: 2026-10-09.

## Deliberate generalizations (differences from source)

1. **No domain envelope shape.** The source hardcodes `run-fingerprint-receipt.v1` with `match_id`/`stamp` and enforces the `runs/<match_id>/<stamp>` path layout. owl-receiptline takes any directory and makes `artifact_version`/payload caller-defined.
2. **Canonical JSON key ordering uses UTF-16 code-unit comparison** instead of `localeCompare` (ICU-independence, same change as owl-failgate).
3. **Failures are structured reasons everywhere** (`{ ok: false, reason }`), where the source throws sentinel errors caught at one boundary.
4. **Envelope hash field is configurable** (`hash` default); the source hardcodes field names per receipt type.
5. **Directory fingerprint hashes the sorted manifest array via canonicalJson** rather than `JSON.stringify` of pre-normalized objects, making the fingerprint insensitive to key order in the input entries.

## Not extracted (source-system concerns)

Blind-replay forbidden-keyword scanning, kickoff/betting authority flags, delivery manifests and sealed-membership sidecars (citation gate K1 D/S sides), the `runs/<match>/<stamp]>` layout, endpoint registries, and the Chinese-domain leak word lists. The citation-gate K0–K3 framework itself is a future candidate for its own module once this core stabilizes.

## License

All extracted logic was authored for OwlFootball by its owner, who relicenses this generalization under MIT (see LICENSE).
