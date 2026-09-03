import { z } from "zod";
import {
  indexerEvidenceAdapterResultSchema,
  validateIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterResult,
} from "./indexerEvidenceAdapterResult.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  indexerParserFactViewSchema,
  validateIndexerParserFactView,
  type IndexerParserFactView,
} from "./indexerParserFactView.js";
import {
  indexerProviderManifestSchema,
  type IndexerExecution,
  type IndexerProviderManifest,
} from "./indexerProvider.js";
import {
  type IndexerProgramAuthorization,
  type ResolvedProviderBundle,
} from "./indexerProviderResolution.js";
import {
  assertIndexerCanonicalOrder,
  buildIndexerControlledInvocation,
  indexerControlledInvocationSchema,
  validateIndexerControlledInvocation,
  type IndexerControlledInvocation,
  type IndexerExecutionLimits,
  type IndexerFixedDependencySet,
} from "./indexerControlledInvocation.js";
import {
  indexerProgramRunRequestSchema,
  indexerProgramRunResultSchema,
  type IndexerProgramRunRequest,
} from "./indexerProgramRunProtocol.js";
import { validateIndexerMainRunRequest } from "./indexerMainRunProtocol.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";

const signalContractSchema = z.object({
  id: indexerIdSchema,
  kind: z.enum(["required", "supporting", "negative"]),
}).strict();

export const indexerActivationRequestSchema = z.object({
  protocol: z.literal("context.indexer.activation-request/v1"),
  invocation: indexerControlledInvocationSchema,
  input_view: indexerParserFactViewSchema,
  signals: z.array(signalContractSchema).min(1),
  signal_contract_digest: indexerDigestSchema,
  request_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.signals.map((signal) => signal.id), context, "signals");
});

export type IndexerActivationRequest = z.infer<typeof indexerActivationRequestSchema>;

const activationObservationSchema = z.object({
  signal_id: indexerIdSchema,
  state: z.enum(["present", "absent", "unknown"]),
  evidence_refs: z.array(indexerCanonicalRefSchema),
  diagnostic_code: indexerIdSchema.optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.evidence_refs, context, "evidence_refs");
  if (value.state === "present" && value.evidence_refs.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "present activation signals require evidence",
      path: ["evidence_refs"],
    });
  }
});

export const indexerActivationResultSchema = z.object({
  protocol: z.literal("context.indexer.activation-result/v1"),
  request_digest: indexerDigestSchema,
  observations: z.array(activationObservationSchema).min(1),
  result_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.observations.map((item) => item.signal_id), context, "observations");
});

export type IndexerActivationResult = z.infer<typeof indexerActivationResultSchema>;

export interface IndexerActivationReport {
  protocol: "context.indexer.activation-report/v1";
  request_digest: string;
  status: "matched" | "not-matched" | "indeterminate";
  present_signals: string[];
  absent_signals: string[];
  unknown_signals: string[];
  report_digest: string;
}

export const indexerInspectorRequestSchema = z.object({
  protocol: z.literal("context.indexer.inspector-request/v1"),
  invocation: indexerControlledInvocationSchema,
  input_view: indexerParserFactViewSchema,
  active_profiles: z.array(z.object({
    id: indexerIdSchema,
    variants: z.record(indexerIdSchema, indexerIdSchema),
  }).strict()).min(1),
  output: z.literal("provider-enrichment-facts"),
  request_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.active_profiles.map((profile) => profile.id), context, "active_profiles");
});

export type IndexerInspectorRequest = z.infer<typeof indexerInspectorRequestSchema>;

const inspectorJsonSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(inspectorJsonSchema),
    z.record(inspectorJsonSchema),
  ])
);

export const indexerInspectorFactPayloadSchema = z.object({
  profile: indexerIdSchema,
  profile_variants: z.record(indexerIdSchema, indexerIdSchema),
  source_fact_refs: z.array(indexerCanonicalRefSchema),
  template_variables: z.record(inspectorJsonSchema),
  status: z.enum([
    "available",
    "unsupported",
    "request-material",
    "enrichment-unavailable",
  ]),
  reason_code: indexerIdSchema.optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.source_fact_refs, context, "source_fact_refs");
  if (value.status === "available") {
    if (value.source_fact_refs.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available inspector projection requires source facts",
        path: ["source_fact_refs"],
      });
    }
    if (Object.keys(value.template_variables).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available inspector projection requires template variables",
        path: ["template_variables"],
      });
    }
    if (value.reason_code !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available inspector projection cannot carry an unavailable reason",
        path: ["reason_code"],
      });
    }
  } else if (value.reason_code === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "unavailable inspector projection requires a reason code",
      path: ["reason_code"],
    });
  }
});

