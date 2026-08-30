import { describe, expect, test } from "bun:test";
import {
  buildIndexerProviderRouteInput,
  buildIndexerProviderRouteReport,
  buildValidatedIndexerCustomizationDraft,
  canonicalOwnerCellRef,
  type IndexerCustomizationDraft,
  type IndexerRegistry,
} from "../index.js";

const INTEGRITY = `sha256:${"a".repeat(64)}`;
const EVIDENCE_A = `sha256:${"b".repeat(64)}`;
const EVIDENCE_B = `sha256:${"c".repeat(64)}`;

function route() {
  const registry: IndexerRegistry = {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-system"],
      coverage_domains: {
        architecture: "required",
        public_contract: "required",
      },
      target_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
    }],
    indexers: [{
      id: "sample-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
      profile: { primary: { id: "domain-service", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: INTEGRITY,
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  };
  const input = buildIndexerProviderRouteInput({
    project_ref: "project:sample",
    registry,
    visible_skills: [{
      skill: "context-code-indexer",
      version: "0.7.0",
      source_type: "cli-bundled",
    }],
    community_fallback_attempted: true,
  });
  return { input, report: buildIndexerProviderRouteReport(input) };
}

function draft(): IndexerCustomizationDraft {
  const capabilityGap = route();
  return {
    protocol: "context.indexer.customization-proposal-draft/v1",
    capability_gap: {
      route_input: capabilityGap.input,
      route_report: capabilityGap.report,
    },
    capability_gap_digest: capabilityGap.report.capability_gap_proof!.gap_digest,
    indexer_id: "sample-indexer",
    mode: "extend",
    selected_step: "instructions-append",
    rejected_smaller_steps: [
      {
        step: "provider-only",
        disposition: "insufficient",
        reason_code: "provider-only-insufficient",
        evidence_digest: EVIDENCE_A,
      },
      {
        step: "config",
        disposition: "unsupported",
        reason_code: "config-unsupported",
        evidence_digest: EVIDENCE_B,
      },
    ],
    gap_summary: "The selected community Provider needs project terminology guidance.",
    affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
    files: [{
      path: "src/indexer/sample-indexer/instructions.md",
      content: [
        "<!-- @context-indexer-origin context-code-indexer@0.7.0 profile=domain-service -->",
        "Use the repository public-contract terminology.",
        "",
      ].join("\n"),
    }],
    dependency_intents: [],
  };
}

describe("CLI-bound minimal Indexer customization draft", () => {
  test("closes one exact fallback gap without widening beyond requirement scope", () => {
    const validated = buildValidatedIndexerCustomizationDraft(draft());
    expect(validated.capability_gap_digest).toBe(
      draft().capability_gap.route_report.capability_gap_proof!.gap_digest,
    );
    expect(validated.customization_plan).toMatchObject({
      selected_step: "instructions-append",
      workspace_mode: "extend",
      introduces_external_dependencies: false,
      requires_human_confirmation: false,
    });
    expect(validated.target_registry.indexers[0]).toMatchObject({
      customization: { mode: "extend" },
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["architecture", "public_contract"],
        role: "primary",
      }],
    });
    expect(validated.capability_gap_digest).toMatch(/^sha256:/);
    expect(validated.validation_digest).toMatch(/^sha256:/);
    expect(validated.files[0]?.path).toBe(
      "src/indexer/sample-indexer/instructions.md",
    );
    expect(validated.target_registry.indexers[0]?.requirement_bindings[0])
      .toMatchObject({
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
      });
    expect(draft().capability_gap.route_report.capability_gaps[0]?.owner_cell_ref)
      .toBe(canonicalOwnerCellRef({
      requirementRef: "workspace-knowledge",
      coverageDomain: "public_contract",
      sourceRef: "repo:sample",
      moduleRef: "module:app",
      }));
  });

  test("rejects forged gap identity, scope, origin, and ladder escalation", () => {
    const wrongGap = draft();
    wrongGap.capability_gap_digest = `sha256:${"d".repeat(64)}`;
    expect(() => buildValidatedIndexerCustomizationDraft(wrongGap)).toThrow(
      /exact CLI capability gap/,
    );

    const wrongScope = draft();
    wrongScope.affected_scope_refs = ["requirement:other#target_scope"];
    expect(() => buildValidatedIndexerCustomizationDraft(wrongScope)).toThrow(
      /affected scopes/,
    );

    const wrongOrigin = draft();
    wrongOrigin.files[0]!.content = "<!-- @context-indexer-origin other@0.7.0 profile=domain-service -->\n";
    expect(() => buildValidatedIndexerCustomizationDraft(wrongOrigin)).toThrow(
      /Provider origin/,
    );

    const escalated = draft();
    escalated.files.push({
      path: "src/indexer/sample-indexer/index.ts",
      content: "// @context-indexer-origin context-code-indexer@0.7.0 profile=domain-service\nexport {};\n",
    });
    expect(() => buildValidatedIndexerCustomizationDraft(escalated)).toThrow(
      /above its selected ladder step/,
    );
  });
});
