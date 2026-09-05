import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerArtifactBundle,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  canonicalIndexerNodeRef,
  indexerArtifactResultDigest,
  indexerEvidenceBindingDigest,
  indexerPartitionPlanCanonicalHash,
  indexerRegistryDigests,
  type IndexerArtifactResult,
  type IndexerInventoryMember,
  type IndexerMainAuthorWorkset,
  type IndexerPartitionPlan,
  type IndexerRegistry,
  type IndexerSubjectKey,
} from "@c4a/context";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import {
  buildProjectIndexerMainAuthorWorksets,
  buildProjectIndexerMainPartitionWorksets,
  buildProjectIndexerQuestionTargetInventory,
} from "../project/indexerMainLifecycleActions.js";
import { capturedDocumentIndexerRef } from
  "../project/indexerWorksetEvidenceProjection.js";
import {
  acceptIndexerMainRunStore,
  prepareIndexerMainRunStore,
  readAcceptedIndexerMainAuthorResultRecords,
  startIndexerMainRunStore,
} from "../project/indexerMainRunStore.js";
import {
  acceptedCachePath,
  currentLedger,
  currentSpec,
  readJsonMaybe,
  validateAcceptedCache,
  type MainRunSpec,
} from "../project/indexerMainRunStoreRecords.js";
import { prepareAndStartNextIndexerBatch } from "../project/indexerCurrentBatch.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function markdownRegistry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "documentation",
      reader_goals: ["understand-docs"],
      coverage_domains: {
        "business-semantics": "required",
        operations: "required",
      },
      target_scope: { targets: [{ source_ref: "file:docs", module_refs: [] }] },
      evidence_source_scope: {
        targets: [{ source_ref: "file:docs", module_refs: [] }],
      },
    }],
    indexers: [{
      id: "technical-guide",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "documentation",
        coverage_domains: ["business-semantics", "operations"],
        owned_scope: { ref: "requirement:documentation#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:documentation#target_scope"] },
      profile: { primary: { id: "technical-guide", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-markdown-indexer",
        version: "0.7.0",
        integrity: digest("f"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-markdown-indexer",
        },
      }],
    }],
  };
}

interface MarkdownFixtureFile {
  path: string;
  bytes: string;
  title: string;
}

async function writeMarkdownSnapshot(input: {
  root: string;
  files: readonly MarkdownFixtureFile[];
  capturedAt: string;
}): Promise<void> {
  const sourceRoot = join(input.root, "sources", "file", "docs");
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all(input.files.map((file) =>
    writeFile(join(sourceRoot, file.path), file.bytes, "utf8")
  ));
  await writeFile(join(sourceRoot, "manifest.json"), `${JSON.stringify(
    createDocumentSnapshotManifest({
      sourceType: "file",
      sourceName: "docs",
      capturedAt: input.capturedAt,
      files: input.files,
    }),
    null,
    2,
  )}\n`, "utf8");
}

async function markdownProject(
  files: readonly MarkdownFixtureFile[] = [{
    path: "guide.md",
    bytes: "# Guide\n\nCaptured knowledge.\n",
    title: "Guide",
  }],
): Promise<{ root: string; requirementDigest: string }> {
  const root = await mkdtemp(join(tmpdir(), "context-markdown-author-reuse-"));
  const current = markdownRegistry();
  const bundle = (await listCliBundledIndexers()).bundles.find((candidate) =>
    candidate.skill === "context-markdown-indexer"
  );
  if (bundle === undefined) throw new Error("missing CLI-bundled Markdown Indexer");
  Object.assign(current.indexers[0]!.providers[0]!, {
    version: bundle.version,
    integrity: bundle.integrity,
    distribution: bundle.distribution,
  });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "sources", "file"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "markdown-author-reuse-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(current), "utf8");
  await writeFile(join(root, "sources", "file", "index.yaml"), [
    "sources:",
    "  - name: docs",
    "    snapshot:",
    "      manifest: sources/file/docs/manifest.json",
    "",
  ].join("\n"), "utf8");
  await writeMarkdownSnapshot({ root, files, capturedAt: "2026-09-02T00:00:00.000Z" });
  return {
    root,
    requirementDigest: indexerRegistryDigests(current).requirementSetDigest,
  };
}

