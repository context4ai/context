import { readProductionRequirements } from "./productionRequirements.js";
import { readProductionStage } from "./productionStageStore.js";
import { readFile } from "node:fs/promises";
import { assertManagedDocumentPath, readSessionChanges, indexerProtocolDigest, type ArticleStructureEntry } from "@c4a/context";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";

/** Resolve current selected writing resources even for an explicit page revise
 * with no source-update request. No Parser or remote acquisition runs here. */
export async function approvedRevisionContext(root: string, target: { source_refs: string[]; markdown: string; sections: ArticleStructureEntry["sections"] }) {
  const registry = await readProductionRequirements(root);
  const requirements = registry.requirements.filter((requirement) => requirement.target_scope.targets.some((source) =>
    target.source_refs.some((ref) => ref === source.source_ref || ref.startsWith(`${source.source_ref}#`) || ref.startsWith(`${source.source_ref}/`))));
  // Planning guidance is useful within this run, not permanent production provenance.
  // A new run does not recover skills from the formal article.
  const stage = await readProductionStage(root);
  const indexerUsage = stage?.indexer_usage.filter(usage =>
    usage.scopes.some(scope => target.source_refs.includes(scope))) ?? [];
  const sources = await Promise.all([...new Set(target.source_refs.map((ref) => ref.split("#")[0]!))]
    .filter((ref) => /^(note|sessions):/u.test(ref)).map(async (source_ref) => {
      const separator = source_ref.indexOf(":");
      const type = source_ref.slice(0, separator) as "note" | "sessions";
      const name = source_ref.slice(separator + 1);
      const path = await assertManagedDocumentPath(root, type, name);
      const markdown = await readFile(path, "utf8");
      const changes = type === "sessions" ? readSessionChanges(markdown) : undefined;
      return { source_ref, path, digest: indexerProtocolDigest(markdown),
        ...(changes === undefined ? {} : { changes }) };
    }));
  return { requirements, indexer_usage: indexerUsage, sources,
    current_sections: approvedContextSectionsInMarkdown(target.markdown).map((section) => ({
      id: section.id, references: target.sections.find(item => item.id === section.id)?.references ?? [], markdown: section.readerVisibleBody,
    })) };
}
