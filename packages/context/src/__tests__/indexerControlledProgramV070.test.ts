import { describe, expect, test } from "bun:test";
import {
  buildIndexerActivationRequest,
  buildIndexerControlledProgramRequest,
  buildIndexerFixedDependencySet,
  buildIndexerInspectorRequest,
  buildIndexerInspectorWorksetViewSource,
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerParserFactView,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  buildIndexerProgramExecutionAuthorizationReport,
  buildProjectLocalIndexerControlledProgramRequest,
  buildProjectLocalIndexerProgramExecutionAuthorizationReport,
  authorizeIndexerProgramExecution,
  composeIndexerLayerInput,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterOutputDigest,
  indexerPartitionPlanCanonicalHash,
  indexerPartitionStrategySetDigest,
  indexerProtocolDigest,
  indexerProviderBundleIntegrity,
  indexerProviderManifestSchema,
  resolvedProviderBundleSchema,
  resolvedProviderReceiptDigest,
  validateIndexerActivationResult,
  validateIndexerControlledProgramRequest,
  validateIndexerControlledProgramResult,
  validateIndexerFixedDependencySet,
  validateIndexerInspectorResult,
  type IndexerActivationResult,
  type IndexerControlledProgramResult,
  type IndexerEvidenceAdapterResult,
  type IndexerInspectorResult,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerProviderManifest,
  type ResolvedProviderBundle,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const FILES = [
  { path: "context-indexer.yaml", digest: digest("a") },
  { path: "scripts/detect.mjs", digest: digest("b") },
  { path: "scripts/index.mjs", digest: digest("c") },
  { path: "scripts/inspect.mjs", digest: digest("d") },
] as const;
const BUNDLE_DIGEST = indexerProviderBundleIntegrity(FILES);
const SOURCE_REF = "repo:sample";
const MODULE_REF = "module:app";
const FILE_REF = indexerEvidenceAdapterFileRef({
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  normalized_path: "src/index.ts",
});

function manifest(): IndexerProviderManifest {
  return indexerProviderManifestSchema.parse({
    protocol: "context.indexer.provider/v1",
    id: "context-indexer-sample",
    version: "1.2.0",
    domains: ["code"],
    activation: {
      target_kinds: ["package"],
      required_signals: [{ id: "source-present", description: "Source exists." }],
      supporting_signals: [{ id: "public-entry", description: "Public entry exists." }],
      negative_signals: [{ id: "generated-only", description: "Only generated files exist." }],
      detector: {
        execution: { runtime: "node", entry: "scripts/detect.mjs", args: [] },
        protocol: "context.indexer.activation/v1",
        capabilities: ["parser-facts.read"],
        optional: true,
      },
    },
    provides: {
      profiles: ["component-library"],
      operations: [{
        id: "main-index",
        consumes: "context.indexer.main-workset/v2",
        produces: "context.indexer.main-result/v1",
      }],
    },
    authoring_inspector: {
      execution: { runtime: "node", entry: "scripts/inspect.mjs", args: [] },
      protocol: "context.indexer.inspector/v1",
      capabilities: ["parser-facts.read"],
      output: "provider-enrichment-facts",
    },
    provider: {
      program: {
        execution: { runtime: "node", entry: "scripts/index.mjs", args: ["--format=json"] },
        protocol: "context.indexer.program/v1",
        capabilities: ["source.read", "parser-facts.read", "indexer-result.write"],
      },
    },
  });
}

function bundle(trust: ResolvedProviderBundle["resolved"]["trust"] = "first-party") {
  const value: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: "component-library",
      provider_id: "community",
      skill: "context-indexer-sample",
      version: "1.2.0",
      distribution: {
        kind: "cli-bundled",
        locator: "cli-bundled://context/context-indexer-sample",
      },
    },
    resolved: {
      integrity: BUNDLE_DIGEST,
      manifest_digest: digest("a"),
      issuer: "context4ai/context",
      trust,
    },
    transport: {
      kind: "directory",
      path: "/tmp/context-indexer-sample",
      expires_at: "2026-08-28T12:00:00.000Z",
    },
    files: [...FILES],
    receipt: {
      resolver: "context-cli/0.7.0",
      resolved_at: "2026-08-27T12:00:00.000Z",
      authority_ref: "cli-release-manifest:indexer-bundles",
      receipt_digest: digest("f"),
    },
  };
  value.receipt.receipt_digest = resolvedProviderReceiptDigest(value);
  return resolvedProviderBundleSchema.parse(value);
}