const inspectorFactMaterializationSchema = z.object({
  fact_ref: indexerCanonicalRefSchema,
  payload: indexerInspectorFactPayloadSchema,
}).strict();

export type IndexerInspectorFactPayload = z.infer<
  typeof indexerInspectorFactPayloadSchema
>;

export const indexerInspectorResultSchema = z.object({
  protocol: z.literal("context.indexer.inspector-result/v1"),
  request_digest: indexerDigestSchema,
  capabilities: z.tuple([z.literal("provider-enrichment-facts")]),
  analyzed_file_refs: z.array(indexerCanonicalRefSchema),
  unsupported_file_refs: z.array(indexerCanonicalRefSchema),
  diagnostic_codes: z.array(indexerIdSchema),
  evidence: indexerEvidenceAdapterResultSchema,
  fact_payloads: z.array(inspectorFactMaterializationSchema),
  result_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.fact_payloads.map((item) => item.fact_ref), context, "fact_payloads");
});

export type IndexerInspectorResult = z.infer<typeof indexerInspectorResultSchema>;

export const indexerControlledProgramRequestSchema = z.object({
  protocol: z.literal("context.indexer.controlled-program-request/v1"),
  invocation: indexerControlledInvocationSchema,
  input: indexerProgramRunRequestSchema,
  request_digest: indexerDigestSchema,
}).strict();

export type IndexerControlledProgramRequest = z.infer<
  typeof indexerControlledProgramRequestSchema
>;

export const indexerControlledProgramResultSchema = z.object({
  protocol: z.literal("context.indexer.controlled-program-result/v1"),
  request_digest: indexerDigestSchema,
  output: indexerProgramRunResultSchema,
  payload_digest: indexerDigestSchema,
}).strict();

export type IndexerControlledProgramResult = z.infer<
  typeof indexerControlledProgramResultSchema
>;

function validateProgramInput(value: unknown): IndexerProgramRunRequest {
  return validateIndexerMainRunRequest(indexerProgramRunRequestSchema.parse(value));
}

interface ControlledInput {
  manifest: IndexerProviderManifest;
  bundle: ResolvedProviderBundle;
  dependencies: IndexerFixedDependencySet;
  scope: { source_ref: string; module_refs: readonly string[] };
  limits: IndexerExecutionLimits;
  project_ref: string;
  project_authorization?: IndexerProgramAuthorization;
}

function controlledInput(input: ControlledInput): Omit<ControlledInput, "project_authorization"> & {
  project_authorization?: IndexerProgramAuthorization;
} {
  return {
    ...input,
    ...(input.project_authorization === undefined
      ? {}
      : { project_authorization: input.project_authorization }),
  };
}

export function buildIndexerControlledProgramRequest(
  input: ControlledInput & { program_input: IndexerProgramRunRequest },
): IndexerControlledProgramRequest {
  const manifest = indexerProviderManifestSchema.parse(input.manifest);
  const program = manifest.provider.program;
  if (program === undefined) throw new TypeError("Provider has no controlled program resource");
  const programInput = validateProgramInput(input.program_input);
  if (!manifest.provides.operations.some((operation) => operation.id === programInput.operation)) {
    throw new TypeError(`Provider does not declare semantic operation ${programInput.operation}`);
  }
  if (programInput.final_authority.bundle_digest !== input.bundle.resolved.integrity) {
    throw new TypeError("controlled program input does not match the Provider Bundle authority");
  }
  const invocation = buildIndexerControlledInvocation({
    ...controlledInput(input),
    resource: "program",
    execution: program.execution,
    capabilities: program.capabilities,
  });
  const base = {
    protocol: "context.indexer.controlled-program-request/v1" as const,
    invocation,
    input: programInput,
  };
  return indexerControlledProgramRequestSchema.parse({
    ...base,
    request_digest: indexerProtocolDigest(base),
  });
}

