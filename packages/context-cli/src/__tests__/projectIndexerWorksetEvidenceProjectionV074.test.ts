import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  composeIndexerLayerInput,
  indexerInventoryMembersDigest,
  indexerRegistryDigests,
  indexerPartitionStrategySetDigest,
  type IndexerRegistry,
} from "@c4a/context";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import { buildCommittedEvidenceIndex } from "../project/documentEvidenceIndex.js";
import {
  resolveProjectIndexerMainSourceBinding,
  type ProjectIndexerCapturedDocumentsSourceBinding,
} from "../project/indexerMainSourceAdapter.js";
import {
  buildCapturedDocumentEnrichmentWorksetViewSource,
  buildCapturedDocumentWorksetViewSource,
} from
  "../project/indexerWorksetEvidenceProjection.js";
import {
  materializeIndexerWorksetViewHostAction,
  prepareProjectIndexerWorksetViewMaterialization,
} from "../project/indexerWorksetViewMaterialization.js";
import { normalizeRunSpec } from "../project/indexerMainRunStoreRecords.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function markdownRunRequest(
  binding: ProjectIndexerCapturedDocumentsSourceBinding,
  options: {
    indexer_id?: string;
    source_ref?: string;
    requirement_set_digest?: string;
  } = {},
) {
  const indexerId = options.indexer_id ?? "sample-markdown-indexer";
  const strategy = {
    strategy_ref: {
      kind: "project-indexer" as const,
      indexer_id: indexerId,
      strategy_id: "document",
      implementation_digest: digest("1"),
    },
    strategy_digest: digest("2"),
  };
  const primaryExecutionProjection = buildIndexerPrimaryExecutionProjection({
    indexer_id: indexerId,
    primary_registry_projection_digest: digest("3"),
    program_digest: null,
    instructions_digest: digest("4"),
    template_set_digest: digest("5"),
    config_digest: digest("6"),
    cli_contract_digest: digest("7"),
    profile_contract_digest: digest("8"),
    resources: [{
      layer_ref: "provider:community#layer:primary",
      phase: "primary",
      kind: "instructions",
      ref: "bundle:community/instructions/markdown.md",
      digest: digest("4"),
    }],
  });
  const workset = buildIndexerMainWorkset({
    indexer_id: indexerId,
    requirement_ref: "requirement:documentation",
    owner_cell_refs: ["owner-cell:documentation#business-semantics"],
    source_ref: options.source_ref ?? "file:docs",
    module_ref: null,
    primary_registry_projection_digest: digest("3"),
    requirement_set_digest: options.requirement_set_digest ?? digest("9"),
    primary_execution_fingerprint:
      primaryExecutionProjection.primary_execution_fingerprint,
    profile_contract_digest: digest("8"),
    subject_key_schema_digest: digest("a"),
    source_scope_digest: digest("b"),
    source_binding_digest: binding.source_binding_digest,
    primary_resource_binding_digest:
      primaryExecutionProjection.primary_resource_binding_digest,
    question_target_inventory_digest: digest("d"),
    stage: "partition",
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "docs",
      kind: "document-set",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest([strategy]),
    reader_question_refs: [],
    partition_input_digests: binding.partition_input_digests,
    partition_inventory_digest: indexerInventoryMembersDigest(
      binding.partition_inventory,
    ),
    allowed_question_target_refs: [],
  });
  return buildIndexerMainRunRequest({
    workset,
    partition_strategy_attempt: {
      strategy_order: 0,
      strategy_ref: strategy.strategy_ref,
      strategy_digest: strategy.strategy_digest,
      previous_attempt_digest: null,
    },
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: "provider:community#layer:primary",
      fragments: [],
    }),
    final_authority: {
      layer_ref: "provider:community#layer:primary",
      integrity: digest("4"),
      bundle_digest: digest("5"),
      config_fingerprint: digest("6"),
      customization_fingerprint: null,
    },
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: binding.source_snapshot_digest,
      source_dependency_fingerprint: workset.source_binding_digest,
      source_role: "authoritative-source",
      source_precedence_digest: digest("9"),
      metric_set_digest: digest("a"),
      dependency_view_digest: null,
      primary_execution_projection: primaryExecutionProjection,
    }),
  });
}

