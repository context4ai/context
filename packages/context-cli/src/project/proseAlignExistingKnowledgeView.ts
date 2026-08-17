import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  alignEvidenceViewCommand,
  pageSlice,
  pageWithNextCommand,
} from "./proseAlignBudget.js";
import {
  readExistingKnowledgeCatalog,
  type ExistingKnowledgeNode,
} from "./proseAlignExistingApprovedStructure.js";
import {
  alignCommand,
  commonEnvelope,
  type AlignSourceContext,
  type AlignViewResult,
  type ProseAlignRunOptions,
  type ProseEvidencePhase,
} from "./proseAlignTypes.js";

type KnowledgeMatchKind =
  | "node_ref_exact"
  | "view_ref_exact"
  | "title_exact"
  | "node_ref_prefix"
  | "view_ref_prefix"
  | "title_prefix"
  | "node_ref_contains"
  | "view_ref_contains"
  | "title_contains";

type MatchTier = "exact" | "prefix" | "contains";

interface RankedKnowledgeNode {
  node: ExistingKnowledgeNode;
  rank: number;
  matchedBy?: KnowledgeMatchKind;
}

interface ExistingKnowledgeSelection {
  primary: RankedKnowledgeNode[];
  matchTier?: MatchTier;
  broaderIdentityMatches: number;
  relatedTagMatches: ExistingKnowledgeNode[];
  relatedTagTier?: MatchTier;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function firstMatch(values: readonly string[], query: string, exact: KnowledgeMatchKind, prefix: KnowledgeMatchKind, contains: KnowledgeMatchKind): {
  rank: number;
  matchedBy: KnowledgeMatchKind;
} | undefined {
  if (values.some((value) => normalized(value) === query)) return { rank: 0, matchedBy: exact };
  if (values.some((value) => normalized(value).startsWith(query))) return { rank: 1, matchedBy: prefix };
  if (values.some((value) => normalized(value).includes(query))) return { rank: 2, matchedBy: contains };
  return undefined;
}

function rankIdentity(node: ExistingKnowledgeNode, query: string): RankedKnowledgeNode | undefined {
  const matches = [
    firstMatch([node.node_ref], query, "node_ref_exact", "node_ref_prefix", "node_ref_contains"),
    firstMatch(node.view_refs, query, "view_ref_exact", "view_ref_prefix", "view_ref_contains"),
    firstMatch([node.title], query, "title_exact", "title_prefix", "title_contains"),
  ].filter((match): match is { rank: number; matchedBy: KnowledgeMatchKind } => match !== undefined);
  if (matches.length === 0) return undefined;
  const match = matches.sort((left, right) => left.rank - right.rank)[0]!;
  return { node, rank: match.rank, matchedBy: match.matchedBy };
}

function matchTier(rank: number): MatchTier {
  return rank === 0 ? "exact" : rank === 1 ? "prefix" : "contains";
}

function bestTagRank(node: ExistingKnowledgeNode, query: string): number | undefined {
  if (node.tags.some((value) => normalized(value) === query)) return 0;
  if (node.tags.some((value) => normalized(value).startsWith(query))) return 1;
  if (node.tags.some((value) => normalized(value).includes(query))) return 2;
  return undefined;
}

function filteredNodes(input: {
  nodes: readonly ExistingKnowledgeNode[];
  options: ProseAlignRunOptions;
}): ExistingKnowledgeSelection {
  const collection = input.options.collection === undefined ? undefined : normalized(input.options.collection);
  const nodeType = input.options.nodeType === undefined ? undefined : normalized(input.options.nodeType);
  const nodes = input.nodes.filter((node) =>
    (collection === undefined || node.collections.some((value) => normalized(value) === collection)) &&
    (nodeType === undefined || normalized(node.node_type) === nodeType)
  );
  if (input.options.query === undefined) {
    return {
      primary: nodes
        .map((node) => ({ node, rank: 0 }))
        .sort((left, right) => left.node.node_ref.localeCompare(right.node.node_ref)),
      broaderIdentityMatches: 0,
      relatedTagMatches: [],
    };
  }
  const query = normalized(input.options.query);
  const identityMatches = nodes
    .flatMap((node) => {
      const ranked = rankIdentity(node, query);
      return ranked === undefined ? [] : [ranked];
    })
    .sort((left, right) => left.rank - right.rank || left.node.node_ref.localeCompare(right.node.node_ref));
  const bestIdentityRank = identityMatches[0]?.rank;
  const primary = bestIdentityRank === undefined
    ? []
    : identityMatches.filter((item) => item.rank === bestIdentityRank);
  const tagMatches = nodes
    .flatMap((node) => {
      const rank = bestTagRank(node, query);
      return rank === undefined ? [] : [{ node, rank }];
    })
    .sort((left, right) => left.rank - right.rank || left.node.node_ref.localeCompare(right.node.node_ref));
  const bestRelatedRank = tagMatches[0]?.rank;
  return {
    primary,
    ...(bestIdentityRank === undefined ? {} : { matchTier: matchTier(bestIdentityRank) }),
    broaderIdentityMatches: identityMatches.length - primary.length,
    relatedTagMatches: bestRelatedRank === undefined
      ? []
      : tagMatches.filter((item) => item.rank === bestRelatedRank).map((item) => item.node),
    ...(bestRelatedRank === undefined ? {} : { relatedTagTier: matchTier(bestRelatedRank) }),
  };
}

function groupedCounts(
  nodes: readonly ExistingKnowledgeNode[],
  values: (node: ExistingKnowledgeNode) => readonly string[],
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const value of values(node)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

export async function existingKnowledgeView(input: {
  projectRoot: string;
  phase: ProseEvidencePhase;
  source: AlignSourceContext;
  options: ProseAlignRunOptions;
}): Promise<AlignViewResult> {
  if (input.options.query !== undefined && normalized(input.options.query).length === 0) {
    const command = alignCommand(input.phase.id, ["--view", "existing-knowledge", "--format", "json"]);
    throw new ContextError(ExitCode.UserError, "--query must contain a title or stable ref fragment", {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "existing-knowledge-query-empty",
      next_action: {
        kind: "read_existing_knowledge",
        command,
        reason_code: "existing-knowledge-query-remove-empty-filter",
      },
      input_schema: {
        query: "Optional non-empty literal matched case-insensitively against approved titles and stable refs; related tag matches are summarized separately.",
      },
      next: command,
    });
  }
  const catalog = await readExistingKnowledgeCatalog(input.projectRoot);
  const options = input.options.pageSize === undefined
    ? { ...input.options, pageSize: "50" }
    : input.options;
  const selection = filteredNodes({ nodes: catalog.nodes, options });
  const restartCommand = alignEvidenceViewCommand({
    phaseId: input.phase.id,
    view: "existing-knowledge",
    options,
    overrides: { pageToken: null, readCursor: null },
  });
  const page = pageSlice(selection.primary, options, restartCommand);
  const pageInfo = pageWithNextCommand({
    phaseId: input.phase.id,
    view: "existing-knowledge",
    options,
    page: page.page,
  });
  const envelope = commonEnvelope({ phase: input.phase, source: input.source });
  const diagnostics = catalog.diagnostics.length === 0 ? [] : [{
    severity: "info",
    code: "existing_knowledge.edge_projection_unavailable",
    family: "lifecycle",
    message: "Approved node identity lookup is available, but the optional edge projection is unavailable or stale.",
    occurrences: catalog.diagnostics.length,
  }];
  return {
    kind: envelope.kind,
    schema_version: envelope.schema_version,
    phase_id: envelope.phase_id,
    source: envelope.source,
    collection: envelope.collection,
    state: "evidence-ready",
    view: "existing-knowledge",
    existing_knowledge: {
      present: catalog.present,
      counts: catalog.counts,
      available: catalog.available,
      filters: {
        ...(input.options.query !== undefined ? { query: input.options.query } : {}),
        ...(input.options.collection !== undefined ? { collection: input.options.collection } : {}),
        ...(input.options.nodeType !== undefined ? { node_type: input.options.nodeType } : {}),
      },
      matched_total: selection.primary.length,
      returned: page.items.length,
      selection_strategy: input.options.query === undefined
        ? "stable_node_ref"
        : "best_identity_tier_then_tag_summary",
      ...(selection.matchTier === undefined
        ? {}
        : { match_tier: selection.matchTier }),
      ...(input.options.query === undefined
        ? {}
        : { broader_identity_matches: selection.broaderIdentityMatches }),
      nodes: page.items.map(({ node, matchedBy }) => ({
        ...node,
        ...(matchedBy !== undefined ? { matched_by: matchedBy } : {}),
      })),
      ...(input.options.query === undefined
        ? {}
        : {
            related: {
              tag_matches: {
                matched_total: selection.relatedTagMatches.length,
                ...(selection.relatedTagTier === undefined
                  ? {}
                  : { match_tier: selection.relatedTagTier }),
                by_node_type: groupedCounts(selection.relatedTagMatches, (node) => [node.node_type]),
                by_collection: groupedCounts(selection.relatedTagMatches, (node) => node.collections),
              },
            },
          }),
      ...(pageInfo !== undefined ? { page: pageInfo } : {}),
      lookup: {
        command: alignCommand(input.phase.id, [
          "--view",
          "existing-knowledge",
          "--query",
          "<title-or-stable-ref>",
          "--format",
          "json",
        ]),
        filters: ["query", "collection", "node_type"],
      },
    },
    diagnostics,
    next_action: typeof pageInfo?.next_command === "string"
      ? {
          kind: "read_next_page",
          command: pageInfo.next_command,
          reason_code: "prose-align-existing-knowledge-next-page",
        }
      : {
          kind: "existing_knowledge_ready",
          reason_code: "prose-align-existing-knowledge-ready",
          message: selection.primary.length > 0
            ? "Reuse matching stable refs while authoring the structure, then continue the current evidence read plan."
            : selection.relatedTagMatches.length > 0
              ? "No approved identity matched. Related tag matches are summarized without expanding the related subgraph."
              : "No approved identity matched. Continue the current evidence read plan without inventing a reusable ref.",
        },
  };
}