export function buildProjectLocalIndexerControlledProgramRequest(
  input: ControlledInput & {
    execution: IndexerExecution;
    capabilities: readonly IndexerControlledInvocation["capabilities"][number][];
    program_content_digest: string;
    program_input: IndexerProgramRunRequest;
  },
): IndexerControlledProgramRequest {
  const manifest = indexerProviderManifestSchema.parse(input.manifest);
  const programInput = validateProgramInput(input.program_input);
  if (!manifest.provides.operations.some((operation) => operation.id === programInput.operation)) {
    throw new TypeError(`Provider does not declare semantic operation ${programInput.operation}`);
  }
  if (
    programInput.final_authority.bundle_digest !== input.bundle.resolved.integrity ||
    programInput.final_authority.customization_fingerprint === null
  ) {
    throw new TypeError("project-local program input requires its applied customization authority");
  }
  const invocation = buildIndexerControlledInvocation({
    ...controlledInput(input),
    resource: "program",
    execution: input.execution,
    capabilities: input.capabilities,
    local_program: {
      path: input.execution.entry,
      content_digest: input.program_content_digest,
    },
  });
  const base = {
    protocol: "context.indexer.controlled-program-request/v1" as const,
    invocation,
    input: programInput,
  };
  return indexerControlledProgramRequestSchema.parse({
    ...base,
    request_digest: indexerProtocolDigest(base),
  });
}

export function validateIndexerControlledProgramRequest(
  value: unknown,
): IndexerControlledProgramRequest {
  const request = indexerControlledProgramRequestSchema.parse(value);
  validateIndexerControlledInvocation(request.invocation);
  validateProgramInput(request.input);
  if (request.invocation.resource !== "program") {
    throw new TypeError("controlled program request uses a non-program invocation");
  }
  const base = {
    protocol: request.protocol,
    invocation: request.invocation,
    input: request.input,
  };
  if (indexerProtocolDigest(base) !== request.request_digest) {
    throw new TypeError("controlled program request digest is invalid");
  }
  return request;
}

export function validateIndexerControlledProgramResult(input: {
  request: unknown;
  result: unknown;
}): { request: IndexerControlledProgramRequest; result: IndexerControlledProgramResult } {
  const request = validateIndexerControlledProgramRequest(input.request);
  const result = indexerControlledProgramResultSchema.parse(input.result);
  if (
    result.request_digest !== request.request_digest ||
    result.output.operation !== request.input.operation ||
    result.output.result.execution_request_digest !== request.input.execution_request_digest
  ) {
    throw new TypeError("controlled program Result does not match its exact input");
  }
  const expected = indexerProtocolDigest({
    protocol: result.protocol,
    request_digest: result.request_digest,
    output: result.output,
  });
  if (result.payload_digest !== expected) {
    throw new TypeError("controlled program Result payload digest is invalid");
  }
  return { request, result };
}

function activationSignals(manifest: IndexerProviderManifest): IndexerActivationRequest["signals"] {
  return [
    ...manifest.activation.required_signals.map(({ id }) => ({ id, kind: "required" as const })),
    ...manifest.activation.supporting_signals.map(({ id }) => ({ id, kind: "supporting" as const })),
    ...manifest.activation.negative_signals.map(({ id }) => ({ id, kind: "negative" as const })),
  ].sort((left, right) => compareIndexerCanonicalText(left.id, right.id));
}

export function buildIndexerActivationRequest(input: ControlledInput & {
  input_view: IndexerParserFactView;
}): IndexerActivationRequest {
  const manifest = indexerProviderManifestSchema.parse(input.manifest);
  const detector = manifest.activation.detector;
  if (detector === undefined) throw new TypeError("Provider has no activation detector");
  const invocation = buildIndexerControlledInvocation({
    ...controlledInput(input),
    resource: "activation-detector",
    execution: detector.execution,
    capabilities: detector.capabilities,
  });
  const inputView = validateIndexerParserFactView(input.input_view);
  assertInputViewScope(invocation, inputView);
  const signals = activationSignals(manifest);
  const base = {
    protocol: "context.indexer.activation-request/v1" as const,
    invocation,
    input_view: inputView,
    signals,
    signal_contract_digest: indexerProtocolDigest(signals),
  };
  return indexerActivationRequestSchema.parse({
    ...base,
    request_digest: indexerProtocolDigest(base),
  });
}

