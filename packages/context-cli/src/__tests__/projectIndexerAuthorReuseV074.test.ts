import { authorResultFixture } from "./authorResult.fixture.js";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  indexerPartitionPlanCanonicalHash,
  indexerRegistryDigests,
  indexerProtocolDigest,
  type IndexerArtifactResult,
  type IndexerInventoryMember,
  type IndexerMainAuthorWorkset,
  type IndexerPartitionPlan,
  type IndexerRegistry,
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
  readAcceptedCache,
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
        const planPayload: Omit<CompletePlan, "canonical_hash"> = {
          protocol: "context.indexer.partition-plan/v1",
          status: "complete",
          binding: {
            partition_workset_digest: workset.workset_digest,
            indexer_id: workset.indexer_id,
            indexer_fingerprint: workset.primary_execution_fingerprint,
            requirement_digest: requirementDigest,
            source_scope_digest: workset.source_scope_digest,
            source_refs: [workset.source_ref],
            module_ref: workset.module_ref,
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
            logical_unit_ref: indexerProtocolDigest({ indexer_id: workset.indexer_id, source_ref: workset.source_ref, module_ref: workset.module_ref, group_key: groupKey }),
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
        },
      });
      if (!("worksets" in author)) throw new Error("expected author worksets");
      return author;
    };
    const initial = await prepareAuthor();
    await prepareIndexerMainRunStore({ projectRoot: root, workset_set: initial.workset_set, run_specs: initial.run_specs });
    for (const spec of initial.run_specs) {
      const fixture = await authorResultFixture(root, spec);
      await startIndexerMainRunStore({ projectRoot: root, workset_digest: spec.request.workset.workset_digest });
      await acceptIndexerMainRunStore({ projectRoot: root, workset_digest: spec.request.workset.workset_digest, result: fixture.result });
    }
    const initialRecords = await readAcceptedIndexerMainAuthorResultRecords(root);
    const previousB = initialRecords.find((record) => (record.artifact_result as IndexerArtifactResult).logical_unit.group_key === "reader-subject:guide-b");
    if (previousB === undefined) throw new Error("missing accepted Guide B result");
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
    expect(recovered.status).toMatchObject({ accepted_count: 1, stale_count: 0, pending_count: 1, can_advance: false });
    expect(recovered.ledger.entries.find((entry) => entry.workset_digest === currentA.request.workset.workset_digest)?.state).toBe("pending");
    expect(recovered.ledger.entries.find((entry) => entry.workset_digest === currentB.request.workset.workset_digest)?.state).toBe("accepted");
    const cached = await readJsonMaybe(root, acceptedCachePath(currentB.request.execution_request_digest));
    const reused = readAcceptedCache({ cache: cached, spec: await currentSpec({ projectRoot: root, request_digest: currentB.request.execution_request_digest }) });
    expect((reused.operation_result as IndexerArtifactResult).output_digest).toBe((previousB.artifact_result as IndexerArtifactResult).output_digest);

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
