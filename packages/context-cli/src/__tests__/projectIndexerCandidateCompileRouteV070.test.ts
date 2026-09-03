import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerArtifactBundle,
  buildIndexerAuthorDependencyView,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerLayoutProposalSet,
  buildIndexerLayoutTransition,
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  buildIndexerWorksetReadReceipt,
  buildIndexerWorksetReadRequest,
  buildIndexerWorksetReadResponse,
  canonicalIndexerNodeRef,
  composeIndexerLayerInput,
  indexerArtifactResultDigest,
  indexerCapabilityGroupMemberIdsDigest,
  indexerEvidenceBindingDigest,
  indexerInventoryMembersDigest,
  indexerProtocolDigest,
  resolveIndexerLayout,
  resolveIndexerSubjectKeySchemas,
  type IndexerArtifactPolicyEligibility,
  type IndexerArtifactResult,
  type IndexerMainAuthorWorkset,
  type IndexerSubjectKey,
} from "@c4a/context";
import { loadContextWorkflowProvider } from "../project/workflow/workflowProvider.js";
import {
  INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
  buildProjectIndexerCandidateCompileFromRecords,
  compileProjectIndexerCandidates,
  readProjectIndexerCandidateCompileStatus,
} from
  "../project/indexerCandidateCompileActions.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash, candidateSetHash } from "../project/reviewShared.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { closeProjectWorkspace } from "../project/close.js";
import { reportProjectIndexerIncrementalImpact } from
  "../project/indexerIncrementalImpactActions.js";
import { loadCliIndexerBaseContracts } from
  "../project/indexerCliBundledProvider.js";
import {
  acceptIndexerMainRunStore,
  prepareIndexerMainRunStore,
  readAcceptedIndexerMainAuthorResultRecords,
  startIndexerMainRunStore,
} from "../project/indexerMainRunStore.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const PACKAGE_ROOT = join(import.meta.dir, "../..");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SOURCE_REF = "repo:anonymous-components@revision";
const MODULE_REF = "module:components";
const MEMBER_REF = "member:toggle";
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "anonymous-components",
  kind: "component",
  local_key: "toggle",
};

function artifactPolicyEligibility(): IndexerArtifactPolicyEligibility {
  const payload: Omit<IndexerArtifactPolicyEligibility, "eligibility_digest"> = {
    protocol: "context.indexer.artifact-policy-eligibility/v1",
    profile_id: "component-library",
    profile_contract_digest: digest("1"),
    operator_contract_digest: digest("2"),
    canonical_facts: [],
    provider_supported_variants: ["standard"],
    eligible_variants: [{
      id: "standard",
      required_artifact_kinds: ["content"],
      discretionary_artifact_kinds: [],
      thresholds: [{
        metric_id: "discretionary-artifact-count",
        metric_operator: "discretionary-artifact-count",
        unit: "count",
        recommended_max: 2,
        hard_max: 4,
      }],
    }],
  };
  return { ...payload, eligibility_digest: indexerProtocolDigest(payload) };
}

