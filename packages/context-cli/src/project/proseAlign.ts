import type {
  AlignProsePhaseDefinition,
  CaptureFilePhaseDefinition,
  CaptureLarkPhaseDefinition,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { resolveDocumentPhaseSource } from "./documentRun.js";
import { loadProseEvidence } from "./proseAlignEvidence.js";
import { fullText, sourceBodyFilePlan } from "./proseAlignFullText.js";
import { existingKnowledgeView } from "./proseAlignExistingKnowledgeView.js";
import { sourceIndex } from "./proseAlignSourceIndex.js";
import {
  readAlignInputPayload,
  stageAlignPayload,
  validateAlignPayload,
} from "./proseAlignPayload.js";
import { normalizeAlignPayloadForWrite } from "./proseAlignPayloadParse.js";
import { STRUCTURE_FILE } from "./proseCompileConstants.js";
import {
  alignEvidenceViewCommand,
  evidenceBudgets,
  pageSlice,
  pageWithNextCommand,
  samePageExpandedBudgetCommand,
  takeRecordsByByteBudget,
} from "./proseAlignBudget.js";
import {
  chunksView,
  sourceBundle,
  sourceMapping,
  windowsView,
} from "./proseAlignEvidenceViews.js";
import { spanText } from "./proseAlignSpanText.js";
import {
  ALIGN_VIEWS,
  STRUCTURE_SCHEMA_VERSION,
  alignSemanticRules,
  alignCommand,
  commonEnvelope,
  payloadSchema,
  suggestedAlignPayloadPath,
  type AlignView,
  type AlignViewResult,
  type AlignSourceContext,
  type EvidenceContext,
  type ProseEvidencePhase,
  type ProseAlignRunOptions,
  type ProseAlignRunResult,
} from "./proseAlignTypes.js";
import { repairSuggestedSplitPayload } from "./proseAlignRepair.js";
import { semanticRulesView } from "./semanticRulesView.js";
import { diagnosticsView } from "./diagnosticsView.js";

export {
  isProseAlignRunResult,
  type ProseAlignRunOptions,
  type ProseAlignRunResult,
} from "./proseAlignTypes.js";

function userError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function parseView(value: string | undefined, schema: boolean | undefined, phaseId: string): AlignView {
  const requested = schema === true ? "schema" : value ?? "read-plan";
  if ((ALIGN_VIEWS as readonly string[]).includes(requested)) return requested as AlignView;
  throw userError(`unknown prose align view: ${requested}`, {
    view: requested,
    allowed_views: ALIGN_VIEWS,
    diagnostics: [{
      severity: "error",
      code: "view.unknown",
      family: "schema",
      message: `Use one of ${ALIGN_VIEWS.join(", ")}.`,
    }],
    repair_hints: [{
      action: "choose_view",
      allowed_views: ALIGN_VIEWS,
    }],
    next: alignCommand(phaseId, ["--view", "read-plan", "--format", "json"]),
  });
}

async function loadSourceContext(input: {
  projectRoot: string;
  phase: AlignProsePhaseDefinition;
}): Promise<AlignSourceContext> {
  const resolved = await resolveDocumentPhaseSource({
    projectRoot: input.projectRoot,
    phase: input.phase,
  });
  return {
    sourceType: resolved.sourceType,
    sourceName: resolved.sourceName,
    materializedAt: resolved.entry.materializedAt,
    ...(resolved.entry.snapshot?.manifest !== undefined ? { manifestPath: resolved.entry.snapshot.manifest } : {}),
  };
}

function readPlan(input: {
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): AlignViewResult {
  const payloadPath = suggestedAlignPayloadPath(input.phase.id);
  const budgets = evidenceBudgets(input.options);
  const perDocumentMetadataBudget = Math.max(1_000, Math.min(6_000, Math.floor(budgets.byteBudget / 4)));
  const docs = input.evidence.documents.map(({ document, locator, token_estimate, heading_tree, relation_hints }) => ({
    document,
    locator,
    token_estimate,
    headingTree: takeRecordsByByteBudget(heading_tree, perDocumentMetadataBudget),
    relationHints: takeRecordsByByteBudget(relation_hints.map((hint) => ({ ...hint })), perDocumentMetadataBudget),
  })).map(({ document, locator, token_estimate, headingTree, relationHints }) => ({
    document_path: document.path,
    locator,
    ...(document.route !== undefined ? { route: document.route } : {}),
    ...(document.route_metadata_path !== undefined ? { route_metadata_path: document.route_metadata_path } : {}),
    title: document.title,
    line_count: document.line_count,
    token_estimate,
    chunks: input.evidence.chunks.filter((chunk) => chunk.document_path === document.path).length,
    heading_tree: headingTree.items,
    heading_tree_total: headingTree.items.length + headingTree.byte_omitted_count,
    heading_tree_omitted_count: headingTree.byte_omitted_count,
    relation_hints: relationHints.items,
    relation_hints_total: relationHints.items.length + relationHints.byte_omitted_count,
    relation_hints_omitted_count: relationHints.byte_omitted_count,
  }));
  const page = pageSlice(docs, input.options, alignEvidenceViewCommand({
    phaseId: input.phase.id,
    view: "read-plan",
    options: input.options,
    overrides: { pageToken: null, readCursor: null },
  }));
  const pageInfo = pageWithNextCommand({ phaseId: input.phase.id, view: "read-plan", options: input.options, page: page.page });
  const byteLimitedDocs = takeRecordsByByteBudget(page.items, budgets.byteBudget);
  const authoringSpans = takeRecordsByByteBudget(
    input.evidence.chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      document_path: chunk.document_path,
      heading_path: chunk.heading_path,
      kind: chunk.kind,
      line_range: chunk.line_range,
      source_ref: chunk.source_ref,
    })),
    Math.max(1, budgets.byteBudget - byteLimitedDocs.byte_used),
  );
  const sourceIndexCommand = alignCommand(input.phase.id, ["--view", "source-index", "--compact", "--byte-budget", "24000", "--format", "json"]);
  const bodyPlan = sourceBodyFilePlan(input.evidence);
  const nextAction = byteLimitedDocs.byte_truncated
    ? {
        kind: "read_more_evidence",
        command: samePageExpandedBudgetCommand({
          phaseId: input.phase.id,
          view: "read-plan",
          options: input.options,
          page: page.page,
          byteBudget: String(Math.max(budgets.byteBudget * 2, 24000)),
        }),
        reason_code: "prose-align-byte-budget-truncated",
        byte_omitted_count: byteLimitedDocs.byte_omitted_count,
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
          supporting_index_command: sourceIndexCommand,
          reason_code: "prose-align-source-body-required",
        }
    : authoringSpans.byte_truncated
      ? {
          kind: "read_evidence_index",
          command: sourceIndexCommand,
          reason_code: "prose-align-read-source-index",
          byte_omitted_count: authoringSpans.byte_omitted_count,
        }
      : {
          kind: "author_structure",
          effect: "write",
          command: alignCommand(input.phase.id, [
            "--stage",
            "--input",
            payloadPath,
            "--format",
            "json",
          ]),
          payload_target: payloadPath,
          required_source_bodies: bodyPlan,
          reason_code: bodyPlan.length === 0
            ? "prose-align-ready-for-payload"
            : "prose-align-source-body-required",
        };
  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view: "read-plan",
    token_budget: budgets.tokenBudget,
    byte_budget: budgets.byteBudget,
    snapshot: {
      manifest: input.evidence.index.source_manifest_path,
      snapshot_hash: input.evidence.index.snapshot_hash,
      documents: docs.length,
      chunks: input.evidence.chunks.length,
      windows: input.evidence.windows.length,
    },
    read_plan: {
      documents: byteLimitedDocs.items,
      documents_total: docs.length,
      byte_budget: byteLimitedDocs.byte_budget,
      byte_used: byteLimitedDocs.byte_used,
      byte_omitted_count: byteLimitedDocs.byte_omitted_count,
      byte_truncated: byteLimitedDocs.byte_truncated,
      body_resources: bodyPlan,
      supporting_commands: {
        source_index: sourceIndexCommand,
        ...(input.phase.collection === undefined
          ? {}
          : {
              schema: alignCommand(input.phase.id, ["--view", "schema", "--format", "json"]),
              structure_summary: alignCommand(input.phase.id, ["--view", "structure-summary", "--input", payloadPath, "--format", "json"]),
            }),
      },
      body_delivery: {
        state: bodyPlan.length === 0 ? "not-applicable" : "required",
        documents: bodyPlan,
        index_is_body: false,
      },
      authoring_spans: authoringSpans.items,
      authoring_spans_total:
        authoringSpans.items.length + authoringSpans.byte_omitted_count,
      authoring_spans_omitted_count: authoringSpans.byte_omitted_count,
      authoring_spans_truncated: authoringSpans.byte_truncated,
      ...(input.phase.collection === undefined
        ? {}
        : {
            authoring_contract: {
              schema_version: STRUCTURE_SCHEMA_VERSION,
              source:
                `${input.evidence.source.sourceType}:${input.evidence.source.sourceName}`,
              collection: input.phase.collection,
              evidence_snapshot_hash: input.evidence.index.snapshot_hash,
              required_fields: {
                payload: [
                  "schema_version",
                  "sources",
                  "nodes",
                  "views",
                  "edges",
                  "unresolved",
                  "lifecycle",
                  "evidence_snapshot_hash",
                ],
                node: ["node_ref", "title", "node_type"],
                view: [
                  "view_ref",
                  "node_ref",
                  "collection",
                  "title",
                  "containment",
                  "slug",
                  "sections",
                ],
                section: ["id", "kind", "source_refs"],
                edge: ["type", "from", "to", "source_refs"],
              },
              derived_fields: ["path", "section_ref"],
              lifecycle: { state: "draft" },
            },
          }),
    },
    ...(pageInfo !== undefined ? { page: pageInfo } : {}),
    ...(input.phase.collection !== undefined
      ? { payload_schema: payloadSchema(input.evidence.index.snapshot_hash, input.evidence.source, input.phase.collection) }
      : {}),
    next_action: nextAction,
  };
}