function assertInputViewScope(
  invocation: IndexerControlledInvocation,
  inputView: IndexerParserFactView,
): void {
  if (
    inputView.authorized_scope.source_ref !== invocation.authorized_scope.source_ref ||
    inputView.authorized_scope.scope_digest !== invocation.authorized_scope.scope_digest ||
    inputView.authorized_scope.module_refs.length !== invocation.authorized_scope.module_refs.length ||
    inputView.authorized_scope.module_refs.some((ref, index) =>
      ref !== invocation.authorized_scope.module_refs[index]
    )
  ) {
    throw new TypeError("parser fact input view does not match the controlled invocation scope");
  }
}

export function validateIndexerActivationRequest(value: unknown): IndexerActivationRequest {
  const request = indexerActivationRequestSchema.parse(value);
  validateIndexerControlledInvocation(request.invocation);
  const inputView = validateIndexerParserFactView(request.input_view);
  assertInputViewScope(request.invocation, inputView);
  if (request.invocation.resource !== "activation-detector") {
    throw new TypeError("activation request uses a non-detector invocation");
  }
  if (request.signal_contract_digest !== indexerProtocolDigest(request.signals)) {
    throw new TypeError("activation signal contract digest is invalid");
  }
  const base = {
    protocol: request.protocol,
    invocation: request.invocation,
    input_view: request.input_view,
    signals: request.signals,
    signal_contract_digest: request.signal_contract_digest,
  };
  if (request.request_digest !== indexerProtocolDigest(base)) {
    throw new TypeError("activation request digest is invalid");
  }
  return request;
}

export function validateIndexerActivationResult(input: {
  request: unknown;
  result: unknown;
}): { result: IndexerActivationResult; report: IndexerActivationReport } {
  const request = validateIndexerActivationRequest(input.request);
  const result = indexerActivationResultSchema.parse(input.result);
  const expectedSignals = request.signals.map((signal) => signal.id);
  const actualSignals = result.observations.map((item) => item.signal_id);

  assertIndexerCanonicalOrder(actualSignals, "activation observations");
  result.observations.forEach((observation) => {
    assertIndexerCanonicalOrder(
      observation.evidence_refs,
      `${observation.signal_id}.evidence_refs`,
    );
  });
  const inputEvidence = new Set(request.input_view.files.flatMap((file) => [
    file.file_ref,
    ...file.facts.map((fact) => fact.fact_ref),
  ]));
  for (const observation of result.observations) {
    const unknownEvidence = observation.evidence_refs.find((ref) => !inputEvidence.has(ref));
    if (unknownEvidence !== undefined) {
      throw new TypeError(`activation Result references evidence outside its input view: ${unknownEvidence}`);
    }
  }
  if (
    result.request_digest !== request.request_digest ||
    expectedSignals.length !== actualSignals.length ||
    expectedSignals.some((signal, index) => signal !== actualSignals[index])
  ) {
    throw new TypeError("activation Result does not close the declared signal contract");
  }
  const expectedResultDigest = indexerProtocolDigest({
    protocol: result.protocol,
    request_digest: result.request_digest,
    observations: result.observations,
  });
  if (result.result_digest !== expectedResultDigest) {
    throw new TypeError("activation Result digest is invalid");
  }
  const byId = new Map(result.observations.map((item) => [item.signal_id, item]));
  const negativePresent = request.signals.some((signal) =>
    signal.kind === "negative" && byId.get(signal.id)?.state === "present"
  );
  const requiredAbsent = request.signals.some((signal) =>
    signal.kind === "required" && byId.get(signal.id)?.state === "absent"
  );
  const unresolvedAuthority = request.signals.some((signal) =>
    (signal.kind === "required" || signal.kind === "negative") &&
    byId.get(signal.id)?.state === "unknown"
  );
  const status = negativePresent || requiredAbsent
    ? "not-matched" as const
    : unresolvedAuthority
      ? "indeterminate" as const
      : "matched" as const;
  const reportBase = {
    protocol: "context.indexer.activation-report/v1" as const,
    request_digest: request.request_digest,
    status,
    present_signals: actualSignals.filter((id) => byId.get(id)?.state === "present"),
    absent_signals: actualSignals.filter((id) => byId.get(id)?.state === "absent"),
    unknown_signals: actualSignals.filter((id) => byId.get(id)?.state === "unknown"),
  };
  return {
    result,
    report: { ...reportBase, report_digest: indexerProtocolDigest(reportBase) },
  };
}

