import { SourceReadError } from "./gitObjectReader.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { createArticleReferenceObserver } from "./articleReferenceObservation.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
import { repoContentImpactReader } from "./repoContentEvidence.js";
import { pendingSourceUpdateScopes, type PendingSourceScope } from "./pendingSourceUpdates.js";

/** Read only cited captured files, once per verification. No parser invocation,
 * article dependency graph, or mutation of approved references. Changed regions
 * are revision hints, not a claim that every source change is covered. */
export async function approvedKnowledgeDependencyWarnings(
  projectRoot: string, structureOverride?: Record<string, unknown>,
): Promise<ProjectVerifyIssue[]> {
  const articles = approvedKnowledgeSnapshotsFromStructure(
    structureOverride ?? (await readKnowledgeStructure(projectRoot)).parsed,
  );
  if (!articles.some(article => article.sections.some(section => section.references.length))) return [];
  const read = await registeredArticleSourceReader(projectRoot);
  const observe = createArticleReferenceObserver(read);
  const issues: ProjectVerifyIssue[] = [];
  let repoImpact: ReturnType<typeof repoContentImpactReader> | undefined;
  let pending: Promise<PendingSourceScope[]> | undefined;
  for (const article of articles) {
    const changed: string[] = [];
    const moved: string[] = [];
    const referenceStates: NonNullable<ProjectVerifyIssue["reference_states"]> = [];
    for (const section of article.sections) {
      for (const reference of section.references) {
        try {
          if (reference.source_ref.startsWith("repo-content:")) {
            repoImpact ??= repoContentImpactReader(projectRoot);
            const impact = await (await repoImpact)(reference);
            if (impact.state === "unchanged") continue;
            if (impact.state === "moved") {
              moved.push(`${section.id}: ${reference.source_ref}/${impact.current_path ?? reference.locator.path}`);
              continue;
            }
            changed.push(section.id);
            break;
          }
          const result = await observe(reference);
          if (result.state === "current") continue;
          if (result.state === "moved") {
            const locator = result.reference.locator;
            moved.push(`${section.id}: ${reference.source_ref}/${locator.path} L${locator.start_line}–L${locator.end_line}`);
            continue;
          }
          referenceStates.push({ section_id: section.id, state: result.state, ...(result.reason ? { reason: result.reason } : {}) });
          changed.push(section.id);
          break;
        } catch (error) {
          if (!(error instanceof SourceReadError)) throw error;
          issues.push({ severity: "warning", code: "source-read-failed", path: article.path,
            source_keys: [reference.source_ref],
            message: `${reference.source_ref}/${reference.locator.path}: ${error.message} No citation state was determined. Run context source recovery-plan --format json, then retry verification.` });
        }
      }
    }
    if (!changed.length && !moved.length) continue;
    // A moved registration is processed by the update, not by revising pages one at a time.
    pending ??= pendingSourceUpdateScopes(projectRoot).catch(() => []);
    const update = (await pending).some(scope => article.sections.some(section => section.references.some(reference =>
      reference.source_ref === scope.source_ref || reference.source_ref.startsWith(`${scope.source_ref}/`) || reference.source_ref.startsWith(`${scope.source_ref}#`))))
      ? " A cited repository moved past its processed commit; run context update --pending --format json first." : "";
    if (changed.length) issues.push({
      severity: "warning", code: "approved-source-region-changed", path: article.path,
      ...(referenceStates.length ? { reference_states: referenceStates } : {}),
      message: `Source regions changed or are unavailable for fragments: ${changed.join(", ")}.${update || " Inspect current sources and revise this article;"} Verification does not rewrite approved references.`,
    });
    if (moved.length) issues.push({
      severity: "warning", code: "approved-source-region-moved", path: article.path,
      message: `Cited regions are unchanged but their location or surrounding source changed: ${moved.join("; ")}.${update || " Check locators during the source update;"} Do not rewrite unaffected prose.`,
    });
  }
  return issues;
}