function authorResultFixture(spec: MainRunSpec) {
  const workset = spec.request.workset as IndexerMainAuthorWorkset;
  const validation = spec.validation as {
    dependency_view: { positive_nodes: Array<{
      kind: string;
      evidence_ref?: string;
      source_ref?: string;
      module_ref?: string | null;
      locator?: { path: string; start_line: number; end_line: number };
      content_digest?: string;
    }> };
    canonical_inventory_members: Array<{ member_id: string; member_kind: "document" }>;
    expected_subject_key: unknown;
    artifact_policy_eligibility: { eligible_variants: Array<{
      id: string;
      required_artifact_kinds: string[];
    }> };
    allowed_artifact_intents: Array<{
      source_role: string;
      document_kind: string;
      reader_goal: string;
      artifact_kind: string;
    }>;
  };
  const sourceSpan = validation.dependency_view.positive_nodes.find((node) =>
    node.kind === "source-span"
  );
  if (
    sourceSpan?.evidence_ref === undefined ||
    sourceSpan.source_ref === undefined ||
    sourceSpan.module_ref === undefined ||
    sourceSpan.locator === undefined ||
    sourceSpan.content_digest === undefined
  ) throw new Error("author fixture requires one source span");
  const variant = validation.artifact_policy_eligibility.eligible_variants.find((candidate) =>
    workset.allowed_artifact_policy_variants.includes(candidate.id)
  );
  const artifactKind = variant?.required_artifact_kinds[0];
  const intent = validation.allowed_artifact_intents.find((candidate) =>
    candidate.artifact_kind === artifactKind
  );
  if (variant === undefined || artifactKind === undefined || intent === undefined) {
    throw new Error("author fixture requires one eligible required Artifact intent");
  }
  const artifactId = "content";
  const sectionKey = "overview";
  const evidencePayload = {
    evidence_ref: sourceSpan.evidence_ref,
    kind: "documentation" as const,
    source_ref: sourceSpan.source_ref,
    module_ref: sourceSpan.module_ref,
    locator: sourceSpan.locator,
    content_digest: sourceSpan.content_digest,
    coverage_tier: "lightweight-evidence" as const,
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
    provider_layer_ref: spec.request.final_authority.layer_ref,
    provider_integrity: spec.request.final_authority.integrity,
    provider_bundle_digest: spec.request.final_authority.bundle_digest,
    config_fingerprint: spec.request.final_authority.config_fingerprint,
    customization_fingerprint: spec.request.final_authority.customization_fingerprint,
    requirement_ref: workset.requirement_ref,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    source_role: spec.request.run_environment.source_role,
    logical_unit: {
      group_key: workset.group_key,
      subject_key: validation.expected_subject_key as IndexerSubjectKey,
      logical_unit_ref: workset.logical_unit_ref,
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: validation.canonical_inventory_members.map((member) => member.member_id),
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      dispositions: validation.canonical_inventory_members.map((member) => ({
        ...member,
        inventory_disposition: "owned" as const,
        projection_disposition: "detailed" as const,
        section_evidence: [{ artifact_id: artifactId, section_key: sectionKey, evidence_refs: [evidence.evidence_ref] }],
      })),
    }),
    facts: [],
    evidence_bindings: [evidence],
    artifacts: [{
      artifact_id: artifactId,
      artifact_kind: artifactKind,
      artifact_policy_variant: variant.id,
      representation: "sections",
      sections: [{
        section_key: sectionKey,
        owner_indexer_id: workset.indexer_id,
        document_kind: intent.document_kind,
        reader_goal: intent.reader_goal,
        artifact_kind: artifactKind,
        blocks: [{
          block_id: "summary",
          layer: "semantic-prose",
          markdown: `# ${workset.group_key}\n\nStable group knowledge.`,
          evidence_refs: [evidence.evidence_ref],
        }],
      }],
    }],
    artifact_bundle: buildIndexerArtifactBundle({
      logical_unit_ref: workset.logical_unit_ref,
      artifact_policy_variant: variant.id,
      artifacts: [{ artifact_id: artifactId, artifact_kind: artifactKind, purpose: "required", reader_question_refs: [], evidence_refs: [evidence.evidence_ref] }],
    }),
    material_question_proposals: [],
    question_target_dispositions: [],
    diagnostics: [],
    input_digest: spec.request.execution_request_digest,
  };
  const artifact = { ...artifactPayload, output_digest: indexerArtifactResultDigest(artifactPayload) };
  return {
    artifact,
    result: {
      protocol: "context.indexer.run-result/v1" as const,
      operation: "main-index" as const,
      consumed_input_view_digest: spec.request.composition_input.view_digest,
      result: {
        protocol: "context.indexer.main-result/v1" as const,
        stage: "author" as const,
        workset_digest: workset.workset_digest,
        execution_request_digest: spec.request.execution_request_digest,
        result: artifact,
      },
    },
  };
}