export function buildIndexerInspectorRequest(input: ControlledInput & {
  input_view: IndexerParserFactView;
  active_profiles: readonly {
    id: string;
    variants: Readonly<Record<string, string>>;
  }[];
}): IndexerInspectorRequest {
  const manifest = indexerProviderManifestSchema.parse(input.manifest);
  const inspector = manifest.authoring_inspector;
  if (inspector === undefined) throw new TypeError("Provider has no authoring inspector");
  const invocation = buildIndexerControlledInvocation({
    ...controlledInput(input),
    resource: "authoring-inspector",
    execution: inspector.execution,
    capabilities: inspector.capabilities,
  });
  const inputView = validateIndexerParserFactView(input.input_view);
  assertInputViewScope(invocation, inputView);
  const activeProfiles = input.active_profiles.map((profile) => ({
    id: profile.id,
    variants: Object.fromEntries(
      Object.entries(profile.variants).sort(([left], [right]) =>
        compareIndexerCanonicalText(left, right)
      ),
    ),
  })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id));
  const providedProfiles = new Set(manifest.provides.profiles);
  for (const profile of activeProfiles) {
    if (!providedProfiles.has(profile.id)) {
      throw new TypeError(`inspector profile ${profile.id} is not provided by this layer`);
    }
    const extension = manifest.composition?.extensions.find((candidate) =>
      candidate.profile === profile.id
    );
    const axes = extension?.variant_schema?.axes ?? [];
    const axisById = new Map(axes.map((axis) => [axis.id, axis]));
    for (const [axisId, value] of Object.entries(profile.variants)) {
      const axis = axisById.get(axisId);
      if (axis === undefined || !axis.values.includes(value)) {
        throw new TypeError(`inspector profile ${profile.id} has an unsupported variant`);
      }
    }
    const missing = axes.find((axis) =>
      axis.required && profile.variants[axis.id] === undefined
    );
    if (missing !== undefined) {
      throw new TypeError(`inspector profile ${profile.id} is missing variant ${missing.id}`);
    }
  }
  const base = {
    protocol: "context.indexer.inspector-request/v1" as const,
    invocation,
    input_view: inputView,
    active_profiles: activeProfiles,
    output: inspector.output,
  };
  return indexerInspectorRequestSchema.parse({
    ...base,
    request_digest: indexerProtocolDigest(base),
  });
}

export function validateIndexerInspectorRequest(value: unknown): IndexerInspectorRequest {
  const request = indexerInspectorRequestSchema.parse(value);
  validateIndexerControlledInvocation(request.invocation);
  const inputView = validateIndexerParserFactView(request.input_view);
  assertInputViewScope(request.invocation, inputView);
  const base = {
    protocol: request.protocol,
    invocation: request.invocation,
    input_view: request.input_view,
    active_profiles: request.active_profiles,
    output: request.output,
  };
  if (
    request.invocation.resource !== "authoring-inspector" ||
    request.request_digest !== indexerProtocolDigest(base)
  ) {
    throw new TypeError("inspector request contract is invalid");
  }
  assertIndexerCanonicalOrder(
    request.active_profiles.map((profile) => profile.id),
    "active_profiles",
  );
  for (const profile of request.active_profiles) {
    assertIndexerCanonicalOrder(Object.keys(profile.variants), `${profile.id}.variants`);
  }
  return request;
}

function exactDerivedRefs(
  actual: readonly string[],
  expected: readonly string[],
  field: string,
): void {
  assertIndexerCanonicalOrder(actual, field);
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new TypeError(`${field} does not match the Evidence Adapter Result`);
  }
}

