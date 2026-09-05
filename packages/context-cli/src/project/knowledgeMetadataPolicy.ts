const RUNTIME_ONLY_FIELDS = new Set([
  "candidate_fingerprint",
  "context_optimization",
  "context_overlay",
  "context_revision",
  "indexer_artifact_ref",
  "indexer_compile_digest",
  "indexer_file_digest",
  "indexer_section_refs",
  "indexer_source_ref",
  "structure_digest",
]);

/** Runtime recovery and audit identities never belong in reader-facing knowledge. */
export function isRuntimeOnlyKnowledgeMetadataField(field: string): boolean {
  const normalized = field.trim().toLocaleLowerCase("en-US");
  return RUNTIME_ONLY_FIELDS.has(normalized) ||
    normalized === "digest" ||
    normalized.endsWith("_digest") ||
    /(?:^|_)batch(?:_|$)/u.test(normalized) ||
    /(?:^|_)benchmark(?:_|$)/u.test(normalized) ||
    /(?:^|_)evidence_?bindings?(?:_|$)/u.test(normalized);
}