function schemaView(input: {
  phase: AlignProsePhaseDefinition;
  source: AlignSourceContext;
  view: AlignView;
}): AlignViewResult {
  const payloadPath = suggestedAlignPayloadPath(input.phase.id);
  return {
    ...commonEnvelope({ phase: input.phase, source: input.source }),
    view: input.view,
    payload_schema: payloadSchema(undefined, input.source, input.phase.collection),
    minimal: {
      validate_command: alignCommand(input.phase.id, ["--validate", "--input", payloadPath, "--format", "json"]),
      stage_command: alignCommand(input.phase.id, ["--stage", "--input", payloadPath, "--format", "json"]),
      compile_command: `context run ${input.phase.id.replace(/^align:/u, "compile:")} --dry-run`,
    },
    next_action: {
      kind: "write_structure",
      command: alignCommand(input.phase.id, ["--validate", "--input", payloadPath, "--format", "json"]),
      reason_code: "prose-align-write-structure",
    },
  };
}

async function spanDetail(input: {
  projectRoot: string;
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): Promise<AlignViewResult> {
  const result = await spanText({ ...input, view: "span-detail" });
  const spanTextPayload = result.span_text;
  const { span_text: _spanText, ...rest } = result;
  void _spanText;
  return {
    ...rest,
    view: "span-detail",
    span_detail: spanTextPayload,
  };
}

const CAPTURE_INVESTIGATION_VIEWS = new Set([
  "read-plan",
  "source-index",
  "source-bundle",
  "chunks",
  "windows",
  "span-detail",
  "span-text",
  "full-text",
  "source-mapping",
]);

export async function runCaptureProseInvestigation(input: {
  projectRoot: string;
  phase: CaptureFilePhaseDefinition | CaptureLarkPhaseDefinition;
  options?: ProseAlignRunOptions;
}): Promise<AlignViewResult> {
  const options = input.options ?? {};
  const view = parseView(options.view, options.schema, input.phase.id);
  if (!CAPTURE_INVESTIGATION_VIEWS.has(view)) {
    throw new ContextError(ExitCode.UserError, `capture investigation does not support view: ${view}`, {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "capture-investigation-view-unsupported",
      allowed_views: [...CAPTURE_INVESTIGATION_VIEWS],
      next: alignCommand(input.phase.id, ["--view", "read-plan", "--format", "json"]),
    });
  }
  const evidence = await loadProseEvidence({ projectRoot: input.projectRoot, phase: input.phase });
  const phase: ProseEvidencePhase = { id: input.phase.id };
  if (view === "read-plan") return readPlan({ phase, evidence, options });
  if (view === "source-index") return sourceIndex({ phase, evidence, options });
  if (view === "source-bundle") return sourceBundle({ phase, evidence, options });
  if (view === "chunks") return chunksView({ phase, evidence, options });
  if (view === "windows") return windowsView({ phase, evidence, options });
  if (view === "span-detail") return spanDetail({ projectRoot: input.projectRoot, phase, evidence, options });
  if (view === "span-text") return spanText({ projectRoot: input.projectRoot, phase, evidence, options });
  if (view === "full-text") return fullText({ phase, evidence, options });
  return sourceMapping({ phase, evidence, options });
}

async function runAlignPayloadWrite(input: {
  projectRoot: string;
  phase: AlignProsePhaseDefinition;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): Promise<ProseAlignRunResult> {
  const rawPayload = await readAlignInputPayload(input.options.confirm === true ? input.options.input ?? STRUCTURE_FILE : input.options.input);
  const validated = await validateAlignPayloadWithSelfHeal({
    projectRoot: input.projectRoot,
    phaseId: input.phase.id,
    phaseCollection: input.phase.collection,
    evidence: input.evidence,
    rawPayload,
    ...(input.options.input !== undefined ? { commandInputPath: input.options.input } : {}),
    ...(input.options.replace !== undefined ? { replace: input.options.replace } : {}),
  });
  if (input.options.validate === true) return validated.result;
  if (validated.result.state === "invalid" || validated.payload === undefined) {
    throw userError("context.structure.v1 payload is not valid", {
      diagnostics: validated.result.diagnostics,
      repair_hints: validated.result.repair_hints,
      next: alignCommand(input.phase.id, ["--validate", "--input", input.options.input ?? suggestedAlignPayloadPath(input.phase.id), "--format", "json"]),
    });
  }
  if (validated.result.state !== "ready") {
    const nextCommand = typeof validated.result.next_action.command === "string"
      ? validated.result.next_action.command
      : alignCommand(input.phase.id, ["--validate", "--input", input.options.input ?? suggestedAlignPayloadPath(input.phase.id), "--format", "json"]);
    throw userError("context.structure.v1 payload has unresolved confirmation blockers", {
      confirmation_blockers: validated.result.confirmation_blockers,
      warning_lifecycle: validated.result.warning_lifecycle,
      repair_hints: validated.result.repair_hints,
      next: nextCommand,
    });
  }
  const managedConfirmation = input.options.managed === true && input.options.stage === true;
  const confirming = input.options.confirm === true || managedConfirmation;
  const payloadForStage = confirming
    ? {
        ...validated.payload,
        lifecycle: {
          state: "confirmed" as const,
          confirmed_by: managedConfirmation || input.options.managed === true ? "managed-session" : "user",
          confirmed_at: new Date().toISOString(),
          structure_digest: validated.payload.structure_digest,
        },
      }
    : validated.payload;
  const payloadValidation = confirming
    ? await validateAlignPayloadWithSelfHeal({
        projectRoot: input.projectRoot,
        phaseId: input.phase.id,
        phaseCollection: input.phase.collection,
        evidence: input.evidence,
        rawPayload: normalizeAlignPayloadForWrite(payloadForStage),
        ...(input.options.replace !== undefined ? { replace: input.options.replace } : {}),
      })
    : validated;
  if (payloadValidation.result.state === "invalid" || payloadValidation.payload === undefined) {
    throw userError("confirmed context.structure.v1 payload is not valid", {
      diagnostics: payloadValidation.result.diagnostics,
      repair_hints: payloadValidation.result.repair_hints,
      next: alignCommand(input.phase.id, ["--view", "structure-summary", "--input", input.options.input ?? STRUCTURE_FILE, "--format", "json"]),
    });
  }
  return stageAlignPayload({
    projectRoot: input.projectRoot,
    phaseId: input.phase.id,
    phaseCollection: input.phase.collection,
    evidence: input.evidence,
    payload: payloadValidation.payload,
    ...(payloadValidation.result.review_notice !== undefined ? { reviewNotice: payloadValidation.result.review_notice } : {}),
    ...(payloadValidation.result.structure_summary !== undefined ? { structureSummary: payloadValidation.result.structure_summary } : {}),
    ...(payloadValidation.result.structure_summary_compact !== undefined ? { structureSummaryCompact: payloadValidation.result.structure_summary_compact } : {}),
    ...(payloadValidation.result.structure_report !== undefined ? { structureReport: payloadValidation.result.structure_report } : {}),
    warningLifecycle: payloadValidation.result.warning_lifecycle,
    ...(validated.result.self_healed !== undefined
      ? { selfHealed: validated.result.self_healed }
      : payloadValidation.result.self_healed !== undefined
        ? { selfHealed: payloadValidation.result.self_healed }
        : {}),
    ...(input.options.replace !== undefined ? { replace: input.options.replace } : {}),
  });
}

async function validateAlignPayloadWithSelfHeal(input: {
  projectRoot: string;
  phaseId: string;
  phaseCollection: string;
  evidence: EvidenceContext;
  rawPayload: unknown;
  commandInputPath?: string;
  replace?: string;
  includeStructureSummary?: boolean;
}): Promise<Awaited<ReturnType<typeof validateAlignPayload>>> {
  let validated = await validateAlignPayload({
    projectRoot: input.projectRoot,
    phaseId: input.phaseId,
    phaseCollection: input.phaseCollection,
    evidence: input.evidence,
    rawPayload: input.rawPayload,
    ...(input.commandInputPath !== undefined
      ? { commandInputPath: input.commandInputPath }
      : {}),
    ...(input.replace !== undefined ? { replace: input.replace } : {}),
    ...(input.includeStructureSummary === true
      ? { includeStructureSummary: true }
      : {}),
  });
  const inputSections = validated.payload?.views.reduce(
    (count, view) => count + view.sections.length,
    0,
  ) ?? 0;
  let sectionsSplit = 0;
  const reasonCounts = new Map<string, number>();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (
      validated.result.state === "invalid" ||
      validated.result.state === "ready" ||
      validated.payload === undefined
    ) {
      break;
    }
    const repaired = await repairSuggestedSplitPayload({
      projectRoot: input.projectRoot,
      evidence: input.evidence,
      payload: validated.payload,
      diagnostics: validated.result.diagnostics,
    });
    if (!repaired.changed) break;
    sectionsSplit += repaired.sectionsSplit;
    for (const reason of repaired.reasons) {
      reasonCounts.set(
        reason.code,
        (reasonCounts.get(reason.code) ?? 0) + reason.sections,
      );
    }
    validated = await validateAlignPayload({
      projectRoot: input.projectRoot,
      phaseId: input.phaseId,
      phaseCollection: input.phaseCollection,
      evidence: input.evidence,
      rawPayload: repaired.payload,
      ...(input.commandInputPath !== undefined
        ? { commandInputPath: input.commandInputPath }
        : {}),
      ...(input.replace !== undefined ? { replace: input.replace } : {}),
      ...(input.includeStructureSummary === true
        ? { includeStructureSummary: true }
        : {}),
    });
  }
  if (sectionsSplit === 0) return validated;
  return {
    ...validated,
    result: {
      ...validated.result,
      self_healed: {
        kind: "suggested-splits",
        input_sections: inputSections,
        sections_split: sectionsSplit,
        output_sections: validated.payload?.views.reduce(
          (count, view) => count + view.sections.length,
          0,
        ) ?? 0,
        reasons: [...reasonCounts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([code, sections]) => ({ code, sections })),
      },
    },
  };
}

async function runAlignSupportView(input: {
  projectRoot: string;
  phase: AlignProsePhaseDefinition;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
  view: AlignView;
}): Promise<ProseAlignRunResult | undefined> {
  if (input.view === "source-mapping") {
    return sourceMapping({ phase: input.phase, evidence: input.evidence, options: input.options });
  }
  if (input.view === "existing-knowledge") {
    return existingKnowledgeView({
      projectRoot: input.projectRoot,
      phase: input.phase,
      source: input.evidence.source,
      options: input.options,
    });
  }
  if (input.view === "diagnostics") {
    const rawPayload = await readAlignInputPayload(input.options.input);
    const validated = await validateAlignPayloadWithSelfHeal({
      projectRoot: input.projectRoot,
      phaseId: input.phase.id,
      phaseCollection: input.phase.collection,
      evidence: input.evidence,
      rawPayload,
      ...(input.options.input !== undefined
        ? { commandInputPath: input.options.input }
        : {}),
    });
    return diagnosticsView({
      diagnostics: validated.result.diagnostics,
      baseCommand: alignCommand(input.phase.id, ["--view", "diagnostics", "--input", input.options.input ?? suggestedAlignPayloadPath(input.phase.id)]),
      ...(input.options.pageToken !== undefined ? { pageToken: input.options.pageToken } : {}),
      ...(input.options.pageSize !== undefined ? { pageSize: input.options.pageSize } : {}),
    });
  }
  if (input.view === "semantic-rules") {
    return semanticRulesView({
      rules: alignSemanticRules(),
      baseCommand: `context run ${input.phase.id}`,
      ...(input.options.rule !== undefined ? { ruleId: input.options.rule } : {}),
      ...(input.options.readCursor !== undefined ? { readCursor: input.options.readCursor } : {}),
      ...(input.options.pageSize !== undefined ? { pageSize: input.options.pageSize } : {}),
    });
  }
  return undefined;
}

export async function runAlignProsePhase(input: {
  projectRoot: string;
  phase: AlignProsePhaseDefinition;
  options?: ProseAlignRunOptions;
}): Promise<ProseAlignRunResult> {
  const options = input.options ?? {};
  if (options.validate !== true && options.stage !== true && options.confirm !== true) {
    const view = parseView(options.view, options.schema, input.phase.id);
    if (view === "schema" || view === "minimal") {
      const source = await loadSourceContext({
        projectRoot: input.projectRoot,
        phase: input.phase,
      });
      return schemaView({ phase: input.phase, source, view });
    }
  }
  const evidence = await loadProseEvidence({
    projectRoot: input.projectRoot,
    phase: input.phase,
  });
  if (options.validate === true || options.stage === true || options.confirm === true) {
    return runAlignPayloadWrite({
      projectRoot: input.projectRoot,
      phase: input.phase,
      evidence,
      options,
    });
  }

  const view = parseView(options.view, options.schema, input.phase.id);
  if (view === "read-plan") return readPlan({ phase: input.phase, evidence, options });
  if (view === "source-index") return sourceIndex({ phase: input.phase, evidence, options });
  if (view === "structure-summary") {
    const rawPayload = await readAlignInputPayload(options.input);
    const validated = await validateAlignPayloadWithSelfHeal({
      projectRoot: input.projectRoot,
      phaseId: input.phase.id,
      phaseCollection: input.phase.collection,
      evidence,
      rawPayload,
      includeStructureSummary: true,
      ...(options.replace !== undefined ? { replace: options.replace } : {}),
    });
    const envelope = commonEnvelope({ phase: input.phase, source: evidence.source, diagnostics: validated.result.diagnostics });
    return {
      kind: envelope.kind,
      schema_version: envelope.schema_version,
      phase_id: envelope.phase_id,
      source: envelope.source,
      collection: envelope.collection,
      payload_target: envelope.payload_target,
      document_mainline_collections: envelope.document_mainline_collections,
      view: "structure-summary",
      valid: validated.result.valid,
      error_free: validated.result.error_free,
      review_notice: validated.result.review_notice,
      structure_report: validated.result.structure_report,
      structure_summary_compact: validated.result.structure_summary_compact,
      state: validated.result.state,
      allowed_actions: envelope.allowed_actions,
      views: envelope.views,
      diagnostics: validated.result.diagnostics,
      repair_hints: validated.result.repair_hints,
      confirmation_ready: validated.result.confirmation_ready,
      confirmation_blockers: validated.result.confirmation_blockers,
      semantic_rules: envelope.semantic_rules,
      semantic_reference_files: envelope.semantic_reference_files,
      next_action: validated.result.next_action,
      structure_summary: validated.result.structure_summary,
    };
  }
  if (view === "source-bundle") return sourceBundle({ phase: input.phase, evidence, options });
  if (view === "chunks") return chunksView({ phase: input.phase, evidence, options });
  if (view === "windows") return windowsView({ phase: input.phase, evidence, options });
  if (view === "span-detail") return spanDetail({ projectRoot: input.projectRoot, phase: input.phase, evidence, options });
  if (view === "span-text") return spanText({ projectRoot: input.projectRoot, phase: input.phase, evidence, options });
  if (view === "full-text") return fullText({ phase: input.phase, evidence, options });
  const supportView = await runAlignSupportView({ projectRoot: input.projectRoot, phase: input.phase, evidence, options, view });
  if (supportView !== undefined) return supportView;
  return schemaView({ phase: input.phase, source: evidence.source, view });
}
