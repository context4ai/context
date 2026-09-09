/** The semantic Author surface emits one primary artifact per page. */
export interface PrimaryArtifactIntent {
  source_role: string;
  document_kind: string;
  reader_goal: string;
  artifact_kind: string;
}
export interface PrimaryArtifactPolicy {
  id: string;
  required_artifact_kinds: readonly string[];
  discretionary_artifact_kinds: readonly string[];
}
export const primaryIntentKey = (intent: PrimaryArtifactIntent): string =>
  [intent.source_role, intent.document_kind, intent.reader_goal, intent.artifact_kind].join("/");

export function supportsPrimaryArtifact(kind: string, policy: PrimaryArtifactPolicy): boolean {
  return policy.required_artifact_kinds.every(required => required === kind) &&
    [...policy.required_artifact_kinds, ...policy.discretionary_artifact_kinds].includes(kind);
}

export function resolvePrimaryArtifactIntent(
  intent: PrimaryArtifactIntent,
  choices: readonly PrimaryArtifactIntent[],
  policy: PrimaryArtifactPolicy,
): PrimaryArtifactIntent {
  if (supportsPrimaryArtifact(intent.artifact_kind, policy)) return intent;
  const replacements = choices.filter(candidate => candidate.source_role === intent.source_role &&
    candidate.document_kind === intent.document_kind && candidate.reader_goal === intent.reader_goal &&
    supportsPrimaryArtifact(candidate.artifact_kind, policy));
  const unique = [...new Map(replacements.map(candidate => [primaryIntentKey(candidate), candidate])).values()];
  if (unique.length === 1) return unique[0]!;
  throw new TypeError(`primary-artifact-policy-mismatch: ${primaryIntentKey(intent)} cannot satisfy policy ${policy.id}. ` +
    `Required kinds: ${policy.required_artifact_kinds.join(", ") || "none"}. ` +
    "Select an eligible policy that supports this single-page intent; if none exists, correct the Provider policy through Context configuration before retrying this unaccepted task. Do not reset the workspace or resubmit accepted peers.");
}

/** A non-publishing result has no Bundle and therefore no policy choice to make.
 * The eligibility report has already established at least one valid variant. */
export function selectAuthorPolicy<T extends { id: string }>(variants: readonly T[], requested: string | undefined, publishes: boolean): T {
  const selected = !publishes ? variants[0] : requested === undefined
    ? variants.length === 1 ? variants[0] : undefined
    : variants.find(variant => variant.id === requested);
  if (selected === undefined) throw new TypeError("author output must choose one eligible policy");
  return selected;
}