export function validateIndexerInspectorResult(input: {
  request: unknown;
  result: unknown;
}): {
  result: IndexerInspectorResult;
  evidence: IndexerEvidenceAdapterResult;
  fact_payloads: IndexerInspectorResult["fact_payloads"];
} {
  const request = validateIndexerInspectorRequest(input.request);
  const inputFileRefs = request.input_view.files.map((file) => file.file_ref);
  const result = indexerInspectorResultSchema.parse(input.result);
  const evidence = validateIndexerEvidenceAdapterResult(result.evidence);
  if (
    result.request_digest !== request.request_digest ||
    evidence.input_digest !== request.request_digest ||
    evidence.authorized_scope.source_ref !== request.invocation.authorized_scope.source_ref ||
    evidence.authorized_scope.scope_digest !== request.invocation.authorized_scope.scope_digest ||
    evidence.authorized_scope.module_refs.length !==
      request.invocation.authorized_scope.module_refs.length ||
    evidence.authorized_scope.module_refs.some((ref, index) =>
      ref !== request.invocation.authorized_scope.module_refs[index]
    )
  ) {
    throw new TypeError("inspector Result does not match its exact request and scope");
  }
  const inventory = new Set(inputFileRefs);
  for (const file of evidence.files) {
    if (!inventory.has(file.file_ref)) throw new TypeError("inspector Result contains an unknown file");
    if (
      file.role !== "enricher" ||
      file.coverage_tier !== "lightweight-evidence" ||
      file.facts.some((fact) => fact.denominator !== "none")
    ) {
      throw new TypeError("inspector Result cannot own baseline inventory or denominators");
    }
  }
  const evidenceFileRefs = evidence.files.map((file) => file.file_ref)
    .sort(compareIndexerCanonicalText);
  if (
    evidenceFileRefs.length !== inputFileRefs.length ||
    evidenceFileRefs.some((ref, index) => ref !== inputFileRefs[index])
  ) {
    throw new TypeError("inspector Result must close every requested inventory identity");
  }
  const analyzed = evidence.files.filter((file) => file.disposition === "analyzed")
    .map((file) => file.file_ref).sort(compareIndexerCanonicalText);
  const unsupported = evidence.files.filter((file) => file.disposition === "unsupported")
    .map((file) => file.file_ref).sort(compareIndexerCanonicalText);
  const diagnostics = evidence.diagnostics.map((item) => item.code)
    .sort(compareIndexerCanonicalText);
  exactDerivedRefs(result.analyzed_file_refs, analyzed, "analyzed_file_refs");
  exactDerivedRefs(result.unsupported_file_refs, unsupported, "unsupported_file_refs");
  exactDerivedRefs(result.diagnostic_codes, diagnostics, "diagnostic_codes");
  assertIndexerCanonicalOrder(
    result.fact_payloads.map((item) => item.fact_ref),
    "fact_payloads",
  );
  const evidenceFacts = new Map(
    evidence.files.flatMap((file) => file.facts.map((fact) => [fact.fact_ref, fact] as const)),
  );
  if (evidenceFacts.size !== result.fact_payloads.length) {
    throw new TypeError("inspector fact payloads must close every enrichment fact");
  }
  const inputFactRefs = new Set(
    request.input_view.files.flatMap((file) => file.facts.map((fact) => fact.fact_ref)),
  );
  const activeProfiles = new Map(
    request.active_profiles.map((profile) => [profile.id, profile.variants] as const),
  );
  for (const item of result.fact_payloads) {
    const fact = evidenceFacts.get(item.fact_ref);
    if (
      fact === undefined ||
      fact.payload_digest !== indexerProtocolDigest(item.payload)
    ) {
      throw new TypeError(`inspector fact payload does not match ${item.fact_ref}`);
    }
    const expectedVariants = activeProfiles.get(item.payload.profile);
    if (expectedVariants === undefined) {
      throw new TypeError("inspector projection targets an inactive profile");
    }
    for (const [axisId, value] of Object.entries(expectedVariants)) {
      if (item.payload.profile_variants[axisId] !== value) {
        throw new TypeError("inspector projection variant drifted from the active Registry profile");
      }
    }
    for (const sourceFactRef of item.payload.source_fact_refs) {
      if (!inputFactRefs.has(sourceFactRef)) {
        throw new TypeError("inspector projection references a fact outside its input View");
      }
    }
  }
  const expectedDigest = indexerProtocolDigest({
    protocol: result.protocol,
    request_digest: result.request_digest,
    capabilities: result.capabilities,
    analyzed_file_refs: result.analyzed_file_refs,
    unsupported_file_refs: result.unsupported_file_refs,
    diagnostic_codes: result.diagnostic_codes,
    evidence: result.evidence,
    fact_payloads: result.fact_payloads,
  });
  if (result.result_digest !== expectedDigest) {
    throw new TypeError("inspector Result digest is invalid");
  }
  return { result, evidence, fact_payloads: result.fact_payloads };
}
