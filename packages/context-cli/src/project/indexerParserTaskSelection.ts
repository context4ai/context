import { canonicalIndexerInventoryMembers, validateIndexerAuthorDependencyView } from "@c4a/context";
import type { IndexerParserSourceSelection } from "./indexerParserRuntimeIndex.js";

/** Translate the existing task authority to cache lookups; never expand source scope. */
export function indexerParserTaskSelection(input: {
  stage: "partition" | "author";
  source_ref: string;
  module_ref: string | null;
  validation: Record<string, unknown>;
}): IndexerParserSourceSelection {
  if (input.stage === "author") {
    const view = validateIndexerAuthorDependencyView(input.validation.dependency_view);
    return { paths: [...new Set(view.positive_nodes.flatMap((node) =>
      node.kind === "source-span" && node.source_ref === input.source_ref && node.module_ref === input.module_ref
        ? [node.locator.path]
        : []
    ))].sort() };
  }
  const members = canonicalIndexerInventoryMembers(
    input.validation.canonical_inventory_members as Parameters<typeof canonicalIndexerInventoryMembers>[0],
  );
  const projection = input.validation.partition_projection as {
    file_refs?: string[]; fact_items?: Array<{ fact_ref: string }>;
  } | undefined;
  return { member_refs: [...new Set([
    ...members.map((member) => member.member_id),
    ...(projection?.file_refs ?? []),
    ...(projection?.fact_items ?? []).map((item) => item.fact_ref),
  ])].sort() };
}
