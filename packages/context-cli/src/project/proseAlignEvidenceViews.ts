import {
  buildTokenBudgetWindow,
  previewTextFields,
} from "../lib/tokenBudget.js";
import {
  alignEvidenceViewCommand,
  alignHowToExplore,
  applyByteBudgetToWindow,
  evidenceBudgets,
  nextEvidenceAction,
  pageSlice,
  pageWithNextCommand,
  samePageExpandedBudgetCommand,
  takeRecordsByByteBudget,
} from "./proseAlignBudget.js";
import {
  alignCommand,
  commonEnvelope,
  type AlignViewResult,
  type EvidenceContext,
  type ProseEvidencePhase,
  type ProseAlignRunOptions,
} from "./proseAlignTypes.js";
import { filteredChunks } from "./proseAlignViewUtils.js";

export function sourceBundle(input: {
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): AlignViewResult {
  const budgets = evidenceBudgets(input.options);
  const page = pageSlice(filteredChunks(input.evidence, input.options), input.options, alignEvidenceViewCommand({
    phaseId: input.phase.id,
    view: "source-bundle",
    options: input.options,
    overrides: { pageToken: null, readCursor: null },
  }));
  const window = applyByteBudgetToWindow(buildTokenBudgetWindow({
    entries: page.items.map((chunk) => ({ item: chunk as unknown as Record<string, unknown> })),
    itemIdField: "chunk_id",
    tokenBudget: budgets.tokenBudget,
    selectionPolicy: {
      id: "document-order",
      order: [{ field: "document_path,line_start", direction: "asc" }],
      note: "Temporary reading chunks preserve snapshot line order and do not become approved identities.",
    },
    howToExplore: alignHowToExplore({
      phaseId: input.phase.id,
      view: "chunks",
      options: input.options,
      budget: budgets,
    }),
    previewItem: (item) => previewTextFields(item, 600),
  }), budgets.byteBudget);
  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view: "source-bundle",
    token_budget: budgets.tokenBudget,
    byte_budget: budgets.byteBudget,
    source_bundle: window,
    ...(page.page !== undefined ? { page: pageWithNextCommand({ phaseId: input.phase.id, view: "source-bundle", options: input.options, page: page.page }) } : {}),
    next_action: nextEvidenceAction({
      phaseId: input.phase.id,
      view: "source-bundle",
      options: input.options,
      page: page.page,
      budget: window,
      truncatedCommandArgs: [
        "--view",
        "chunks",
        "--page-size",
        "20",
        "--token-budget",
        String(Math.max(budgets.tokenBudget * 2, 5000)),
        "--byte-budget",
        String(budgets.byteBudget * 2),
        "--format",
        "json",
      ],
      truncatedCommand: samePageExpandedBudgetCommand({
        phaseId: input.phase.id,
        view: "chunks",
        options: input.options,
        page: page.page,
        pageSize: "20",
        tokenBudget: String(Math.max(budgets.tokenBudget * 2, 5000)),
        byteBudget: String(budgets.byteBudget * 2),
      }),
    }),
  };
}

export function chunksView(input: {
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): AlignViewResult {
  const budgets = evidenceBudgets(input.options);
  const page = pageSlice(filteredChunks(input.evidence, input.options).map((chunk) => ({
    chunk_id: chunk.chunk_id,
    document_path: chunk.document_path,
    locator: chunk.locator,
    kind: chunk.kind,
    boundary_role: chunk.boundary_role,
    section_candidate: chunk.section_candidate,
    heading_path: chunk.heading_path,
    line_range: chunk.line_range,
    source_ref: chunk.source_ref,
    text_preview: chunk.text_preview,
    token_estimate: chunk.token_estimate,
    char_count: chunk.char_count,
    link_count: chunk.link_count,
    code_fence_count: chunk.code_fence_count,
    table_row_count: chunk.table_row_count,
    ...(chunk.relation_hints !== undefined ? { relation_hints: chunk.relation_hints } : {}),
  })), input.options, alignEvidenceViewCommand({
    phaseId: input.phase.id,
    view: "chunks",
    options: input.options,
    overrides: { pageToken: null, readCursor: null },
  }));
  const window = applyByteBudgetToWindow(buildTokenBudgetWindow({
    entries: page.items.map((chunk) => ({ item: chunk })),
    itemIdField: "chunk_id",
    tokenBudget: budgets.tokenBudget,
    selectionPolicy: {
      id: "document-order",
      order: [{ field: "document_path,line_start", direction: "asc" }],
    },
    howToExplore: alignHowToExplore({
      phaseId: input.phase.id,
      view: "chunks",
      options: input.options,
      budget: budgets,
    }),
  }), budgets.byteBudget);
  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view: "chunks",
    token_budget: budgets.tokenBudget,
    byte_budget: budgets.byteBudget,
    chunks: window,
    ...(page.page !== undefined ? { page: pageWithNextCommand({ phaseId: input.phase.id, view: "chunks", options: input.options, page: page.page }) } : {}),
    next_action: nextEvidenceAction({
      phaseId: input.phase.id,
      view: "chunks",
      options: input.options,
      page: page.page,
      budget: window,
      truncatedCommandArgs: [
        "--view",
        "chunks",
        "--page-size",
        "20",
        "--token-budget",
        String(Math.max(budgets.tokenBudget * 2, 5000)),
        "--byte-budget",
        String(budgets.byteBudget * 2),
        "--format",
        "json",
      ],
      truncatedCommand: samePageExpandedBudgetCommand({
        phaseId: input.phase.id,
        view: "chunks",
        options: input.options,
        page: page.page,
        pageSize: "20",
        tokenBudget: String(Math.max(budgets.tokenBudget * 2, 5000)),
        byteBudget: String(budgets.byteBudget * 2),
      }),
    }),
  };
}

