import type { IndexerComposerDeclaration, IndexerPrimaryResultView } from "@c4a/context";
import type { CurrentIndexerComposerContext } from "./indexerCurrentComposer.js";
import { startIndexerPostAuthorRunStore, acceptIndexerPostAuthorRunStore } from "./indexerPostAuthorRunStore.js";
import { buildIndexerPostAuthorResultFromSemantic } from "./indexerSemanticPostAuthorResult.js";

export function missingComposerInputs(composer: IndexerComposerDeclaration, view: IndexerPrimaryResultView): string[] {
  const required = composer.contract?.primary_requirements;
  if (!required) return [];
  const facts = new Set(view.facts.filter((fact) => fact.evidence_refs.length > 0).map((fact) => fact.fact_kind));
  const artifacts = new Set(view.artifacts.filter((artifact) => artifact.evidence_refs.length > 0).map((artifact) => artifact.artifact_kind));
  return [
    ...required.fact_kinds.filter((kind) => !facts.has(kind)).map((kind) => `fact:${kind}`),
    ...required.artifact_kinds.filter((kind) => !artifacts.has(kind)).map((kind) => `artifact:${kind}`),
  ];
}

/** Satisfy the declared empty-result contract through the ordinary receipt path. */
export async function settleInapplicableComposer(projectRoot: string, context: CurrentIndexerComposerContext) {
  const contract = context.composer.contract!;
  const started = context.ledger.entries.some((entry) => entry.composer_ref === context.request.composer_ref && entry.state === "running")
    ? { request: context.request, ledger: context.ledger }
    : await startIndexerPostAuthorRunStore({ projectRoot, plan: context.plan, ledger: context.ledger, composer_ref: context.request.composer_ref });
  const result = buildIndexerPostAuthorResultFromSemantic({
    request: started.request, primary_artifact_result: context.record.artifact_result,
    semantic: { stage: "post-author", outcome: "complete", proposals: [], diagnostics: [] },
    allowed_artifact_kinds: contract.derived_artifact_policy.artifact_kinds,
    artifact_policy_variant: contract.derived_artifact_policy.artifact_policy_variant,
  });
  return acceptIndexerPostAuthorRunStore({ projectRoot, plan: context.plan, ledger: started.ledger,
    composer_ref: context.request.composer_ref, result, validator_contract_digest: context.validator_contract_digest });
}