function markdownRegistry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "documentation",
      reader_goals: ["understand-system"],
      coverage_domains: { documentation: "required" },
      target_scope: {
        targets: [{ source_ref: "file:docs", module_refs: [] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "file:docs", module_refs: [] }],
      },
    }],
    indexers: [{
      id: "sample-markdown-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "documentation",
        coverage_domains: ["documentation"],
        owned_scope: { ref: "requirement:documentation#target_scope" },
        role: "primary",
      }],
      read_scope: {
        refs: [
          "requirement:documentation#target_scope",
          "requirement:documentation#evidence_source_scope",
        ],
      },
      profile: { primary: { id: "technical-guide", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-markdown-indexer",
        version: "1.0.0",
        integrity: digest("e"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-markdown-indexer",
        },
      }],
    }],
  };
}

function enrichmentRegistry(evidenceSourceRef: string): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "documentation",
      reader_goals: ["understand-system"],
      coverage_domains: { documentation: "required" },
      target_scope: {
        targets: [{ source_ref: "repo:code", module_refs: [] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: evidenceSourceRef, module_refs: [] }],
      },
    }],
    indexers: [{
      id: "sample-code-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "documentation",
        coverage_domains: ["documentation"],
        owned_scope: { ref: "requirement:documentation#target_scope" },
        role: "primary",
      }],
      read_scope: {
        refs: ["requirement:documentation#evidence_source_scope"],
      },
      profile: { primary: { id: "component-library", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "1.0.0",
        integrity: digest("e"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  };
}

describe("0.7.4 Indexer workset evidence projection", () => {
  test("projects a captured Markdown snapshot through the single main Workset View path", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-markdown-view-"));
    const registry = markdownRegistry();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "indexers.yaml"),
      YAML.stringify(registry),
      "utf8",
    );
    const sourceRoot = join(root, "sources", "file", "docs");
    const files = [
      {
        path: "guide.md",
        source_path: "guide/overview.md",
        bytes: "# Guide\n\nAuthorized evidence.\n",
        title: "Guide",
      },
      {
        path: "private(deprecated).md",
        bytes: "# Private\n\nNot selected.\n",
        title: "Private",
      },
    ];
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(root, "sources", "file", "index.yaml"), [
      "sources:",
      "  - name: docs",
      "    snapshot:",
      "      manifest: sources/file/docs/manifest.json",
      "",
    ].join("\n"), "utf8");
    for (const file of files) {
      await writeFile(join(sourceRoot, file.path), file.bytes, "utf8");
    }
    await writeFile(join(sourceRoot, "manifest.json"), `${JSON.stringify(
      createDocumentSnapshotManifest({
        sourceType: "file",
        sourceName: "docs",
        capturedAt: "2026-09-02T00:00:00.000Z",
        files,
      }),
      null,
      2,
    )}\n`, "utf8");
    const evidence = await buildCommittedEvidenceIndex({
      projectRoot: root,
      sourceType: "file",
      sourceName: "docs",
    });
    const binding = await resolveProjectIndexerMainSourceBinding({
      projectRoot: root,
      indexer_id: "sample-markdown-indexer",
      source_ref: "file:docs",
      module_ref: null,
      profile_contract_digest: digest("8"),
    });
    if (binding.adapter !== "captured-documents") {
      throw new Error("expected captured document binding");
    }
    const runRequest = markdownRunRequest(binding, {
      requirement_set_digest: indexerRegistryDigests(registry).requirementSetDigest,
    });
    const runSpec = normalizeRunSpec({
      protocol: "context.indexer.main-run-spec/v1",
      request: runRequest,
      validation: {
        stage: "partition",
        canonical_inventory_members: binding.partition_inventory,
      },
    });
    const worksetView = await prepareProjectIndexerWorksetViewMaterialization({
      projectRoot: root,
      run_spec: runSpec,
    });
    const host = await materializeIndexerWorksetViewHostAction({
      request: worksetView.request,
      run_request: runRequest,
      projection: worksetView.projection,
      workspaceRoot: root,
      adapter: "context-cli",
      adapterVersion: "0.7.4",
    });
    expect(worksetView.projection.view.items.filter((item) =>
      item.category === "document"
    )).toHaveLength(2);
    expect(worksetView.projection.view.items.find((item) =>
      item.category === "index-requirement"
    )?.value).toMatchObject({
      id: "documentation",
      reader_goals: ["understand-system"],
    });
    const projectedDocuments = worksetView.projection.view.items.filter((item) =>
      item.category === "document"
    );
    expect(JSON.stringify(projectedDocuments)).toContain("guide/overview.md");
    expect(projectedDocuments.map((item) => item.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "guide.md",
          content_path: join(evidence.index.materialized_at, "guide.md"),
          outline: ["Guide"],
        }),
        expect.objectContaining({
          path: "private(deprecated).md",
          content_path: join(evidence.index.materialized_at, "private(deprecated).md"),
          outline: ["Private"],
        }),
      ]),
    );
    expect(projectedDocuments.every((item) =>
      !Object.prototype.hasOwnProperty.call(item.value, "markdown")
    )).toBe(true);
    expect(host.result.output).toMatchObject({
      resource: { digest: host.managed_output.digest },
    });
    await expect(buildCapturedDocumentWorksetViewSource({
      projectRoot: root,
      request: runRequest,
      evidence,
      authorized_document_paths: ["missing.md"],
    })).rejects.toThrow(/unavailable/);
  });

  test("projects registered document evidence into a code workset without opening a second flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-document-enrichment-"));
    const sourceRoot = join(root, "sources", "file", "docs");
    const files = [{
      path: "guide.md",
      bytes: "# Public contract\n\nDocumented API and usage.\n",
      title: "Public contract",
    }];
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(root, "sources", "file", "index.yaml"), [
      "sources:",
      "  - name: docs",
      "    snapshot:",
      "      manifest: sources/file/docs/manifest.json",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(sourceRoot, "guide.md"), files[0]!.bytes, "utf8");
    await writeFile(join(sourceRoot, "manifest.json"), `${JSON.stringify(
      createDocumentSnapshotManifest({
        sourceType: "file",
        sourceName: "docs",
        capturedAt: "2026-09-02T00:00:00.000Z",
        files,
      }),
      null,
      2,
    )}\n`, "utf8");
    const binding = await resolveProjectIndexerMainSourceBinding({
      projectRoot: root,
      indexer_id: "sample-markdown-indexer",
      source_ref: "file:docs",
      module_ref: null,
      profile_contract_digest: digest("8"),
    });
    if (binding.adapter !== "captured-documents") {
      throw new Error("expected captured document binding");
    }
    const request = markdownRunRequest(binding, {
      indexer_id: "sample-code-indexer",
      source_ref: "repo:code",
    });
    const projected = await buildCapturedDocumentEnrichmentWorksetViewSource({
      projectRoot: root,
      request,
      registry: enrichmentRegistry("file:docs"),
      evidence: binding.evidence,
      authorized_document_paths: ["guide.md"],
    });
    expect(projected.projection_kind).toBe("captured-document-enrichment");
    expect(projected.items).toHaveLength(1);
    expect(projected.items[0]!.provenance.container_ref).toBe("file:docs");
    expect(projected.items[0]!.value).toMatchObject({
      source_ref: "file:docs",
      path: "guide.md",
      content_path: join(binding.evidence.index.materialized_at, "guide.md"),
      content_hash: binding.evidence.index.documents[0]!.content_hash,
      outline: ["Public contract"],
    });
    expect(projected.items[0]!.value).not.toHaveProperty("markdown");

    await expect(buildCapturedDocumentEnrichmentWorksetViewSource({
      projectRoot: root,
      request,
      registry: enrichmentRegistry("file:other-docs"),
      evidence: binding.evidence,
      authorized_document_paths: ["guide.md"],
    })).rejects.toThrow(/outside Indexer read scope/);
  });
});
