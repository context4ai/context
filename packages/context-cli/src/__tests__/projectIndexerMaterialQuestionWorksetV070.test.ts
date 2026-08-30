import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  indexerRegistryDigests,
  composeIndexerLayerInput,
  indexerMaterialAnswerProviderCompositionFingerprint,
  indexerMaterialAnswerResultDigest,
  type IndexerProviderManifest,
} from "@c4a/context";
import YAML from "yaml";
import { buildProjectIndexerMaterialQuestionWorkset } from
  "../project/indexerMaterialQuestionActions.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import {
  OWNER_REF,
  REQUIREMENT_REF,
  MATERIAL_PROVIDER_INTEGRITY,
  digest,
  inventory,
  materialLedger,
  materialRegistry,
  resolvedQuestion,
} from "./projectIndexerMaterialAnswerExecutionV070.fixture.js";

function manifest(kinds: "runbook" | "code" = "runbook"): IndexerProviderManifest {
  return {
    protocol: "context.indexer.provider/v1",
    id: "answer-provider",
    version: "1.0.0",
    domains: ["documentation"],
    activation: {
      target_kinds: ["repository"],
      required_signals: [{ id: "source-present", description: "A source is registered." }],
      supporting_signals: [],
      negative_signals: [],
    },
    provides: {
      profiles: ["domain-reference"],
      operations: [{
        id: "material-answer",
        consumes: "context.indexer.material-question-workset/v1",
        produces: "context.indexer.material-answer-result/v1",
        supported_evidence_kinds: [kinds],
      }],
    },
    provider: {
      instructions: [{
        path: "references/answer.md",
        profiles: ["domain-reference"],
      }],
    },
  };
}

async function withWorkspace<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), "context-material-workset-"));
  try {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), `${JSON.stringify({
      name: "material-answer-cli-fixture",
      private: true,
      context: { project: true, entry: "src/index.ts" },
    }, null, 2)}\n`, "utf8");
    await writeFile(join(projectRoot, "src", "index.ts"), "export {};\n", "utf8");
    await writeFile(
      join(projectRoot, "src", "indexers.yaml"),
      YAML.stringify(materialRegistry()),
      "utf8",
    );
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function inputValue(evidenceKind: "runbook" | "code" = "runbook") {
  const selectedRegistry = materialRegistry();
  const requirementSetDigest = indexerRegistryDigests(selectedRegistry).requirementSetDigest;
  const targetInventory = inventory(requirementSetDigest);
  return {
    protocol: "context.indexer.build-material-question-workset-input/v1",
    requirement_set_digest: requirementSetDigest,
    material_gap_ledger: materialLedger(requirementSetDigest),
    registered_sources: [{
      source_ref: "source:runbook",
      source_input_digest: digest("2"),
    }],
    provider_capabilities: [{
      indexer_id: "answer-indexer",
      provider_integrity: MATERIAL_PROVIDER_INTEGRITY,
      stage_receipt_digest: digest("5"),
      manifest: manifest(evidenceKind),
    }],
    resolved_questions: [{ requirement_ref: REQUIREMENT_REF, question: resolvedQuestion() }],
    question_target_inventory: targetInventory,
    owner_cells: [{
      owner_cell_ref: OWNER_REF,
      owner_cell_digest: digest("f"),
      requirement_ref: REQUIREMENT_REF,
      coverage_domain: "operations",
      domain_state: "required",
    }],
    target_facts: {
      [targetInventory.items[0]!.target_ref]: { target: { visibility: "public" } },
    },
    allowed_selector_fact_paths: ["target.visibility"],
    answer_landings: [],
  };
}