describe("project Author result reuse", () => {
  test("reuses an accepted group when another source span in the same source changes", async () => {
    const initialFiles: MarkdownFixtureFile[] = [{
      path: "guide-a.md",
      bytes: "# Guide A\n\nFirst group.\n",
      title: "Guide A",
    }, {
      path: "guide-b.md",
      bytes: "# Guide B\n\nSecond group.\n",
      title: "Guide B",
    }];
    const { root, requirementDigest } = await markdownProject(initialFiles);
    const prepareAuthor = async () => {
      const questionTargetInventory = await buildProjectIndexerQuestionTargetInventory({
        projectRoot: root,
        value: { protocol: "context.indexer.question-target-inventory-input/v1", requirement_set_digest: requirementDigest },
      });
      const partition = await buildProjectIndexerMainPartitionWorksets({
        projectRoot: root,
        value: { protocol: "context.indexer.main-partition-workset-build-input/v1", question_target_inventory: questionTargetInventory },
      });
      const firstWorkset = partition.worksets[0];
      if (firstWorkset === undefined) throw new Error("expected partition worksets");
      const memberA = capturedDocumentIndexerRef({
        source_ref: firstWorkset.source_ref,
        path: "guide-a.md",
      });
      const memberB = capturedDocumentIndexerRef({
        source_ref: firstWorkset.source_ref,
        path: "guide-b.md",
      });
      type CompletePlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
      const partitions = partition.worksets.map((workset) => {
        const partitionRunSpec = partition.run_specs.find((candidate) =>
          candidate.request.workset.workset_digest === workset.workset_digest
        );
        if (partitionRunSpec?.validation.stage !== "partition") {
          throw new Error("expected a matching partition validation spec");
        }
        const partitionValidation = partitionRunSpec.validation as
          typeof partitionRunSpec.validation & {
            canonical_inventory_members: readonly IndexerInventoryMember[];
            authorized_source_refs: string[];
            authorized_strategies: Array<{
              strategy_ref: CompletePlan["strategy_ref"];
              strategy_digest: string;
            }>;
            required_question_target_refs: string[];
          };
        const member = partitionValidation.canonical_inventory_members[0];
        if (partitionValidation.canonical_inventory_members.length !== 1 || member === undefined) {
          throw new Error("expected one recoverable document per partition workset");
        }
        const localKey = member.member_id === memberA
          ? "guide-a"
          : member.member_id === memberB
          ? "guide-b"
          : null;
        if (localKey === null) throw new Error("unexpected document inventory member");
        const groupKey = `reader-subject:${localKey}`;
        const subjectKey = { ...workset.partition_subject_key, local_key: localKey };
        const planPayload: Omit<CompletePlan, "canonical_hash"> = {
          protocol: "context.indexer.partition-plan/v1",
          status: "complete",
          binding: {
            partition_workset_digest: workset.workset_digest,
            indexer_id: workset.indexer_id,
            indexer_fingerprint: workset.primary_execution_fingerprint,
            requirement_digest: requirementDigest,
            subject_key_schema_digest: workset.subject_key_schema_digest,
            source_scope_digest: workset.source_scope_digest,
            source_refs: [workset.source_ref],
            module_ref: workset.module_ref,
            partition_subject_key: workset.partition_subject_key,
            parent_scope_ref: workset.source_ref,
            inventory_digest: workset.partition_inventory_digest,
            question_target_inventory_digest: workset.question_target_inventory_digest,
          },
          strategy_ref: partitionValidation.authorized_strategies[0]!.strategy_ref,
          strategy_digest: partitionValidation.authorized_strategies[0]!.strategy_digest,
          unit_type: "reader-subject",
          partition_axis: "reader-subject",
          reader_question_refs: workset.reader_question_refs,
          groups: [{
            group_key: groupKey,
            subject_key: subjectKey,
            subject_intent: "primary",
            logical_unit_ref: canonicalIndexerNodeRef(subjectKey),
            label: localKey === "guide-a" ? "Guide A" : "Guide B",
            reader_question_refs: workset.reader_question_refs,
            question_target_bindings: localKey === "guide-a"
              ? workset.allowed_question_target_refs.map((targetRef) => ({
                  target_ref: targetRef,
                  role: "primary-carrier" as const,
                }))
              : [],
            member_ids: [member.member_id],
          }],
          member_dispositions: [{
            member_id: member.member_id,
            member_kind: member.member_kind,
            inventory_disposition: "owned",
            group_key: groupKey,
          }],
          failure: null,
        };
        const plan: CompletePlan = {
          ...planPayload,
          canonical_hash: indexerPartitionPlanCanonicalHash(planPayload),
        };
        return {
          plan,
          workset,
          canonical_inventory_members: partitionValidation.canonical_inventory_members,
          authorized_source_refs: partitionValidation.authorized_source_refs,
          authorized_strategies: partitionValidation.authorized_strategies,
          required_question_target_refs: partitionValidation.required_question_target_refs,
        };
      });
      const author = await buildProjectIndexerMainAuthorWorksets({
        projectRoot: root,
        value: {
          protocol: "context.indexer.main-author-workset-build-input/v1",
          partitions,
          target_resolution_views: [],
        },
      });
      if (!("worksets" in author)) throw new Error("expected author worksets");
      return author;
    };
    const initial = await prepareAuthor();
    await prepareIndexerMainRunStore({ projectRoot: root, workset_set: initial.workset_set, run_specs: initial.run_specs });
    for (const spec of initial.run_specs) {
      const fixture = authorResultFixture(spec);
      await startIndexerMainRunStore({ projectRoot: root, workset_digest: spec.request.workset.workset_digest });
      await acceptIndexerMainRunStore({ projectRoot: root, workset_digest: spec.request.workset.workset_digest, result: fixture.result });
    }
    const initialRecords = await readAcceptedIndexerMainAuthorResultRecords(root);
    const previousB = initialRecords.find((record) => (record.artifact_result as IndexerArtifactResult).logical_unit.group_key === "reader-subject:guide-b");
    if (previousB === undefined || previousB.artifact_dependency_set === null) throw new Error("missing accepted Guide B result");
    await writeMarkdownSnapshot({ root, capturedAt: "2026-09-03T00:00:00.000Z", files: [{ ...initialFiles[0]!, bytes: "# Guide A\n\nFirst group changed.\n" }, initialFiles[1]!] });
    const current = await prepareAuthor();
    const initialByGroup = new Map(initial.run_specs.map((spec) => [(spec.request.workset as IndexerMainAuthorWorkset).group_key, spec]));
    const currentByGroup = new Map(current.run_specs.map((spec) => [(spec.request.workset as IndexerMainAuthorWorkset).group_key, spec]));
    const initialA = initialByGroup.get("reader-subject:guide-a")!;
    const initialB = initialByGroup.get("reader-subject:guide-b")!;
    const currentA = currentByGroup.get("reader-subject:guide-a")!;
    const currentB = currentByGroup.get("reader-subject:guide-b")!;
    expect(currentA.request.workset.workset_digest).not.toBe(initialA.request.workset.workset_digest);
    expect(currentA.request.execution_request_digest).not.toBe(initialA.request.execution_request_digest);
    expect(currentB.request.workset.workset_digest).toBe(initialB.request.workset.workset_digest);
    expect(currentB.request.execution_request_digest).toBe(initialB.request.execution_request_digest);
    expect(currentB.request.run_environment).toEqual(initialB.request.run_environment);
    expect(currentB.validation).toEqual(initialB.validation);
    const recovered = await prepareIndexerMainRunStore({ projectRoot: root, workset_set: current.workset_set, run_specs: current.run_specs });
    expect(recovered.status).toMatchObject({ accepted_count: 1, stale_count: 1, pending_count: 0, can_advance: false });
    expect(recovered.ledger.entries.find((entry) => entry.workset_digest === currentA.request.workset.workset_digest)?.state).toBe("stale");
    expect(recovered.ledger.entries.find((entry) => entry.workset_digest === currentB.request.workset.workset_digest)?.state).toBe("accepted");
    const cached = await readJsonMaybe(root, acceptedCachePath(currentB.request.execution_request_digest));
    const reused = validateAcceptedCache({ cache: cached, spec: await currentSpec({ projectRoot: root, request_digest: currentB.request.execution_request_digest }) });
    if (reused.artifact_dependency_set === null) throw new Error("reused Guide B result lacks Artifact dependencies");
    expect((reused.operation_result as IndexerArtifactResult).output_digest).toBe((previousB.artifact_result as IndexerArtifactResult).output_digest);
    expect(reused.artifact_dependency_set.artifacts[0]!.dependency_digest).toBe(previousB.artifact_dependency_set.artifacts[0]!.dependency_digest);
    expect(reused.artifact_dependency_set.artifacts[0]!.sections[0]!.dependency_digest).toBe(previousB.artifact_dependency_set.artifacts[0]!.sections[0]!.dependency_digest);

    const batch = await prepareAndStartNextIndexerBatch(root);
    expect(batch.tasks.map((task) => task.workset_digest)).toEqual([
      currentA.request.workset.workset_digest,
    ]);
    const started = await currentLedger(root);
    expect(started?.entries.find((entry) =>
      entry.workset_digest === currentA.request.workset.workset_digest
    )?.state).toBe("running");
    expect(started?.entries.find((entry) =>
      entry.workset_digest === currentB.request.workset.workset_digest
    )?.state).toBe("accepted");
  });
});
