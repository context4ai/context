import { renderIndexerDeterministicFacts, type IndexerArtifactFact } from "@c4a/context";

/** All template, structured Candidate and revision paths share the SDK renderer. */
export function renderPublicContractFacts(facts: readonly IndexerArtifactFact[]): string {
  return renderIndexerDeterministicFacts({ renderer: "public-contract-table", facts });
}