const DEPENDENCIES = buildIndexerFixedDependencySet([{
  package: "@c4a/context",
  version: "0.7.0-preview.1",
  lock_integrity: "sha512-QUJD",
  resolved_digest: digest("1"),
}]);
const LIMITS = {
  timeout_ms: 30_000,
  max_stdin_bytes: 1024 * 1024,
  max_stdout_bytes: 4 * 1024 * 1024,
  max_stderr_bytes: 256 * 1024,
};
const CONTROL = {
  manifest: manifest(),
  bundle: bundle(),
  dependencies: DEPENDENCIES,
  scope: { source_ref: SOURCE_REF, module_refs: [MODULE_REF] },
  limits: LIMITS,
  project_ref: "project:sample",
};

const PRIMARY_EXECUTION_PROJECTION = buildIndexerPrimaryExecutionProjection({
  indexer_id: "component-library",
  primary_registry_projection_digest: digest("3"),
  program_digest: BUNDLE_DIGEST,
  instructions_digest: digest("4"),
  template_set_digest: digest("5"),
  config_digest: digest("f"),
  cli_contract_digest: digest("7"),
  profile_contract_digest: digest("6"),
  resources: [{
    layer_ref: "provider:sample#layer:primary",
    phase: "primary",
    kind: "program",
    ref: "bundle:sample/scripts/index.mjs",
    digest: digest("c"),
  }],
});

function partitionRequest(customizationFingerprint: string | null = null) {
  const strategy = {
    kind: "project-indexer" as const,
    indexer_id: "component-library",
    strategy_id: "component-family",
    implementation_digest: digest("2"),
  };
  const workset = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: "component-library",
    requirement_ref: "requirement:public-knowledge",
    owner_cell_refs: ["owner-cell:public-knowledge#public-contract"],
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    primary_registry_projection_digest: digest("3"),
    requirement_set_digest: digest("4"),
    primary_execution_fingerprint:
      PRIMARY_EXECUTION_PROJECTION.primary_execution_fingerprint,
    profile_contract_digest: digest("6"),
    subject_key_schema_digest: digest("7"),
    source_scope_digest: digest("8"),
    source_binding_digest: digest("9"),
    primary_resource_binding_digest:
      PRIMARY_EXECUTION_PROJECTION.primary_resource_binding_digest,
    question_target_inventory_digest: digest("a"),
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "sample",
      kind: "component-library",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest([{
      strategy_ref: strategy,
      strategy_digest: digest("b"),
    }]),
    reader_question_refs: ["question:public-contract"],
    partition_input_digests: [digest("c")],
    partition_inventory_digest: digest("d"),
    allowed_question_target_refs: ["question-target:public-contract"],
  });
  if (workset.stage !== "partition") throw new Error("expected partition workset");
  const authority = {
    layer_ref: "provider:sample#layer:primary",
    integrity: digest("e"),
    bundle_digest: BUNDLE_DIGEST,
    config_fingerprint: digest("f"),
    customization_fingerprint: customizationFingerprint,
  };
  return {
    request: buildIndexerMainRunRequest({
      workset,
      partition_strategy_attempt: {
        strategy_order: 0,
        strategy_ref: strategy,
        strategy_digest: digest("b"),
        previous_attempt_digest: null,
      },
      composition_input: composeIndexerLayerInput({
        workset_digest: workset.workset_digest,
        final_authority_layer_ref: authority.layer_ref,
        fragments: [],
      }),
      final_authority: authority,
      run_environment: buildIndexerRunEnvironment({
        source_snapshot_digest: digest("1"),
        source_dependency_fingerprint: workset.source_binding_digest,
        source_role: "authoritative-source",
        source_precedence_digest: digest("3"),
        metric_set_digest: digest("4"),
        dependency_view_digest: null,
        primary_execution_projection: PRIMARY_EXECUTION_PROJECTION,
      }),
    }),
    workset,
    strategy,
  };
}

