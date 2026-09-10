import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { indexerProtocolDigest, projectIndexerPublicContractTable, materializeIndexerStructuredContent,
  type IndexerArtifactFact, type ProcessedScope } from "@c4a/context";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";
import { resolveProjectIndexerMainSourceBinding } from "./indexerMainSourceAdapter.js";

export interface RevisionProgramBlock { token: string; source_ref: string; fact_ref: string; markdown: string; declaration_status?: string | undefined }

/** Called by explicit update preparation, never by readonly status or an
 * expression-only revise. Reuse the same Parser source slice and renderer as
 * ordinary Indexer page templates; the Agent selects relevance and placement. */
export async function prepareRevisionProgramBlocks(root: string, sourceRefs: string[], scopes: ProcessedScope[]) {
  const { registry } = await loadIndexerRegistry(root);
  const blocks = new Map<string, RevisionProgramBlock>();
  for (const scope of scopes.filter((item) => item.source_ref.startsWith("repo:") && sourceRefs.some((ref) =>
    ref === item.source_ref || ref.startsWith(`${item.source_ref}#`) || ref.startsWith(`${item.source_ref}/`)))) {
    const indexers = registry.indexers.filter((indexer) => indexer.requirement_bindings.some((binding) =>
      binding.requirement_ref === scope.requirement_ref && binding.role === "primary"));
    for (const indexer of indexers) {
      const authority = await resolveCurrentProjectIndexerPrimaryAuthority({ projectRoot: root, registry, indexer_id: indexer.id });
      const requirement = registry.requirements.find((item) => item.id === scope.requirement_ref)!;
      const modules = scope.module_refs ?? requirement.target_scope.targets.filter((item) => item.source_ref === scope.source_ref).flatMap((item) => item.module_refs);
      // An empty module selection authorizes the source as a whole, as in the Parser lifecycle.
      for (const module of modules.length === 0 ? [null] : modules) {
        const binding = await resolveProjectIndexerMainSourceBinding({ projectRoot: root, indexer_id: indexer.id,
          source_ref: scope.source_ref, module_ref: module, profile_contract_digest: authority.profile_contract.contract_digest });
        if (binding.adapter !== "parser-facts") continue;
        for (const file of binding.parser_fact_view.files) {
          // Revision has no Partition subject. Keep each authorized file as its
          // local rendering scope; explicit Props links still decide support.
          const facts: IndexerArtifactFact[] = file.facts.map(item => ({
            fact_ref: item.fact_ref, fact_kind: item.kind,
            subject_key: { protocol: "context.subject-key/v1", namespace: indexer.id, kind: "file", local_key: item.locator.normalized_path },
            value: item.payload, evidence_refs: [scope.source_ref],
          }));
          for (const fact of facts) {
            const table = projectIndexerPublicContractTable(fact);
            if (!table) continue;
            const token = `{{context:program:${indexerProtocolDigest({ source: scope.source_ref, fact: fact.fact_ref }).slice(7)}}}`;
            const [rendered] = materializeIndexerStructuredContent({ facts, blocks: [{
              block_id: "api", layer: "deterministic-block", renderer: "public-contract-table", fact_refs: [fact.fact_ref],
            }] });
            blocks.set(token, { token, source_ref: scope.source_ref, fact_ref: fact.fact_ref, markdown: rendered!.markdown, declaration_status: table.declaration_status });
          }
        }
      }
    }
  }
  return [...blocks.values()];
}

export function expandRevisionProgramBlocks(markdown: string, blocks: RevisionProgramBlock[]): string {
  const byToken = new Map(blocks.map((block) => [block.token, block.markdown]));
  return markdown.replace(/\{\{context:program:[^}\n]+\}\}/gu, (token) => {
    const content = byToken.get(token);
    if (content === undefined) throw new TypeError("Revision references a program block outside its current source scope");
    return content;
  });
}
