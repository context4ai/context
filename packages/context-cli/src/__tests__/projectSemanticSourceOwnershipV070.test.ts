import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertSemanticSourceOwnership,
  findAliasProfiles,
  findCanonicalQuestionPayloads,
  inspectCanonicalQuestionPayloadsInBundle,
} from "../project/semanticSourceOwnership.js";

const repositoryRoot = resolve(import.meta.dir, "../../../..");

describe("0.7.0 semantic source ownership report", () => {
  test("blocks authority drift after Phase G removed every registered legacy source", async () => {
    const report = await assertSemanticSourceOwnership({ repositoryRoot });

    expect(report.schema).toBe("context.semantic-source-ownership-report/v1");
    expect(report.mode).toBe("blocking");
    expect(report.blocking_eligible).toBe(true);
    expect(report.blocking_reasons).toEqual([]);
    expect(report.blocking_prerequisites).toEqual({
      migration_disposition: "complete",
      forward_fixtures: "complete",
      phase_g_cutover: true,
    });
    expect(report.summary).toEqual({
      legacy_source_count: 0,
      duplicate_taxonomy_count: 0,
      canonical_question_payload_count: 0,
      alias_profile_count: 0,
      undispositioned_source_count: 0,
      missing_migration_source_count: 0,
      cli_authority_capability_count: 10,
      cli_authority_issue_count: 0,
    });
    expect(report.cli_authority.capabilities.every((capability) => capability.current)).toBe(true);
    expect(report.cli_authority.issues).toEqual([]);
    expect(report.missing_canonical_profiles).toEqual([]);
    expect(report.legacy_sources).toEqual([]);
    expect(report.duplicate_taxonomies).toEqual([]);
    expect(report.owner_snapshot.map((rule) => rule.semantic_kind)).toEqual([
      "profile-taxonomy-template-editorial",
      "canonical-reader-question-contract",
      "mechanical-metric-threshold",
      "workflow-protocol-and-safety-baseline",
      "context-entry-body",
    ]);
  });

  test("finds a copied canonical question payload in Provider text", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-provider-question-owner-"));
    await mkdir(join(root, "provider"));
    await writeFile(join(root, "provider", "instructions.md"), [
      "# Guidance",
      "```yaml",
      "semantic: Who owns the source?",
      "version: 1",
      "selector: { kind: source }",
      "evidence_contract: { minimum: 1 }",
      "target_domain: documentation",
      "```",
      "",
    ].join("\n"));

    expect(await inspectCanonicalQuestionPayloadsInBundle({
      repositoryRoot: root,
      bundlePath: "provider",
    })).toEqual([{
      path: "provider/instructions.md",
      pointer: "$text",
      payload_keys: ["semantic", "version", "selector", "evidence_contract", "target_domain"],
    }]);
  });

  test("detects copied question contracts while allowing reference-only fixtures", () => {
    expect(findCanonicalQuestionPayloads("allowed.json", {
      reader_question_refs: ["question:source-authority"],
    })).toEqual([]);

    expect(findCanonicalQuestionPayloads("copied.yaml", {
      questions: [{
        question_ref: "question:source-authority",
        semantic: "Who owns the source?",
        version: "1",
        selector: { kind: "source" },
        evidence_contract: { minimum: 1 },
        target_domain: "documentation",
      }],
    })).toEqual([{
      path: "copied.yaml",
      pointer: "$.questions[0]",
      payload_keys: ["semantic", "version", "selector", "evidence_contract", "target_domain"],
    }]);
  });

  test("reports unknown and duplicate profile aliases independently from missing canonical ids", () => {
    expect(findAliasProfiles({
      bundle: "anonymous",
      actual: ["canonical-a", "legacy-a", "canonical-a"],
      expected: ["canonical-a", "canonical-b"],
    })).toEqual({
      aliases: [
        { bundle: "anonymous", profile: "legacy-a", reason: "unknown-profile" },
        { bundle: "anonymous", profile: "canonical-a", reason: "duplicate-profile" },
      ],
      missing: [{ bundle: "anonymous", profile: "canonical-b" }],
    });
  });
});