describe("project material-question workset authority", () => {
  test("derives eligibility from registry, Provider operation, scope, and evidence kind", async () => {
    await withWorkspace(async (projectRoot) => {
      const eligible = await buildProjectIndexerMaterialQuestionWorkset({
        projectRoot,
        value: inputValue(),
      });
      expect(eligible.workset.items[0]).toMatchObject({
        eligible_answer_indexer_ids: ["answer-indexer"],
        authorized_source_refs: ["source:runbook"],
      });
      expect(eligible.provider_authority_receipts).toHaveLength(1);

      const incompatible = await buildProjectIndexerMaterialQuestionWorkset({
        projectRoot,
        value: inputValue("code"),
      });
      expect(incompatible.workset.items[0]).toMatchObject({
        eligible_answer_indexer_ids: [],
        authorized_source_refs: [],
      });
      expect(incompatible.unresolved_question_keys).toEqual([
        incompatible.workset.items[0]!.question_key,
      ]);
    });
  });

  test("keeps evidence-only sources outside the target denominator and owner/page identity", async () => {
    await withWorkspace(async (projectRoot) => {
      const value = inputValue();
      value.registered_sources.push({
        source_ref: "source:outside-scope",
        source_input_digest: digest("9"),
      });
      const eligible = await buildProjectIndexerMaterialQuestionWorkset({
        projectRoot,
        value,
      });
      const item = eligible.workset.items[0]!;
      expect(item.authorized_source_refs).toEqual(["source:runbook"]);
      expect(JSON.stringify(value.question_target_inventory)).not.toContain("source:runbook");
      expect(value.question_target_inventory.items).toHaveLength(1);
      expect(value.owner_cells).toHaveLength(1);
      expect(item.question.answer_landing_ref).not.toContain("source:runbook");

      const noSource = inputValue();
      noSource.registered_sources = [];
      const reopened = await buildProjectIndexerMaterialQuestionWorkset({
        projectRoot,
        value: noSource,
      });
      expect(reopened.workset.question_target_inventory_digest).toBe(
        eligible.workset.question_target_inventory_digest,
      );
      expect(reopened.workset.items).toHaveLength(eligible.workset.items.length);
      expect(reopened.workset.items[0]?.authorized_source_refs).toEqual([]);
      expect(reopened.unresolved_question_keys).toEqual([
        reopened.workset.items[0]!.question_key,
      ]);

      const noEvidenceRead = materialRegistry();
      noEvidenceRead.indexers[0]!.read_scope.refs = [
        "requirement:public-knowledge#target_scope",
      ];
      await writeFile(
        join(projectRoot, "src", "indexers.yaml"),
        YAML.stringify(noEvidenceRead),
        "utf8",
      );
      const readScopeBlocked = await buildProjectIndexerMaterialQuestionWorkset({
        projectRoot,
        value: inputValue(),
      });
      expect(readScopeBlocked.workset.items[0]).toMatchObject({
        eligible_answer_indexer_ids: [],
        authorized_source_refs: [],
      });
      expect(readScopeBlocked.unresolved_question_keys).toEqual([
        readScopeBlocked.workset.items[0]!.question_key,
      ]);
    });
  });

  test("runs the path-free prepare/start/accept commands and reuses an empty Result", async () => {
    await withWorkspace(async (projectRoot) => {
      const worksetResult = await buildProjectIndexerMaterialQuestionWorkset({
        projectRoot,
        value: inputValue(),
      });
      const finalAuthority = {
        layer_ref: "provider:answer-provider#layer:primary",
        integrity: MATERIAL_PROVIDER_INTEGRITY,
        bundle_digest: digest("6"),
        config_fingerprint: digest("7"),
        customization_fingerprint: null,
      };
      const compositionInput = composeIndexerLayerInput({
        workset_digest: worksetResult.workset.workset_digest,
        final_authority_layer_ref: finalAuthority.layer_ref,
        fragments: [],
      });
      const authorityBase = {
        answer_indexer_id: "answer-indexer",
        composition_input: compositionInput,
        final_authority: finalAuthority,
      };
      const requirementSetDigest = worksetResult.workset.requirement_set_digest;
      const prepareInput = {
        protocol: "context.indexer.prepare-material-answer-runs-input/v1",
        requirement_set_digest: requirementSetDigest,
        workset: worksetResult.workset,
        authorities: [{
          ...authorityBase,
          answer_provider_composition_fingerprint:
            indexerMaterialAnswerProviderCompositionFingerprint(authorityBase),
        }],
      };
      const preparePath = join(projectRoot, "prepare-material-answer.json");
      await writeFile(preparePath, `${JSON.stringify(prepareInput, null, 2)}\n`, "utf8");
      const prepared = JSON.parse(await runCliInDir(projectRoot, [
        "indexer", "prepare-material-answer-runs", "--input", preparePath, "--format", "json",
      ]));
      expect(prepared.observation).toMatchObject({ pending: 1, accepted: 0 });

      const run = prepared.plan.runs[0];
      const startPath = join(projectRoot, "start-material-answer.json");
      await writeFile(startPath, `${JSON.stringify({
        protocol: "context.indexer.start-material-answer-run-input/v1",
        requirement_set_digest: requirementSetDigest,
        plan_digest: prepared.plan.plan_digest,
        expected_revision: prepared.ledger.revision,
        run_ref: run.run_ref,
      }, null, 2)}\n`, "utf8");
      const started = JSON.parse(await runCliInDir(projectRoot, [
        "indexer", "start-material-answer-run", "--input", startPath, "--format", "json",
      ]));
      expect(started.request.operation).toBe("material-answer");

      const resultPayload = {
        protocol: "context.indexer.material-answer-result/v1" as const,
        workset_digest: run.request.workset.workset_digest,
        execution_request_digest: run.request.execution_request_digest,
        answer_indexer_id: run.answer_indexer_id,
        answer_provider_composition_fingerprint:
          run.request.answer_provider_composition_fingerprint,
        bindings: [],
      };
      const acceptPath = join(projectRoot, "accept-material-answer.json");
      await writeFile(acceptPath, `${JSON.stringify({
        protocol: "context.indexer.accept-material-answer-run-input/v1",
        requirement_set_digest: requirementSetDigest,
        plan_digest: prepared.plan.plan_digest,
        expected_revision: started.ledger.revision,
        run_ref: run.run_ref,
        reader_authority_digest: digest("8"),
        evidence_read_receipts: [],
        result: {
          protocol: "context.indexer.run-result/v1",
          operation: "material-answer",
          consumed_input_view_digest: run.request.composition_input.view_digest,
          result: {
            ...resultPayload,
            result_digest: indexerMaterialAnswerResultDigest(resultPayload),
          },
        },
      }, null, 2)}\n`, "utf8");
      const accepted = JSON.parse(await runCliInDir(projectRoot, [
        "indexer", "accept-material-answer-run", "--input", acceptPath, "--format", "json",
      ]));
      expect(accepted.observation).toMatchObject({
        accepted: 1,
        pending: 0,
        next_refs: [],
        state: "material-required",
      });

      const recovered = JSON.parse(await runCliInDir(projectRoot, [
        "indexer", "prepare-material-answer-runs", "--input", preparePath, "--format", "json",
      ]));
      expect(recovered.observation).toMatchObject({ accepted: 1, next_refs: [] });
    });
  });
});
