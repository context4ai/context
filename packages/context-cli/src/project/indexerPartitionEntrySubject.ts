import type { IndexerAuthorizedWorksetView, IndexerSubjectKey } from "@c4a/context";
import { isExplicitDeprecatedPath } from "./indexerObsoleteScope.js";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Short subject choices inherit the default namespace. Qualify explicitly
 * deprecated entries so a same-name current entry cannot silently absorb them
 * during convergence. Explicit SubjectKeys remain the Agent's semantic choice
 * (for example, a deliberate cross-entry migration/comparison page).
 */
export function qualifyIndexerPartitionEntrySubject(input: {
  subject: IndexerSubjectKey;
  explicit_subject: boolean;
  members: readonly string[];
  view: IndexerAuthorizedWorksetView;
}): IndexerSubjectKey {
  if (input.explicit_subject || input.members.length === 0) return input.subject;
  const paths = new Map<string, string>();
  for (const item of input.view.items) {
    const value = record(item.value);
    const path = record(value.locator).normalized_path ?? value.normalized_path;
    if (typeof path !== "string") continue;
    paths.set(item.ref, path);
    if (typeof value.fact_ref === "string") paths.set(value.fact_ref, path);
    if (typeof value.file_ref === "string") paths.set(value.file_ref, path);
  }
  if (!input.members.every((member) => {
    const path = paths.get(member);
    return path !== undefined && isExplicitDeprecatedPath(path);
  }) || /^deprecated(?:[-/]|$)/u.test(input.subject.local_key)) return input.subject;
  return { ...input.subject, local_key: `deprecated-${input.subject.local_key}` };
}
