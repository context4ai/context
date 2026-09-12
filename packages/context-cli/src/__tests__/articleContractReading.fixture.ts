import { projectIndexerPublicContractTable, renderIndexerDeterministicFacts,
  type IndexerArtifactFact, type IndexerMainRunRequest } from "@c4a/context";
import { resolveProjectIndexerMainSourceBinding } from "../project/indexerMainSourceAdapter.js";

/** Model an Author explicitly requesting Parser help for a selected API file.
 * Only rendered prose is submitted; Parser records never become article fields. */
export async function readArticleContracts(projectRoot: string, request: IndexerMainRunRequest, path: string) {
  const source = await resolveProjectIndexerMainSourceBinding({ projectRoot,
    indexer_id: request.workset.indexer_id, source_ref: request.workset.source_ref,
    module_ref: request.workset.module_ref, profile_contract_digest: request.workset.profile_contract_digest,
    parser_selection: { paths: [path] },
  });
  if (source.adapter !== "parser-facts") throw new Error("API fixture needs a code source");
  const facts: IndexerArtifactFact[] = source.parser_fact_view.files.flatMap(file => file.facts.map(fact => ({
    fact_ref: fact.fact_ref, fact_kind: fact.kind, value: fact.payload, evidence_refs: [],
    subject_key: { protocol: "context.subject-key/v1" as const, namespace: "fixture", kind: "file", local_key: file.normalized_path },
  })));
  return (symbols: string[]): string => {
    const selected = facts.filter(fact => {
      const value = fact.value as { name?: string; qualifiedName?: string };
      return symbols.includes(value.name ?? value.qualifiedName ?? "") && projectIndexerPublicContractTable(fact) !== undefined;
    });
    if (!selected.length) throw new Error(`No declarations found for ${symbols.join(", ")}`);
    return renderIndexerDeterministicFacts({ renderer: "public-contract-table", facts: selected });
  };
}
