# Changelog

## 0.3.0 (2026-10-09)

- Supersede chains: receipts are never overwritten — a correction is an additive `SupersedeRecord` embedding the superseded receipt's full identity (id + content hash) with a named reason and optional evidence hash, carrying the replacement identity. `verifySupersedeChain` accepts unordered, untrusted records plus optional known head identities and checks shape, single supersession per target, unforked replacements, dangling targets, and acyclic root-to-tail traversal; `latestOf` returns the chain tail (the currently-valid receipt). Chain order is hash-structural; `superseded_at` is provenance, never trusted for ordering. Extracted from the round05 canonical-rebound snapshot-seal supersession plus the source repo's `docs/receipts` `_R0`/`_R1` rework convention.
- Zero runtime dependencies; strict TypeScript; 92 tests.

## 0.2.0 (2026-10-09)

- Receipt protocol core: self-hashed envelopes with exact-key-set verification, directory fingerprints with byte-exact bidirectional re-verification, TOCTOU-hardened stable reads (no symlinks/hardlinks, identity checks around reads), append-only landing (O_EXCL + fsync + chmod 0400), single-parent lineage with before==after enforcement, three-state verdicts with denominator disclosure.
- Citation gate: decisive-reference integrity over delivery manifests (substantive-view requirement, alias inheritance) and sealed membership (status class, pre-cutoff availability, member version comparison); unique-only spelling corrections land as ADVISORY and never waive a FATAL.
- Directory walk fails fast on ANY irregular entry, manifest-listed or not (review R1 hardening).
- Zero runtime dependencies; strict TypeScript; 76 tests.
