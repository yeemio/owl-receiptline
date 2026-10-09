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
| `src/citation.ts` | Generalization of `ownerpick/citation-verdict-v1.ts` (core-fact tri-state L141–157; decisive-ref assessment incl. malformed/unresolvable handling L266–380; unique-only id correction discipline L211–264), `ownerpick/delivery-manifest-v1.ts` `ownerPickDeliverySupportsFactV1` (L352–391: content-authority views, catalog-header/identifier-only refusal, duplicate alias inheritance), and `ownerpick/sealed-membership-v1.ts` `membershipGate`/`memberSupportsUncontestedFactsV1`/`memberDisplayableInFrameV1` (L195–244: named exclusions, status discipline, after-cutoff refusal) |
| `src/supersede.ts` | Explicit supersession from `round05-sealed-replay-snapshot-seals-v1.ts` `Round05CanonicalReboundSnapshotBindingV1`: the canonical rebound is an additive record that embeds the complete superseded snapshot seal (`supersedes_snapshot_seal`, L20/L76–80), carries a named `reason_code` (L18) and its own new seal (L81–85), and leaves the original binding array byte-identical (L23–64); the resolver prefers the rebound for the identity slot (L100–103). Reinforced by the source repo's `docs/receipts` rework convention (a correction lands as a new `_R0`/`_R1` predecessor image — e.g. `clock-resilience-20260915` `MANIFEST_R0/R1`, `DELIVERY_R0/R1` — never as an edit of the original file) |

Extraction date: 2026-10-09.

## Deliberate generalizations (differences from source)

1. **No domain envelope shape.** The source hardcodes `run-fingerprint-receipt.v1` with `match_id`/`stamp` and enforces the `runs/<match_id>/<stamp>` path layout. owl-receiptline takes any directory and makes `artifact_version`/payload caller-defined.
2. **Canonical JSON key ordering uses UTF-16 code-unit comparison** instead of `localeCompare` (ICU-independence, same change as owl-failgate).
3. **Failures are structured reasons everywhere** (`{ ok: false, reason }`), where the source throws sentinel errors caught at one boundary.
4. **Envelope hash field is configurable** (`hash` default); the source hardcodes field names per receipt type.
5. **Directory fingerprint hashes the sorted manifest array via canonicalJson** rather than `JSON.stringify` of pre-normalized objects, making the fingerprint insensitive to key order in the input entries.
6. **Citation gate policy is injected, not hardcoded.** The source bakes in the `obs-`/`ev-` namespaces, fixed ref kinds, the known `asian-handicap`→`asian_handicap` correction token, the ADMITTED/CONFLICTED status vocabulary, and named K0 core-fact fields. owl-receiptline takes `refPolicy(kind, purpose)` and support/display status sets as config, treats core facts as an opaque list, and generalizes the spelling correction to any case/`_`/`-` near-id slip under the same unique-only discipline (exactly one normalized candidate, exactly one D version, exactly one support-admitted S member); the source's namespace checks and correction word list are deliberately not extracted. The library also consumes `DeliveryManifestLike`/`MembershipSidecarLike` shapes — it does not build delivery manifests or sealed sidecars (the source builders `collectOwnerPickRequestDeliveryV1`/`sealOwnerPickMembershipV1` and their content hashing stay in the source system). Two shape simplifications remain: sealed members are keyed by bare `id` (the source namespaces by `(kind, id)` — hosts wanting namespaces can encode them into ids), and an alias twin needs content authority with body-hash equality enforced only when both sides declare hashes.
7. **Supersession is structural, not domain-bound.** The source binds supersession to a domain slot (`match_id`/`source_run_ref`/`source_run_fingerprint`) with a fixed authority vocabulary, a named domain reason code, a repair-plan hash, and a hardcoded resolver that prefers the rebound. owl-receiptline takes opaque `{id, hash}` identities, a caller-supplied reason, and an optional evidence hash, and verifies the record set structurally: single supersession per superseded identity (the source resolver's single-binding-per-slot lookup implies a unique current binding), no forked replacements, dangling targets detected against caller-declared known heads, and acyclic root-to-tail traversal in any input order. Chain linkage is hash-structural only — `superseded_at` is recorded provenance and is never used for ordering (the source has no timestamps at all). The unchanged-bytes property is preserved by construction: the API only adds records; there is no mutation path, mirroring the source's untouched original binding array.

## Not extracted (source-system concerns)

Blind-replay forbidden-keyword scanning, kickoff/betting authority flags, the `runs/<match>/<stamp>>` layout, endpoint registries, and the Chinese-domain leak word lists.

## License

All extracted logic was authored for OwlFootball by its owner, who relicenses this generalization under MIT (see LICENSE).