function partitionPlan(input: {
  workset: IndexerMainPartitionWorkset;
  strategy: ReturnType<typeof partitionRequest>["strategy"];
}): IndexerPartitionPlan {
  type CompletePlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
  const base: Omit<CompletePlan, "canonical_hash"> = {
    protocol: "context.indexer.partition-plan/v1",
    status: "complete",
    binding: {
      partition_workset_digest: input.workset.workset_digest,
      indexer_id: input.workset.indexer_id,
      indexer_fingerprint: input.workset.primary_execution_fingerprint,
      requirement_digest: input.workset.requirement_set_digest,
      subject_key_schema_digest: input.workset.subject_key_schema_digest,
      source_scope_digest: input.workset.source_scope_digest,
      source_refs: [SOURCE_REF],
      module_ref: MODULE_REF,
      partition_subject_key: input.workset.partition_subject_key,
      parent_scope_ref: MODULE_REF,
      inventory_digest: input.workset.partition_inventory_digest,
      question_target_inventory_digest: input.workset.question_target_inventory_digest,
    },
    strategy_ref: input.strategy,
    strategy_digest: digest("b"),
    unit_type: "component-family",
    partition_axis: "canonical-export-root",
    reader_question_refs: input.workset.reader_question_refs,
    groups: [],
    member_dispositions: [],
    failure: null,
  };
  return { ...base, canonical_hash: indexerPartitionPlanCanonicalHash(base) };
}

function activationResult(
  request: ReturnType<typeof buildIndexerActivationRequest>,
  states: Record<string, "present" | "absent" | "unknown">,
): IndexerActivationResult {
  const observations = request.signals.map((signal) => ({
    signal_id: signal.id,
    state: states[signal.id] ?? "unknown",
    evidence_refs: states[signal.id] === "present" ? [FILE_REF] : [],
  }));
  const base = {
    protocol: "context.indexer.activation-result/v1" as const,
    request_digest: request.request_digest,
    observations,
  };
  return { ...base, result_digest: indexerProtocolDigest(base) };
}

function parserFactView(factPayload?: Record<string, string>) {
  const scope = {
    source_ref: SOURCE_REF,
    module_refs: [MODULE_REF],
    scope_digest: indexerProtocolDigest({
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
    }),
  };
  const base: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: {
      id: "sample-parser",
      package: "@example/sample-parser",
      export: "parse",
      version: "1.2.0",
      digest: digest("1"),
    },
    authorized_scope: scope,
    input_digest: digest("2"),
    precedence: 10,
    files: [{
      file_ref: FILE_REF,
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: "src/index.ts",
      role: "primary-owner",
      coverage_tier: "ast-catalog",
      disposition: "analyzed",
      facts: factPayload === undefined ? [] : (() => {
        const locator = {
          source_ref: SOURCE_REF,
          module_ref: MODULE_REF,
          normalized_path: "src/index.ts",
          qualified_item_path: "src/index.ts#component-library",
          signature_digest: digest("5"),
        };
        return [{
          fact_ref: indexerEvidenceAdapterFactRef({ ...locator, kind: "config-value" }),
          kind: "config-value",
          locator,
          payload_digest: indexerProtocolDigest(factPayload),
          denominator: "none" as const,
        }];
      })(),
    }],
    diagnostics: [],
    toolchain: [{
      step: "parse-source",
      package: "@example/sample-parser",
      export: "parse",
      version: "1.2.0",
      digest: digest("1"),
      capabilities: ["parser.typescript"],
      input_digest: digest("2"),
      output_digest: digest("3"),
    }],
  };
  const result = { ...base, output_digest: indexerEvidenceAdapterOutputDigest(base) };
  return buildIndexerParserFactView({
    adapter_results: [result],
    fact_payloads: factPayload === undefined ? [] : [{
      fact_ref: result.files[0]!.facts[0]!.fact_ref,
      payload: factPayload,
    }],
    inventory_digest: digest("4"),
  });
}

function inspectorEvidence(
  request: ReturnType<typeof buildIndexerInspectorRequest>,
  role: "primary-owner" | "enricher" = "enricher",
): IndexerEvidenceAdapterResult {
  const base: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: {
      id: "sample-inspector",
      package: "@example/sample-inspector",
      export: "inspect",
      version: "1.2.0",
      digest: digest("1"),
    },
    authorized_scope: request.invocation.authorized_scope,
    input_digest: request.request_digest,
    precedence: 20,
    files: [{
      file_ref: FILE_REF,
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: "src/index.ts",
      role,
      coverage_tier: "lightweight-evidence",
      disposition: "analyzed",
      facts: [],
    }],
    diagnostics: [],
    toolchain: [{
      step: "inspect-source",
      package: "@example/sample-inspector",
      export: "inspect",
      version: "1.2.0",
      digest: digest("1"),
      capabilities: ["provider-enrichment-facts"],
      input_digest: request.request_digest,
      output_digest: digest("2"),
    }],
  };
  return { ...base, output_digest: indexerEvidenceAdapterOutputDigest(base) };
}

