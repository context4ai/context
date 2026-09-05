import { afterEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { loadIndexerRegistry, type IndexerPartitionValidationInput } from "@c4a/context";
import { project, SOURCE_REF, MODULE_REF } from "./projectIndexerMainLifecycleV070.fixture.js";
import { buildProjectIndexerMainPartitionWorksets, buildProjectIndexerQuestionTargetInventory } from
  "../project/indexerMainLifecycleActions.js";
import { prepareProjectIndexerWorksetViewMaterialization } from "../project/indexerWorksetViewMaterialization.js";
import { buildIndexerPartitionRunResultFromSemantic } from "../project/indexerSemanticPartitionResult.js";
import { prepareIndexerMainRunStore, startIndexerMainRunStore, acceptIndexerMainRunStore } from
  "../project/indexerMainRunStore.js";
import { prepareCurrentIndexerStructurePlan, prepareCurrentIndexerAuthorStage } from
  "../project/indexerStructureReview.js";
import { currentLedger, currentSpec } from "../project/indexerMainRunStoreRecords.js";
import { indexerParserRuntimeManifestPath } from "../project/indexerParserRuntimeIndex.js";
import { createIndexerAuthorSourceResolver, mergeIndexerAuthorSourceBindings } from "../project/indexerAuthorSources.js";
import type { IndexerConsumerWorksetProjection } from "../project/indexerConsumerWorksetPlanner.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "../project/indexerCurrentPrimaryAuthority.js";
import { persistIndexerSemanticResult } from "../project/indexerCurrentActionShared.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Author source lookup", () => {
  test("reuses Partition projections through convergence without reading excluded files", async () => {
    const { root, requirementDigest } = await project({ rankedCodeInventory: true });
    roots.push(root);
    const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
      projectRoot: root, registry: (await loadIndexerRegistry(root)).registry, indexer_id: "component-library",
    });
    const unit = authority.manifest.provides.logical_units!.find((unit) => unit.artifacts !== undefined)!;
    const inventory = await buildProjectIndexerQuestionTargetInventory({
      projectRoot: root,
      value: { protocol: "context.indexer.question-target-inventory-input/v1", requirement_set_digest: requirementDigest },
    });
    const built = await buildProjectIndexerMainPartitionWorksets({
      projectRoot: root,
      value: { protocol: "context.indexer.main-partition-workset-build-input/v1", question_target_inventory: inventory },
    });
    await prepareIndexerMainRunStore({ projectRoot: root, workset_set: built.workset_set, run_specs: built.run_specs });
    const expectedFacts = new Set<string>();
    const partitions: IndexerPartitionValidationInput[] = [];
    const projections = new Map<string, IndexerConsumerWorksetProjection>();
    const primaryDigest = built.run_specs.filter((spec) =>
      !(spec.validation.partition_projection as IndexerConsumerWorksetProjection).unresolved
    ).map((spec) => spec.request.workset.workset_digest).sort().at(-1)!;
    for (const spec of built.run_specs) {
      const workset = spec.request.workset;
      if (workset.stage !== "partition") throw new Error("expected Partition");
      const projection = spec.validation.partition_projection as IndexerConsumerWorksetProjection;
      const validation = spec.validation as Parameters<typeof buildIndexerPartitionRunResultFromSemantic>[0]["validation"];
      const prepared = await prepareProjectIndexerWorksetViewMaterialization({ projectRoot: root, run_spec: spec });
      expect(prepared.projection.view.items.some((item) => item.category === "source-text")).toBe(false);
      const ownsReaderPlan = workset.workset_digest === primaryDigest;
      const semantic: Parameters<typeof buildIndexerPartitionRunResultFromSemantic>[0]["semantic"] = {
          stage: "partition", outcome: "complete",
          groups: projection.unresolved ? [] : [{
            key: "public-api", title: ownsReaderPlan ? "Public API" : "Supporting details",
            reader_task: ownsReaderPlan ? "Locate the public exports and constraints." : "Explain the supporting declarations.",
            subject: { namespace: workset.partition_subject_key.namespace, kind: workset.partition_subject_key.kind, local_key: "public-api" },
            subject_intent: ownsReaderPlan ? "primary" : "enrich-or-independent",
            members: validation.canonical_inventory_members.map((member) => member.member_id),
            questions: [...workset.reader_question_refs],
            question_targets: (validation.required_question_target_refs ?? []).map((target) => ({ target, role: "primary-carrier" })),
            outline: ownsReaderPlan ? ["Exports", "Constraints"] : ["Supporting details"],
          }],
          excluded: projection.unresolved ? validation.canonical_inventory_members.map((member) => ({
            item: member.member_id, reason_code: "comment-only-no-public-api",
          })) : [], unsupported: [],
        };
      const result = buildIndexerPartitionRunResultFromSemantic({
        request: spec.request, view: prepared.projection.view, validation: { ...validation, partition_unit_type: unit.id },
        semantic,
      });
      await startIndexerMainRunStore({ projectRoot: root, workset_digest: workset.workset_digest });
      await acceptIndexerMainRunStore({ projectRoot: root, workset_digest: workset.workset_digest, result });
      await persistIndexerSemanticResult({ projectRoot: root, requestDigest: spec.request.execution_request_digest, semantic });
      if (!projection.unresolved) {
        for (const fact of projection.fact_items) expectedFacts.add(fact.fact_ref);
        partitions.push({
          ...spec.validation,
          plan: result.result.result,
          workset,
        } as unknown as IndexerPartitionValidationInput);
        projections.set(workset.workset_digest, projection);
      }
    }
    const manifestPath = indexerParserRuntimeManifestPath(root, "component-library");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const chunks = join(dirname(manifestPath), "chunks");
    const metadata = JSON.parse(await readFile(join(chunks, manifest.sources[0].chunk.file), "utf8"));
    const ignored = metadata.files.find((file: { normalized_path: string }) => file.normalized_path.endsWith("notes.ts"));
    expect(ignored).toBeDefined();
    const ignoredPath = join(chunks, ignored.chunk.file);
    await writeFile(ignoredPath, "excluded-file-must-not-be-read");

    const resolver = createIndexerAuthorSourceResolver({ projectRoot: root, projections });
    const bindings = await Promise.all(partitions.map(resolver));
    const merged = mergeIndexerAuthorSourceBindings(bindings);
    expect(merged.source_ref).toBe(SOURCE_REF);
    expect(merged.module_ref).toBe(MODULE_REF);
    if (merged.adapter !== "parser-facts") throw new Error("expected parser binding");
    for (const ref of expectedFacts) expect(merged.parser_fact_index.has(ref)).toBe(true);
    expect(merged.parser_fact_view.files.some((file) => file.normalized_path.endsWith("notes.ts"))).toBe(false);
    await expect(createIndexerAuthorSourceResolver({ projectRoot: root, projections: new Map() })(partitions[0]!))
      .rejects.toThrow("requires the current Partition consumer projection");

    const review = await prepareCurrentIndexerStructurePlan(root);
    expect(review.preview.topics).toHaveLength(1);
    expect(review.preview.topics[0]).toMatchObject({
      title: "Public API", reader_task: "Locate the public exports and constraints.", outline: ["Exports", "Constraints"],
    });
    await prepareCurrentIndexerAuthorStage(root);
    const ledger = await currentLedger(root);
    expect(ledger?.entries).toHaveLength(1);
    const spec = await currentSpec({ projectRoot: root, request_digest: ledger!.entries[0]!.execution_request_digest });
    const dependency = spec.validation.dependency_view as { positive_nodes: Array<{ kind: string; fact_ref?: string }> };
    const selected = new Set(dependency.positive_nodes.flatMap((node) => node.kind === "selected-fact" ? [node.fact_ref] : []));
    for (const ref of expectedFacts) expect(selected.has(ref)).toBe(true);
    const authorView = (await prepareProjectIndexerWorksetViewMaterialization({
      projectRoot: root, run_spec: spec,
    })).projection.view;
    const visibleMembers = authorView.items.filter((item) => item.category === "inventory-member")
      .map((item) => JSON.stringify(item.value)).sort();
    expect(visibleMembers).toEqual((spec.validation.canonical_inventory_members as object[])
      .map((member) => JSON.stringify(member)).sort());
    const visibleFacts = new Set(authorView.items.filter((item) => item.category === "fact").map((item) => item.ref));
    for (const ref of expectedFacts) expect(visibleFacts.has(ref)).toBe(true);
    const sourceText = authorView.items.filter((item) => item.category === "source-text");
    expect(sourceText).toHaveLength(2);
    expect(JSON.stringify(sourceText)).toContain("export const three = 3;");
    expect(JSON.stringify(sourceText)).not.toContain("notes.ts");
    const dependencyRefs = new Set(authorView.items.filter((item) => item.category === "dependency").map((item) => item.ref));
    for (const item of sourceText) {
      for (const span of (item.value as { spans: Array<{ source_span_refs: string[] }> }).spans) {
        for (const ref of span.source_span_refs) expect(dependencyRefs.has(ref)).toBe(true);
      }
    }
    expect(await readFile(ignoredPath, "utf8")).toBe("excluded-file-must-not-be-read");
  }, 30_000);
});
