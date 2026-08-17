import {
  alignCommand,
  commonEnvelope,
  suggestedAlignPayloadPath,
  type AlignViewResult,
  type EvidenceContext,
  type ProseEvidencePhase,
  type EvidenceRelationRef,
  type ProseAlignRunOptions,
} from "./proseAlignTypes.js";
import {
  alignEvidenceViewCommand,
  evidenceBudgets,
  pageSlice,
  pageWithNextCommand,
  samePageExpandedBudgetCommand,
  takeRecordsByByteBudget,
} from "./proseAlignBudget.js";
import { filteredChunks } from "./proseAlignViewUtils.js";
import { sourceBodyFilePlan } from "./proseAlignFullText.js";

type RelationHintMetadata = Omit<EvidenceRelationRef, "quote">;

function relationHintMetadata(hint: EvidenceRelationRef): RelationHintMetadata {
  const { quote: _quote, ...metadata } = hint;
  void _quote;
  return metadata;
}

export function sourceIndex(input: {
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): AlignViewResult {
  const compact = input.options.compact === true;
  const options = compact && input.options.source === undefined && input.options.pageSize === undefined
    ? { ...input.options, pageSize: "40" }
    : input.options;
  const budgets = evidenceBudgets(options);
  const documentsByteBudget = Math.max(1, Math.floor(budgets.byteBudget / 2));
  const spansByteBudget = Math.max(1, budgets.byteBudget - documentsByteBudget);
  const perDocumentMetadataBudget = Math.max(1, Math.min(6_000, Math.floor(documentsByteBudget / 4)));
  const filtered = filteredChunks(input.evidence, options);
  const documentPaths = new Set(filtered.map((chunk) => chunk.document_path));
  const documents = input.evidence.documents
    .filter(({ document, locator }) =>
      options.source === undefined ||
      document.path === options.source ||
      locator === options.source ||
      documentPaths.has(document.path)
    )
    .map(({ document, locator, token_estimate, heading_tree, relation_hints }) => {
      if (compact) {
        return {
          document_path: document.path,
          locator,
          ...(document.route !== undefined ? { route: document.route } : {}),
          ...(document.route_metadata_path !== undefined ? { route_metadata_path: document.route_metadata_path } : {}),
          title: document.title,
          line_count: document.line_count,
          token_estimate,
          chunks: input.evidence.chunks.filter((chunk) => chunk.document_path === document.path).length,
        };
      }
      const headingTree = takeRecordsByByteBudget(heading_tree, perDocumentMetadataBudget);
      const relationHints = takeRecordsByByteBudget(
        relation_hints.map((hint) => relationHintMetadata(hint)),
        perDocumentMetadataBudget,
      );
      return {
        document_path: document.path,
        locator,
        ...(document.route !== undefined ? { route: document.route } : {}),
        ...(document.route_metadata_path !== undefined ? { route_metadata_path: document.route_metadata_path } : {}),
        title: document.title,
        line_count: document.line_count,
        token_estimate,
        heading_tree: headingTree.items,
        heading_tree_total: headingTree.items.length + headingTree.byte_omitted_count,
        heading_tree_omitted_count: headingTree.byte_omitted_count,
        relation_hints: relationHints.items,
        relation_hints_total: relationHints.items.length + relationHints.byte_omitted_count,
        relation_hints_omitted_count: relationHints.byte_omitted_count,
      };
    });
  const spans = filtered.map((chunk) => ({
    chunk_id: chunk.chunk_id,
    document_path: chunk.document_path,
    locator: chunk.locator,
    kind: chunk.kind,
    boundary_role: chunk.boundary_role,
    section_candidate: chunk.section_candidate,
    heading_path: chunk.heading_path,
    line_range: chunk.line_range,
    source_ref: chunk.source_ref,
    token_estimate: chunk.token_estimate,
    char_count: chunk.char_count,
    link_count: chunk.link_count,
    code_fence_count: chunk.code_fence_count,
    table_row_count: chunk.table_row_count,
    ...(chunk.relation_hints !== undefined ? { relation_hints: chunk.relation_hints.map((hint) => relationHintMetadata(hint)) } : {}),
  }));
  const page = pageSlice(spans, options, alignEvidenceViewCommand({
    phaseId: input.phase.id,
    view: "source-index",
    options,
    overrides: { pageToken: null, readCursor: null },
  }));
  const pageInfo = pageWithNextCommand({ phaseId: input.phase.id, view: "source-index", options, page: page.page });
  const byteLimitedDocuments = takeRecordsByByteBudget(documents, documentsByteBudget);
  const byteLimitedSpans = takeRecordsByByteBudget(page.items, spansByteBudget);
  const byteTruncated = byteLimitedDocuments.byte_truncated || byteLimitedSpans.byte_truncated;
  const byteOmittedCount = byteLimitedDocuments.byte_omitted_count + byteLimitedSpans.byte_omitted_count;
  const bodyPlan = sourceBodyFilePlan(input.evidence, options.source);
  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view: "source-index",
    compact,
    byte_budget: budgets.byteBudget,
    source_index: {
      documents: byteLimitedDocuments.items,
      documents_total: documents.length,
      documents_byte_budget: byteLimitedDocuments.byte_budget,
      documents_byte_used: byteLimitedDocuments.byte_used,
      documents_byte_omitted_count: byteLimitedDocuments.byte_omitted_count,
      documents_byte_truncated: byteLimitedDocuments.byte_truncated,
      spans: byteLimitedSpans.items,
      spans_total: spans.length,
      spans_byte_budget: byteLimitedSpans.byte_budget,
      spans_byte_used: byteLimitedSpans.byte_used,
      spans_byte_omitted_count: byteLimitedSpans.byte_omitted_count,
      spans_byte_truncated: byteLimitedSpans.byte_truncated,
      byte_budget: budgets.byteBudget,
      byte_used: byteLimitedDocuments.byte_used + byteLimitedSpans.byte_used,
      byte_omitted_count: byteOmittedCount,
      byte_truncated: byteTruncated,
      body_delivery: {
        state: bodyPlan.length === 0 ? "not-applicable" : "required",
        documents: bodyPlan,
      },
      ...(pageInfo !== undefined ? { page: pageInfo } : {}),
    },
    next_action: byteTruncated
      ? {
          kind: "read_more_evidence",
          command: samePageExpandedBudgetCommand({
            phaseId: input.phase.id,
            view: "source-index",
            options,
            page: page.page,
            byteBudget: String(budgets.byteBudget * 2),
          }),
          reason_code: "prose-align-byte-budget-truncated",
          byte_omitted_count: byteOmittedCount,
        }
      : typeof pageInfo?.next_command === "string"
      ? {
          kind: "read_next_page",
          command: pageInfo.next_command,
          reason_code: "prose-align-next-page",
        }
      : input.phase.collection === undefined
      ? {
          kind: "read_source_body_resources",
          resources: bodyPlan,
          reason_code: "prose-align-source-body-required",
        }
      : {
          kind: "author_structure",
          effect: "write",
          command: alignCommand(input.phase.id, [
            "--stage",
            "--input",
            suggestedAlignPayloadPath(input.phase.id),
            "--format",
            "json",
          ]),
          payload_target: suggestedAlignPayloadPath(input.phase.id),
          required_source_bodies: bodyPlan,
          reason_code: bodyPlan.length === 0
            ? "prose-align-ready-for-payload"
            : "prose-align-source-body-required",
        },
  };
}
