export {
  canonicalize,
  canonicalJson,
  sha256,
  hashCanonical,
} from './canonical-json.js'
export {
  makeEnvelope,
  verifyEnvelope,
  SHA256_PATTERN,
  type SelfHashedEnvelope,
  type EnvelopeOptions,
  type EnvelopeVerification,
} from './envelope.js'
export {
  readStableRegularFile,
  type StableReadResult,
  type StableReadFailure,
} from './stable-read.js'
export {
  writeAppendOnlyFile,
  writeAppendOnlyJson,
  type AppendOnlyWriteResult,
} from './append-only.js'
export {
  directoryFingerprint,
  buildDirectoryManifest,
  verifyDirectory,
  isSafeManifestRelativePath,
  type ManifestEntry,
  type DirectoryVerification,
} from './directory.js'
export {
  rootLineage,
  derivedLineage,
  verifyLineage,
  type SingleParentLineage,
} from './lineage.js'
export {
  combineVerdicts,
  fullDisclosure,
  disclosureWith,
  mayClaimCompleteness,
  type Verdict,
  type Disclosure,
} from './verdict.js'
export {
  assessCitations,
  worstGateState,
  findUniqueCorrection,
  type GateState,
  type CitationShape,
  type CitationRef,
  type RefCheckPolicy,
  type GateFieldResult,
  type DeliverySlice,
  type DeliveryManifestLike,
  type SealedMember,
  type MembershipSidecarLike,
  type CoreFactCheck,
  type CitationGateConfig,
  type CitationAssessment,
} from './citation.js'