export function windowsView(input: {
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): AlignViewResult {
  const budgets = evidenceBudgets(input.options);
  let windows = [...input.evidence.windows];
  if (input.options.source !== undefined) {
    windows = windows.filter((window) => window.document_path === input.options.source || window.locator === input.options.source);
  }
  const page = pageSlice(windows, input.options, alignEvidenceViewCommand({
    phaseId: input.phase.id,
    view: "windows",
    options: input.options,
    overrides: { pageToken: null, readCursor: null },
  }));
  const budget = applyByteBudgetToWindow(buildTokenBudgetWindow({
    entries: page.items.map((window) => ({ item: window as unknown as Record<string, unknown> })),
    itemIdField: "window_id",
    tokenBudget: budgets.tokenBudget,
    selectionPolicy: {
      id: "document-window-order",
      order: [{ field: "document_path,line_start", direction: "asc" }],
    },
    howToExplore: alignHowToExplore({
      phaseId: input.phase.id,
      view: "windows",
      options: input.options,
      budget: budgets,
    }),
  }), budgets.byteBudget);
  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view: "windows",
    token_budget: budgets.tokenBudget,
    byte_budget: budgets.byteBudget,
    windows: budget,
    ...(page.page !== undefined ? { page: pageWithNextCommand({ phaseId: input.phase.id, view: "windows", options: input.options, page: page.page }) } : {}),
    next_action: nextEvidenceAction({
      phaseId: input.phase.id,
      view: "windows",
      options: input.options,
      page: page.page,
      budget,
      truncatedCommandArgs: [
        "--view",
        "windows",
        "--page-size",
        "20",
        "--token-budget",
        String(Math.max(budgets.tokenBudget * 2, 5000)),
        "--byte-budget",
        String(budgets.byteBudget * 2),
        "--format",
        "json",
      ],
      truncatedCommand: samePageExpandedBudgetCommand({
        phaseId: input.phase.id,
        view: "windows",
        options: input.options,
        page: page.page,
        pageSize: "20",
        tokenBudget: String(Math.max(budgets.tokenBudget * 2, 5000)),
        byteBudget: String(budgets.byteBudget * 2),
      }),
    }),
  };
}

export function sourceMapping(input: {
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): AlignViewResult {
  const budgets = evidenceBudgets(input.options);
  const chunks = filteredChunks(input.evidence, input.options);
  const documentPaths = new Set(chunks.map((chunk) => chunk.document_path));
  const documents = input.evidence.documents
    .filter(({ document, locator }) =>
      input.options.source === undefined ||
      document.path === input.options.source ||
      locator === input.options.source ||
      documentPaths.has(document.path)
    )
    .map(({ document, locator, heading_tree, relation_hints }) => ({
      document_path: document.path,
      locator,
      ...(document.route !== undefined ? { route: document.route } : {}),
      ...(document.route_metadata_path !== undefined ? { route_metadata_path: document.route_metadata_path } : {}),
      canonical_source: `${input.evidence.source.sourceType}:${input.evidence.source.sourceName}`,
      line_count: document.line_count,
      chunks: input.evidence.chunks.filter((chunk) => chunk.document_path === document.path).length,
      heading_count: heading_tree.length,
      relation_hints,
    }));
  const chunkPage = pageSlice(chunks.map((chunk) => ({
    chunk_id: chunk.chunk_id,
    document_path: chunk.document_path,
    locator: chunk.locator,
    boundary_role: chunk.boundary_role,
    section_candidate: chunk.section_candidate,
    heading_path: chunk.heading_path,
    line_range: chunk.line_range,
    source_ref: chunk.source_ref,
  })), input.options, alignEvidenceViewCommand({
    phaseId: input.phase.id,
    view: "source-mapping",
    options: input.options,
    overrides: { pageToken: null, readCursor: null },
  }));
  const page = pageWithNextCommand({ phaseId: input.phase.id, view: "source-mapping", options: input.options, page: chunkPage.page });
  const byteLimitedChunks = takeRecordsByByteBudget(chunkPage.items, budgets.byteBudget);
  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view: "source-mapping",
    byte_budget: budgets.byteBudget,
    source_mapping: {
      documents,
      chunks: byteLimitedChunks.items,
      byte_budget: byteLimitedChunks.byte_budget,
      byte_used: byteLimitedChunks.byte_used,
      byte_omitted_count: byteLimitedChunks.byte_omitted_count,
      byte_truncated: byteLimitedChunks.byte_truncated,
      ...(page !== undefined ? { page } : {}),
    },
    next_action: byteLimitedChunks.byte_truncated
      ? {
          kind: "read_more_evidence",
          command: samePageExpandedBudgetCommand({
            phaseId: input.phase.id,
            view: "source-mapping",
            options: input.options,
            page: chunkPage.page,
            byteBudget: String(budgets.byteBudget * 2),
          }),
          reason_code: "prose-align-byte-budget-truncated",
          byte_omitted_count: byteLimitedChunks.byte_omitted_count,
        }
      : typeof page?.next_command === "string"
      ? {
          kind: "read_next_page",
          command: page.next_command,
          reason_code: "prose-align-next-page",
        }
      : {
          kind: "write_or_validate_payload",
          command: alignCommand(input.phase.id, ["--view", "schema", "--format", "json"]),
          reason_code: "prose-align-schema-next",
        },
  };
}
