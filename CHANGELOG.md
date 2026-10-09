# Changelog

## 0.2.0 (2026-10-09)

- Receipt protocol core: self-hashed envelopes with exact-key-set verification, directory fingerprints with byte-exact bidirectional re-verification, TOCTOU-hardened stable reads (no symlinks/hardlinks, identity checks around reads), append-only landing (O_EXCL + fsync + chmod 0400), single-parent lineage with before==after enforcement, three-state verdicts with denominator disclosure.
- Citation gate: decisive-reference integrity over delivery manifests (substantive-view requirement, alias inheritance) and sealed membership (status class, pre-cutoff availability, member version comparison); unique-only spelling corrections land as ADVISORY and never waive a FATAL.
- Directory walk fails fast on ANY irregular entry, manifest-listed or not (review R1 hardening).
- Zero runtime dependencies; strict TypeScript; 76 tests.
