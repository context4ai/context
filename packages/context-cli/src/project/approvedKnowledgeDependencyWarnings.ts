import type { ArticleSourceReference } from "@c4a/context";
import { SourceReadError } from "./gitObjectReader.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { createArticleReferenceObserver, LOCAL_SOURCE_REASONS } from "./articleReferenceObservation.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
import { repoContentImpactReader } from "./repoContentEvidence.js";
import { pendingSourceUpdateScopes, type PendingSourceScope } from "./pendingSourceUpdates.js";

type ReferenceState = NonNullable<ProjectVerifyIssue["reference_states"]>[number];
type Citation = { kind: "current" } | { kind: "moved"; text: string } | { kind: "changed"; text: string; state?: ReferenceState }
  | { kind: "unchecked"; reason: string };

/** One citation: unchanged, moved, changed (a fact about the source), or unchecked
 * because this machine lacks the checkout, a download or a commit. */
async function classifyCitation(sectionId: string, reference: ArticleSourceReference,
  observe: ReturnType<typeof createArticleReferenceObserver>, repoImpact: ReturnType<typeof repoContentImpactReader> | undefined): Promise<Citation> {
  const where = `${sectionId}: ${reference.source_ref}/${reference.locator.path}`;
  try {
    if (reference.source_ref.startsWith("repo-content:")) {
      const impact = await (await repoImpact!)(reference);
      if (impact.state === "unchanged") return { kind: "current" };
      if (impact.state === "moved") return { kind: "moved", text: `${sectionId}: ${reference.source_ref}/${impact.current_path ?? reference.locator.path}` };
      return { kind: "changed", text: `${where} (changed)` };
    }
    const result = await observe(reference);
    if (result.state === "current") return { kind: "current" };
    if (result.state === "moved") {
      const locator = result.reference.locator;
      return { kind: "moved", text: `${sectionId}: ${reference.source_ref}/${locator.path} L${locator.start_line}–L${locator.end_line}` };
    }
    // A download or commit missing on this machine is not a citation change.
    if (result.state === "unavailable" && (result.reason ?? "") in LOCAL_SOURCE_REASONS) {
      return { kind: "unchecked", reason: `${LOCAL_SOURCE_REASONS[result.reason!]} (${reference.source_ref}, ${result.reason})` };
    }
    return { kind: "changed", state: { section_id: sectionId, state: result.state, ...(result.reason ? { reason: result.reason } : {}) },
      text: `${where} L${reference.locator.start_line}–L${reference.locator.end_line} (${result.state}${result.reason ? `, ${result.reason}` : ""})` };
  } catch (error) {
    if (!(error instanceof SourceReadError)) throw error;
    return { kind: "unchecked", reason: error.message };
  }
}

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
  // One warning per unreadable source; changed and moved citations stay listed per page.
  const unreadable = new Map<string, { pages: string[]; citations: number; reason: string }>();
  for (const article of articles) {
    const changed: string[] = [];
    const moved: string[] = [];
    const referenceStates: NonNullable<ProjectVerifyIssue["reference_states"]> = [];
    for (const section of article.sections) {
      for (const reference of section.references) {
        if (reference.source_ref.startsWith("repo-content:")) repoImpact ??= repoContentImpactReader(projectRoot);
        const citation = await classifyCitation(section.id, reference, observe, repoImpact);
        if (citation.kind === "moved") moved.push(citation.text);
        else if (citation.kind === "changed") {
          changed.push(citation.text);
          if (citation.state) referenceStates.push(citation.state);
        } else if (citation.kind === "unchecked") {
          const entry = unreadable.get(reference.source_ref) ?? { pages: [], citations: 0, reason: citation.reason };
          entry.citations++;
          if (!entry.pages.includes(article.path)) entry.pages.push(article.path);
          unreadable.set(reference.source_ref, entry);
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
      message: `Cited source regions changed or are unavailable: ${changed.join("; ")}.${update || " Inspect current sources and revise this article;"} Verification does not rewrite approved references.`,
    });
    if (moved.length) issues.push({
      severity: "warning", code: "approved-source-region-moved", path: article.path,
      message: `Cited regions are unchanged but their location or surrounding source changed: ${moved.join("; ")}.${update || " Check locators during the source update;"} Do not rewrite unaffected prose.`,
    });
  }
  for (const [source, entry] of unreadable) {
    const shown = entry.pages.slice(0, 5).join(", ") + (entry.pages.length > 5 ? `, and ${entry.pages.length - 5} more` : "");
    issues.push({ severity: "warning", code: "source-read-failed", path: entry.pages[0]!, source_keys: [source],
      message: `${entry.reason} ${entry.citations} citation(s) in ${entry.pages.length} page(s) were not checked (${shown}). ` +
        "This is not a citation change. Restore a missing checkout with context source recovery-plan --format json; " +
        "context update --pending downloads missing commits and contents. Then retry verification." });
  }
  return issues;
}