function acceptedAuthorFixture(input: {
  candidatePoolDigest?: string;
  includeUsageSection?: boolean;
} = {}) {
  const eligibility = artifactPolicyEligibility();
  const evidenceNode = {
    kind: "source-span" as const,
    evidence_ref: "evidence:anonymous-toggle-source",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    locator: { path: "src/toggle.ts", start_line: 1, end_line: 1 },
    content_digest: digest("1"),
    targets: [],
  };
  const logicalUnitRef = canonicalIndexerNodeRef(SUBJECT);
  const dependencyView = buildIndexerAuthorDependencyView({
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    logical_unit_ref: logicalUnitRef,
    positive_nodes: [evidenceNode, {
      kind: "logical-unit",
      logical_unit_ref: logicalUnitRef,
      group_projection_digest: digest("c"),
      targets: [{ level: "logical-unit" }],
    }],
    negative_nodes: [{
      kind: "group-input-set",
      scope_ref: logicalUnitRef,
      set_digest: indexerInventoryMembersDigest([{
        member_id: MEMBER_REF,
        member_kind: "component",
      }]),
      targets: [{ level: "logical-unit" }],
    }, {
      kind: "candidate-pool",
      scope_ref: "candidate-pool:toggle-summary",
      set_digest: input.candidatePoolDigest ?? digest("6"),
      targets: [{
        level: "section",
        artifact_kind: "content",
        section_key: "summary",
      }],
    }],
  });
  const primaryExecutionProjection = buildIndexerPrimaryExecutionProjection({
    indexer_id: "component-indexer",
    primary_registry_projection_digest: digest("3"),
    program_digest: null,
    instructions_digest: digest("e"),
    template_set_digest: digest("f"),
    config_digest: digest("0"),
    cli_contract_digest: digest("1"),
    profile_contract_digest: eligibility.profile_contract_digest,
    resources: [{
      layer_ref: "provider:anonymous#layer:primary",
      phase: "primary",
      kind: "instructions",
      ref: "bundle:anonymous/instructions/main.md",
      digest: digest("e"),
    }],
  });
  const builtWorkset = buildIndexerMainWorkset({
    stage: "author",
    indexer_id: "component-indexer",
    requirement_ref: "requirement:anonymous-knowledge",
    owner_cell_refs: ["owner-cell:anonymous-knowledge#public-surface"],
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    primary_registry_projection_digest: digest("3"),
    requirement_set_digest: digest("4"),
    primary_execution_fingerprint:
      primaryExecutionProjection.primary_execution_fingerprint,
    profile_contract_digest: eligibility.profile_contract_digest,
    subject_key_schema_digest: digest("6"),
    source_scope_digest: digest("7"),
    source_binding_digest: digest("8"),
    primary_resource_binding_digest:
      primaryExecutionProjection.primary_resource_binding_digest,
    question_target_inventory_digest: digest("a"),
    partition_plan_binding_digest: digest("b"),
    group_key: "component:toggle",
    logical_unit_ref: logicalUnitRef,
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest([MEMBER_REF]),
    member_inventory_digest: indexerInventoryMembersDigest([{
      member_id: MEMBER_REF,
      member_kind: "component",
    }]),
    group_projection_digest: digest("c"),
    group_dependency_view_digest: dependencyView.view_digest,
    allowed_artifact_policy_variants: ["standard"],
    artifact_policy_eligibility_digest: eligibility.eligibility_digest,
  });
  if (builtWorkset.stage !== "author") throw new Error("expected author workset");
  const workset: IndexerMainAuthorWorkset = builtWorkset;
  const authority = {
    layer_ref: "provider:anonymous#layer:primary",
    integrity: digest("e"),
    bundle_digest: digest("f"),
    config_fingerprint: digest("0"),
    customization_fingerprint: null,
  };
  const request = buildIndexerMainRunRequest({
    workset,
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: authority.layer_ref,
      fragments: [],
    }),
    final_authority: authority,
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("2"),
      source_dependency_fingerprint: workset.source_binding_digest,
      source_role: "authoritative-source",
      source_precedence_digest: digest("4"),
      metric_set_digest: digest("5"),
      dependency_view_digest: dependencyView.view_digest,
      primary_execution_projection: primaryExecutionProjection,
    }),
  });
  const readRequest = buildIndexerWorksetReadRequest({
    workset_digest: workset.workset_digest,
    read_kind: "source",
    requested_refs: [SOURCE_REF],
    allowed_refs: [SOURCE_REF],
    page_size: 10,
  });
  const readResponse = buildIndexerWorksetReadResponse({
    request: readRequest,
    items: [{ ref: SOURCE_REF, value: { content: "export const Toggle = true" } }],
  });
  const receipt = buildIndexerWorksetReadReceipt({
    request: readRequest,
    responses: [readResponse],
  });
  const evidencePayload = {
    evidence_ref: evidenceNode.evidence_ref,
    kind: "code" as const,
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    locator: evidenceNode.locator,
    content_digest: evidenceNode.content_digest,
    coverage_tier: "ast-catalog" as const,
  };
  const evidence = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
  const artifactPayload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: workset.workset_digest,
    partition_plan_binding_digest: workset.partition_plan_binding_digest,
    group_projection_digest: workset.group_projection_digest,
    indexer_id: workset.indexer_id,
    provider_layer_ref: authority.layer_ref,
    provider_integrity: authority.integrity,
    provider_bundle_digest: authority.bundle_digest,
    config_fingerprint: authority.config_fingerprint,
    customization_fingerprint: null,
    requirement_ref: workset.requirement_ref,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: workset.group_key,
      subject_key: SUBJECT,
      logical_unit_ref: workset.logical_unit_ref,
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: [MEMBER_REF],
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      dispositions: [{
        member_id: MEMBER_REF,
        member_kind: "component",
        inventory_disposition: "owned",
        projection_disposition: "detailed",
        section_evidence: [{
          artifact_id: "toggle-content",
          section_key: "summary",
          evidence_refs: [evidence.evidence_ref],
        }, ...(input.includeUsageSection === true ? [{
          artifact_id: "toggle-content",
          section_key: "usage",
          evidence_refs: [evidence.evidence_ref],
        }] : [])],
      }],
    }),
    facts: [],
    evidence_bindings: [evidence],
    artifacts: [{
      artifact_id: "toggle-content",
      artifact_kind: "content",
      artifact_policy_variant: "standard",
      representation: "sections",
      sections: [{
        section_key: "summary",
        owner_indexer_id: workset.indexer_id,
        document_kind: "code-reference",
        reader_goal: "understand-capability",
        artifact_kind: "content",
        blocks: [{
          block_id: "summary-block",
          layer: "semantic-prose",
          markdown: "# Toggle\n\nAn anonymous component capability.",
          evidence_refs: [evidence.evidence_ref],
        }],
      }, ...(input.includeUsageSection === true ? [{
        section_key: "usage",
        owner_indexer_id: workset.indexer_id,
        document_kind: "code-reference",
        reader_goal: "use-capability",
        artifact_kind: "content",
        blocks: [{
          block_id: "usage-block",
          layer: "semantic-prose" as const,
          markdown: "Use the anonymous component capability.",
          evidence_refs: [evidence.evidence_ref],
        }],
      }] : [])],
    }],
    artifact_bundle: buildIndexerArtifactBundle({
      logical_unit_ref: workset.logical_unit_ref,
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "toggle-content",
        artifact_kind: "content",
        purpose: "required",
        reader_question_refs: ["question:public-capability"],
        evidence_refs: [evidence.evidence_ref],
      }],
    }),
    material_question_proposals: [],
    question_target_dispositions: [],
    diagnostics: [],
    input_digest: request.execution_request_digest,
  };
  const artifact = {
    ...artifactPayload,
    output_digest: indexerArtifactResultDigest(artifactPayload),
  };
  return {
    workset,
    artifact,
    dependencyView,
    request,
    receipt,
    spec: {
      protocol: "context.indexer.main-run-spec/v1",
      request,
      validation: {
        stage: "author",
        dependency_view: dependencyView,
        expected_subject_key: SUBJECT,
        artifact_policy_eligibility: eligibility,
        allowed_source_roles: ["authoritative-source"],
        allowed_question_targets: [{
          question_target_key: "question-target:public-capability",
          question_ref: "question:public-capability",
        }],
      },
    },
    result: {
      protocol: "context.indexer.run-result/v1",
      operation: "main-index",
      consumed_input_view_digest: request.composition_input.view_digest,
      workset_read_receipt_digests: [receipt.receipt_digest],
      result: {
        protocol: "context.indexer.main-result/v1",
        stage: "author",
        workset_digest: workset.workset_digest,
        execution_request_digest: request.execution_request_digest,
        result: artifact,
      },
    },
  };
}