function inspectorResult(
  request: ReturnType<typeof buildIndexerInspectorRequest>,
  evidence = inspectorEvidence(request),
): IndexerInspectorResult {
  const base = {
    protocol: "context.indexer.inspector-result/v1" as const,
    request_digest: request.request_digest,
    capabilities: ["provider-enrichment-facts"] as ["provider-enrichment-facts"],
    analyzed_file_refs: [FILE_REF],
    unsupported_file_refs: [],
    diagnostic_codes: [],
    evidence,
    fact_payloads: [],
  };
  return { ...base, result_digest: indexerProtocolDigest(base) };
}

describe("controlled Indexer program and structured tools", () => {
  test("binds exact dependencies, policy, scope, program input, and output", () => {
    expect(validateIndexerFixedDependencySet(DEPENDENCIES)).toEqual(DEPENDENCIES);
    const { request: runRequest, workset, strategy } = partitionRequest();
    const request = buildIndexerControlledProgramRequest({
      ...CONTROL,
      program_input: runRequest,
    });
    expect(validateIndexerControlledProgramRequest(request)).toEqual(request);
    expect(request.invocation).toMatchObject({
      resource: "program",
      environment: "empty",
      shell: false,
      authorization: { level: "trusted-program", sandboxed_program: false },
    });
    const output = {
      protocol: "context.indexer.run-result/v1" as const,
      operation: "main-index" as const,
      consumed_input_view_digest: runRequest.composition_input.view_digest,
      workset_read_receipt_digests: [digest("6")],
      result: {
        protocol: "context.indexer.main-result/v1" as const,
        stage: "partition" as const,
        workset_digest: workset.workset_digest,
        execution_request_digest: runRequest.execution_request_digest,
        result: partitionPlan({ workset, strategy }),
      },
    };
    const base = {
      protocol: "context.indexer.controlled-program-result/v1" as const,
      request_digest: request.request_digest,
      output,
    };
    const result: IndexerControlledProgramResult = {
      ...base,
      payload_digest: indexerProtocolDigest(base),
    };
    expect(validateIndexerControlledProgramResult({ request, result }).result).toEqual(result);
  });

  test("rejects floating/forged dependencies, untrusted execution, and stale program output", () => {
    expect(() => buildIndexerFixedDependencySet([{
      package: "@c4a/context",
      version: "latest",
      lock_integrity: "sha512-QUJD",
      resolved_digest: digest("1"),
    }])).toThrow();
    const forgedDependencies = structuredClone(DEPENDENCIES);
    forgedDependencies.dependencies[0]!.resolved_digest = digest("9");
    expect(() => validateIndexerFixedDependencySet(forgedDependencies)).toThrow(/digest/);

    const runRequest = partitionRequest().request;
    expect(() => buildIndexerControlledProgramRequest({
      ...CONTROL,
      bundle: bundle("untrusted"),
      program_input: runRequest,
    })).toThrow(/no exact project authorization/);

    const request = buildIndexerControlledProgramRequest({ ...CONTROL, program_input: runRequest });
    const forged = structuredClone(request);
    forged.input.execution_request_digest = digest("8");
    expect(() => validateIndexerControlledProgramRequest(forged)).toThrow(/digest/);
  });

  test("binds project authorization to capabilities, dependencies, scope, and policy", () => {
    const untrustedBundle = bundle("project-authorized");
    const report = buildIndexerProgramExecutionAuthorizationReport({
      project_ref: CONTROL.project_ref,
      manifest: CONTROL.manifest,
      bundle: untrustedBundle,
      dependency_set_digest: DEPENDENCIES.dependency_set_digest,
      scope_digest: indexerProtocolDigest(CONTROL.scope),
      limits: LIMITS,
    });
    const authorization = authorizeIndexerProgramExecution({
      report,
      authority_ref: "authority:indexer-program-execution",
      authority_scope_digest: digest("5"),
    });
    const runRequest = partitionRequest().request;
    expect(() => buildIndexerControlledProgramRequest({
      ...CONTROL,
      bundle: untrustedBundle,
      project_authorization: authorization,
      program_input: runRequest,
    })).not.toThrow();
    expect(() => buildIndexerControlledProgramRequest({
      ...CONTROL,
      bundle: untrustedBundle,
      scope: { source_ref: SOURCE_REF, module_refs: ["module:other"] },
      project_authorization: authorization,
      program_input: runRequest,
    })).toThrow(/no exact project authorization/);
    expect(() => buildIndexerControlledProgramRequest({
      ...CONTROL,
      bundle: untrustedBundle,
      limits: { ...LIMITS, timeout_ms: LIMITS.timeout_ms + 1 },
      project_authorization: authorization,
      program_input: runRequest,
    })).toThrow(/no exact project authorization/);
  });

  test("runs an exact authorized project-local program without inheriting Provider trust", () => {
    const localPath = "src/indexer/component-library/index.ts";
    const localContentDigest = digest("6");
    const execution = { runtime: "node" as const, entry: localPath, args: [] };
    const capabilities = ["source.read", "indexer-result.write"] as const;
    const scopeDigest = indexerProtocolDigest(CONTROL.scope);
    const report = buildProjectLocalIndexerProgramExecutionAuthorizationReport({
      project_ref: CONTROL.project_ref,
      base_manifest: CONTROL.manifest,
      base_bundle: CONTROL.bundle,
      program_path: localPath,
      program_content_digest: localContentDigest,
      execution,
      capabilities: [...capabilities],
      dependency_set_digest: DEPENDENCIES.dependency_set_digest,
      scope_digest: scopeDigest,
      limits: LIMITS,
    });
    const authorization = authorizeIndexerProgramExecution({
      report,
      authority_ref: "authority:indexer-program-execution",
      authority_scope_digest: digest("7"),
    });
    const request = buildProjectLocalIndexerControlledProgramRequest({
      ...CONTROL,
      execution,
      capabilities,
      program_content_digest: localContentDigest,
      project_authorization: authorization,
      program_input: partitionRequest(digest("8")).request,
    });
    expect(request.invocation).toMatchObject({
      resource: "program",
      program: {
        origin: "project-local",
        path: localPath,
        content_digest: localContentDigest,
        program_digest: report.program.program_digest,
      },
      authorization: {
        trust_basis: "project-authorized-exact-digest",
        sandboxed_program: false,
      },
    });
    expect(() => buildProjectLocalIndexerControlledProgramRequest({
      ...CONTROL,
      execution,
      capabilities,
      program_content_digest: digest("9"),
      project_authorization: authorization,
      program_input: partitionRequest(digest("8")).request,
    })).toThrow(/no exact project authorization/);
  });

  test("derives activation only from a complete declared signal result", () => {
    const request = buildIndexerActivationRequest({
      ...CONTROL,
      input_view: parserFactView(),
    });
    expect(validateIndexerActivationResult({
      request,
      result: activationResult(request, {
        "source-present": "present",
        "public-entry": "absent",
        "generated-only": "absent",
      }),
    }).report.status).toBe("matched");
    expect(validateIndexerActivationResult({
      request,
      result: activationResult(request, {
        "source-present": "present",
        "public-entry": "unknown",
        "generated-only": "unknown",
      }),
    }).report.status).toBe("indeterminate");
    expect(validateIndexerActivationResult({
      request,
      result: activationResult(request, {
        "source-present": "present",
        "public-entry": "present",
        "generated-only": "present",
      }),
    }).report.status).toBe("not-matched");

    const incomplete = activationResult(request, {});
    incomplete.observations.pop();
    incomplete.result_digest = indexerProtocolDigest({
      protocol: incomplete.protocol,
      request_digest: incomplete.request_digest,
      observations: incomplete.observations,
    });
    expect(() => validateIndexerActivationResult({ request, result: incomplete })).toThrow(
      /close the declared signal contract/,
    );
  });

  test("accepts inspector enrichment but rejects denominator ownership and scope drift", () => {
    const request = buildIndexerInspectorRequest({
      ...CONTROL,
      input_view: parserFactView(),
      active_profiles: [{ id: "component-library", variants: {} }],
    });
    const result = inspectorResult(request);
    expect(validateIndexerInspectorResult({ request, result }).evidence).toEqual(result.evidence);

    const owner = inspectorResult(request, inspectorEvidence(request, "primary-owner"));
    owner.result_digest = indexerProtocolDigest({
      protocol: owner.protocol,
      request_digest: owner.request_digest,
      capabilities: owner.capabilities,
      analyzed_file_refs: owner.analyzed_file_refs,
      unsupported_file_refs: owner.unsupported_file_refs,
      diagnostic_codes: owner.diagnostic_codes,
      evidence: owner.evidence,
      fact_payloads: owner.fact_payloads,
    });
    expect(() => validateIndexerInspectorResult({ request, result: owner })).toThrow(
      /cannot own baseline inventory/,
    );

    const fakeAst = inspectorResult(request);
    fakeAst.evidence.files[0]!.coverage_tier = "ast-catalog";
    const evidencePayload = { ...fakeAst.evidence };
    Reflect.deleteProperty(evidencePayload, "output_digest");
    fakeAst.evidence.output_digest = indexerEvidenceAdapterOutputDigest(evidencePayload);
    fakeAst.result_digest = indexerProtocolDigest({
      protocol: fakeAst.protocol,
      request_digest: fakeAst.request_digest,
      capabilities: fakeAst.capabilities,
      analyzed_file_refs: fakeAst.analyzed_file_refs,
      unsupported_file_refs: fakeAst.unsupported_file_refs,
      diagnostic_codes: fakeAst.diagnostic_codes,
      evidence: fakeAst.evidence,
      fact_payloads: fakeAst.fact_payloads,
    });
    expect(() => validateIndexerInspectorResult({ request, result: fakeAst })).toThrow(
      /cannot own baseline inventory/,
    );

    const stale = inspectorResult(request);
    stale.evidence.input_digest = digest("7");
    expect(() => validateIndexerInspectorResult({ request, result: stale })).toThrow();
  });

  test("projects validated inspector values through the shared workset View and rejects variant drift", () => {
    const inputView = parserFactView({ framework: "sample", mode: "library" });
    const request = buildIndexerInspectorRequest({
      ...CONTROL,
      input_view: inputView,
      active_profiles: [{ id: "component-library", variants: {} }],
    });
    const sourceFactRef = inputView.files[0]!.facts[0]!.fact_ref;
    const payload = {
      profile: "component-library",
      profile_variants: {},
      source_fact_refs: [sourceFactRef],
      template_variables: { mode: "library" },
      status: "available" as const,
    };
    const locator = {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: "src/index.ts",
      qualified_item_path: "src/index.ts#provider-profile:component-library",
      signature_digest: indexerProtocolDigest(payload),
    };
    const enrichmentFact = {
      fact_ref: indexerEvidenceAdapterFactRef({
        ...locator,
        kind: "sample-provider-profile",
      }),
      kind: "sample-provider-profile",
      locator,
      payload_digest: indexerProtocolDigest(payload),
      denominator: "none" as const,
    };
    const evidence = inspectorEvidence(request);
    evidence.files[0]!.facts = [enrichmentFact];
    const evidencePayload = { ...evidence };
    Reflect.deleteProperty(evidencePayload, "output_digest");
    evidence.output_digest = indexerEvidenceAdapterOutputDigest(evidencePayload);
    const result = inspectorResult(request, evidence);
    result.fact_payloads = [{ fact_ref: enrichmentFact.fact_ref, payload }];
    result.result_digest = indexerProtocolDigest({
      protocol: result.protocol,
      request_digest: result.request_digest,
      capabilities: result.capabilities,
      analyzed_file_refs: result.analyzed_file_refs,
      unsupported_file_refs: result.unsupported_file_refs,
      diagnostic_codes: result.diagnostic_codes,
      evidence: result.evidence,
      fact_payloads: result.fact_payloads,
    });
    const runRequest = partitionRequest().request;
    const source = buildIndexerInspectorWorksetViewSource({
      request: runRequest,
      inspector_request: request,
      inspector_result: result,
    });
    expect(source.projection_kind).toBe("provider-enrichment");
    expect(source.items[0]).toMatchObject({
      ref: enrichmentFact.fact_ref,
      category: "provider-enrichment",
      value: payload,
    });

    result.fact_payloads[0]!.payload.profile = "other-profile";
    result.evidence.files[0]!.facts[0]!.payload_digest = indexerProtocolDigest(
      result.fact_payloads[0]!.payload,
    );
    const driftedEvidencePayload = { ...result.evidence };
    Reflect.deleteProperty(driftedEvidencePayload, "output_digest");
    result.evidence.output_digest = indexerEvidenceAdapterOutputDigest(
      driftedEvidencePayload,
    );
    result.result_digest = indexerProtocolDigest({
      protocol: result.protocol,
      request_digest: result.request_digest,
      capabilities: result.capabilities,
      analyzed_file_refs: result.analyzed_file_refs,
      unsupported_file_refs: result.unsupported_file_refs,
      diagnostic_codes: result.diagnostic_codes,
      evidence: result.evidence,
      fact_payloads: result.fact_payloads,
    });
    expect(() => validateIndexerInspectorResult({ request, result })).toThrow(
      /inactive profile/,
    );
  });
});