describe("Indexer Candidate compile Route", () => {
  test("publishes one explicit Result-bound compile entrypoint", async () => {
    const provider = await loadContextWorkflowProvider();
    const graph = provider.graphs.get("indexer")?.definition;
    expect(graph?.entrypoints["candidate-compile"]).toBe("compile-indexer-candidates");
    expect(graph?.nodes.some((node) => node.id === "compile-indexer-candidates"))
      .toBe(true);
    expect(graph?.nodes.some((node) => node.id === "indexer-candidates-compiled"))
      .toBe(true);
    expect(graph?.entrypoints["incremental-impact"]).toBe(
      "report-indexer-incremental-impact",
    );
    expect(graph?.nodes.some((node) =>
      node.id === "indexer-incremental-impact-reported"
    )).toBe(true);

    const [actionRaw, schemaRaw, source, impactActionRaw] = await Promise.all([
      readFile(join(
        PACKAGE_ROOT,
        "context-workflow/actions/compile-indexer-candidates.yaml",
      ), "utf8"),
      readFile(join(
        PACKAGE_ROOT,
        "context-workflow/schemas/indexer-candidate-compile-input.schema.json",
      ), "utf8"),
      readFile(join(PACKAGE_ROOT, "src/project/indexerCandidateCompileActions.ts"), "utf8"),
      readFile(join(
        PACKAGE_ROOT,
        "context-workflow/actions/report-indexer-incremental-impact.yaml",
      ), "utf8"),
    ]);
    const action = YAML.parse(actionRaw) as Record<string, unknown>;
    const schema = JSON.parse(schemaRaw) as { required?: string[] };
    expect(action).toMatchObject({
      runner: "command",
      effect: "write",
      command: expect.stringContaining("compile-indexer-candidates"),
    });
    expect(schema.required).toContain("accepted_result_refs");
    expect(schema.required).toContain("layout_transition");
    expect(source).toContain("readAcceptedIndexerMainAuthorResultRecords");
    expect(source).not.toMatch(/default[_ -]?plan|alignProse|compileProse|MarkdownCollectionSlice/u);
    expect(YAML.parse(impactActionRaw)).toMatchObject({
      runner: "command",
      effect: "read",
      command: expect.stringContaining("report-indexer-incremental-impact"),
    });
  });

  test("reports exact Merkle impact from the durable accepted author store", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-incremental-impact-"));
    try {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await Promise.all([
        writeFile(join(projectRoot, "package.json"), `${JSON.stringify({
          name: "anonymous-incremental-impact-fixture",
          private: true,
          context: { project: true, entry: "src/index.ts" },
        }, null, 2)}\n`, "utf8"),
        writeFile(join(projectRoot, "src", "index.ts"), "export {};\n", "utf8"),
      ]);
      const previous = acceptedAuthorFixture({ includeUsageSection: true });
      await prepareIndexerMainRunStore({
        projectRoot,
        workset_set: buildIndexerMainWorksetSet([previous.workset]),
        run_specs: [previous.spec],
      });
      await startIndexerMainRunStore({
        projectRoot,
        workset_digest: previous.workset.workset_digest,
      });
      await acceptIndexerMainRunStore({
        projectRoot,
        workset_digest: previous.workset.workset_digest,
        result: previous.result,
        workset_read_receipts: [previous.receipt],
      });
      const records = await readAcceptedIndexerMainAuthorResultRecords(projectRoot);
      const accepted = records[0]!.accepted_record as { acceptance_digest: string };
      const current = acceptedAuthorFixture({
        candidatePoolDigest: digest("7"),
        includeUsageSection: true,
      });
      const value = {
        protocol: "context.indexer.incremental-impact-input/v1",
        current_runs: [{
          previous_acceptance_digest: accepted.acceptance_digest,
          current_request: current.request,
          current_dependency_view: current.dependencyView,
        }],
      };
      const inputPath = join(projectRoot, "incremental-impact-input.json");
      await writeFile(inputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      const result = JSON.parse(await runCliInDir(projectRoot, [
        "indexer",
        "report-indexer-incremental-impact",
        "--input",
        inputPath,
        "--format",
        "json",
      ])) as Awaited<ReturnType<typeof reportProjectIndexerIncrementalImpact>>;
      expect(result).toMatchObject({
        protocol: "context.indexer.incremental-impact-report-set/v1",
        outcome: "indexer-incremental-impact-reported",
        graph_outcome: "completed",
        stale_logical_unit_count: 1,
        stale_artifact_count: 1,
        stale_section_count: 1,
        recompute_required: true,
      });
      expect(result.reports[0]?.dependency_changes).toEqual([
        expect.objectContaining({
          kind: "candidate-pool",
          change: "changed",
          affected_sections: [{
            artifact_id: "toggle-content",
            section_key: "summary",
          }],
        }),
      ]);
      expect(result.reports[0]?.artifacts[0]?.sections).toEqual([
        { section_key: "summary", state: "stale", changed_node_refs: expect.any(Array) },
        { section_key: "usage", state: "current", changed_node_refs: [] },
      ]);
      expect(JSON.stringify(result)).not.toContain(projectRoot);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects a caller-supplied Result ref that is absent from the accepted store", () => {
    expect(() => buildProjectIndexerCandidateCompileFromRecords({
      value: {
        protocol: "context.indexer.candidate-compile-input/v1",
        accepted_result_refs: [{
          workset_digest: digest("1"),
          execution_request_digest: digest("2"),
          acceptance_digest: digest("3"),
          artifact_result_digest: digest("4"),
        }],
        subject_key_schema_set: {},
        layout_proposal_set: {},
        layout_transition: {},
        layout_change_confirmations: [],
        rendered_artifacts: [],
      },
      records: [],
      operator_contract: {},
      profile_contract: {},
    })).toThrow(/exact current accepted Result set/);
  });

  test("compiles the durable accepted author store into one audited Candidate record", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-candidate-compile-"));
    try {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await Promise.all([
        writeFile(join(projectRoot, "package.json"), `${JSON.stringify({
          name: "anonymous-candidate-compile-fixture",
          private: true,
          context: { project: true, entry: "src/index.ts" },
        }, null, 2)}\n`, "utf8"),
        writeFile(join(projectRoot, "src", "index.ts"), "export {};\n", "utf8"),
      ]);
      const fixture = acceptedAuthorFixture();
      await prepareIndexerMainRunStore({
        projectRoot,
        workset_set: buildIndexerMainWorksetSet([fixture.workset]),
        run_specs: [fixture.spec],
      });
      await startIndexerMainRunStore({
        projectRoot,
        workset_digest: fixture.workset.workset_digest,
      });
      await acceptIndexerMainRunStore({
        projectRoot,
        workset_digest: fixture.workset.workset_digest,
        result: fixture.result,
        workset_read_receipts: [fixture.receipt],
      });
      const records = await readAcceptedIndexerMainAuthorResultRecords(projectRoot);
      expect(records).toHaveLength(1);
      const accepted = records[0]!.accepted_record as {
        workset_digest: string;
        execution_request_digest: string;
        acceptance_digest: string;
      };
      const contracts = await loadCliIndexerBaseContracts();
      const subjectKeySchemaSet = resolveIndexerSubjectKeySchemas({
        profile_contract: contracts.profiles,
        operator_contract: contracts.operators,
        selections: [{
          indexer_id: fixture.artifact.indexer_id,
          profile: "component-library",
          role: "primary",
          provider_layer_id: "primary",
        }],
        providers: [],
      });
      const proposal = resolveIndexerLayout({
        artifact_result: fixture.artifact,
        profile: "component-library",
        profile_contract: contracts.profiles,
        operator_contract: contracts.operators,
        subject_key_schema_set: subjectKeySchemaSet,
        shared_artifact_fingerprint:
          fixture.request.run_environment.primary_execution_projection
            .shared_artifact_fingerprint,
      });
      const layoutProposalSet = buildIndexerLayoutProposalSet([proposal]);
      const layoutTransition = buildIndexerLayoutTransition({
        layout_proposal_set: layoutProposalSet,
        base_projections: [],
      });
      const value = {
        protocol: "context.indexer.candidate-compile-input/v1",
        accepted_result_refs: [{
          workset_digest: accepted.workset_digest,
          execution_request_digest: accepted.execution_request_digest,
          acceptance_digest: accepted.acceptance_digest,
          artifact_result_digest: fixture.artifact.output_digest,
        }],
        subject_key_schema_set: subjectKeySchemaSet,
        layout_proposal_set: layoutProposalSet,
        layout_transition: layoutTransition,
        layout_change_confirmations: [],
        rendered_artifacts: [],
      };
      const inputPath = join(projectRoot, "candidate-compile-input.json");
      await writeFile(inputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      const result = JSON.parse(await runCliInDir(projectRoot, [
        "indexer",
        "compile-indexer-candidates",
        "--input",
        inputPath,
        "--format",
        "json",
      ])) as Awaited<ReturnType<typeof compileProjectIndexerCandidates>>;
      expect(result).toMatchObject({
        protocol: "context.indexer.candidate-compile-action/v1",
        outcome: "indexer-candidates-compiled",
        graph_outcome: "completed",
        compile: {
          protocol: "context.indexer.candidate-compile/v1",
          physical_artifact_audit: { state: "passed" },
        },
      });
      expect(result.compile.files).toHaveLength(1);
      expect(result.compile.files[0]).toMatchObject({
        indexer_id: fixture.artifact.indexer_id,
        artifact_result_digest: fixture.artifact.output_digest,
        markdown: "# Toggle\n\nAn anonymous component capability.",
      });
      const persisted = JSON.parse(await readFile(
        join(projectRoot, INDEXER_CANDIDATE_COMPILE_CURRENT_PATH),
        "utf8",
      ));
      expect(persisted.compile_digest).toBe(result.compile.compile_digest);
      const candidates = await readCandidateRecords(projectRoot);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        candidate_type: "indexer-artifact",
        status: "draft",
        fingerprint: result.compile.files[0]!.file_digest,
        node_ref: result.compile.files[0]!.node_ref,
        view_ref: result.compile.files[0]!.internal_view_ref,
        source_refs: [SOURCE_REF],
      });
      expect(candidates[0]!.source_refs).not.toContain(
        fixture.artifact.evidence_bindings[0]!.evidence_ref,
      );
      expect(await readProjectIndexerCandidateCompileStatus(projectRoot))
        .toMatchObject({ state: "current", candidates: [{ status: "draft" }] });

      expect(await applyReviewDecisions({
        projectRoot,
        payload: {
          collection: result.compile.files[0]!.collection,
          scope: {
            kind: "collection",
            collection: result.compile.files[0]!.collection,
            count: 1,
            ids_sha256: candidateIdsHash([candidates[0]!.candidate_id]),
            candidates_sha256: candidateSetHash(candidates),
          },
          decisions: [{
            candidate_id: candidates[0]!.candidate_id,
            status: "approved",
          }],
        },
      })).toMatchObject({ approved: 1, materialized: 1 });
      const approved = await readFile(
        join(projectRoot, result.compile.files[0]!.output_path),
        "utf8",
      );
      expect(approved).toContain(`view_ref: ${result.compile.files[0]!.internal_view_ref}`);
      expect(approved).toContain(`source_ref="${SOURCE_REF}"`);
      expect(approved).not.toContain("indexer_evidence:");
      expect(approved).not.toContain(fixture.artifact.evidence_bindings[0]!.evidence_ref);
      for (const field of [
        "candidate_fingerprint",
        "indexer_compile_digest",
        "indexer_file_digest",
        "indexer_artifact_ref",
        "indexer_section_refs",
        "indexer_source_ref",
      ]) {
        expect(approved).not.toMatch(new RegExp(`^${field}:`, "mu"));
      }
      expect(await readProjectIndexerCandidateCompileStatus(projectRoot))
        .toMatchObject({ state: "current", candidates: [] });
      expect((await verifyProjectWorkspace(projectRoot)).issues.filter((issue) =>
        issue.severity === "error"
      )).toEqual([]);
      expect(await closeProjectWorkspace(projectRoot)).toMatchObject({
        action: "closed",
        nodes: 1,
        views: 1,
      });
      const compactApproved = await readFile(
        join(projectRoot, result.compile.files[0]!.output_path),
        "utf8",
      );
      for (const field of [
        "node_ref",
        "view_ref",
        "node_type",
        "sources",
        "candidate_fingerprint",
        "indexer_compile_digest",
        "indexer_file_digest",
        "indexer_artifact_ref",
        "indexer_section_refs",
        "indexer_source_ref",
      ]) {
        expect(compactApproved).not.toMatch(new RegExp(`^${field}:`, "mu"));
      }
      expect(compactApproved).not.toMatch(/^tags:/mu);
      expect(YAML.parse(await readFile(
        join(projectRoot, "knowledge", "structure.yaml"),
        "utf8",
      ))).toMatchObject({
        nodes: [{ node_ref: result.compile.files[0]!.node_ref }],
        views: [{
          view_ref: result.compile.files[0]!.internal_view_ref,
          collection: result.compile.files[0]!.collection,
          sources: [SOURCE_REF],
        }],
      });
      const closedStructure = YAML.parse(await readFile(
        join(projectRoot, "knowledge", "structure.yaml"),
        "utf8",
      )) as {
        source_inputs?: unknown;
        views?: Array<{ machine?: Record<string, unknown> }>;
      };
      expect(closedStructure.source_inputs).toBeUndefined();
      expect(closedStructure.views?.[0]?.machine?.candidate_fingerprint).toBeUndefined();
      expect(await readProjectIndexerCandidateCompileStatus(projectRoot))
        .toMatchObject({ state: "current", candidates: [] });

      await writeFile(
        join(projectRoot, "src", "indexers.yaml"),
        "protocol: context.indexer.registry/v1\nrequirements: []\nindexers: []\n",
        "utf8",
      );
      expect(await readProjectIndexerCandidateCompileStatus(projectRoot)).toMatchObject({
        state: "stale",
        candidates: [],
        diagnostic: "Accepted author Results do not bind the current requirement set.",
      });
      await rm(join(projectRoot, "src", "indexers.yaml"));
      expect(await readProjectIndexerCandidateCompileStatus(projectRoot))
        .toMatchObject({ state: "current", candidates: [] });

      await rm(join(projectRoot, result.compile.files[0]!.output_path));
      expect(await readProjectIndexerCandidateCompileStatus(projectRoot))
        .toMatchObject({ state: "stale", candidates: [] });

      const stale = structuredClone(value);
      stale.accepted_result_refs[0]!.acceptance_digest = digest("f");
      await expect(compileProjectIndexerCandidates({ projectRoot, value: stale }))
        .rejects.toThrow(/exact current accepted Result set/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses one universal explicit customization-required outcome", async () => {
    const [routeSource, markdownSource, proposalSkill, graphRaw] = await Promise.all([
      readFile(join(PACKAGE_ROOT, "../context/src/indexerProviderRouting.ts"), "utf8"),
      readFile(join(PACKAGE_ROOT, "src/project/indexerMarkdownProviderRoute.ts"), "utf8"),
      readFile(join(
        PACKAGE_ROOT,
        "context-workflow/skills/propose-indexer-customization/SKILL.md",
      ), "utf8"),
      readFile(join(PACKAGE_ROOT, "context-workflow/graphs/indexer.yaml"), "utf8"),
    ]);
    expect(routeSource).toContain('outcome: "indexer-customization-required"');
    expect(markdownSource).toContain('outcome: "indexer-customization-required"');
    expect(proposalSkill).toContain("`indexer-customization-required`");
    expect(graphRaw).toContain("id: indexer-customization-required");
    expect(graphRaw).not.toMatch(/compile-next|default[_ -]?plan|alignProse|compileProse/u);
    expect(`${routeSource}\n${markdownSource}\n${proposalSkill}`).not.toContain(
      'outcome: "indexer-capability-gap"',
    );
  });
});
