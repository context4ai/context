import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerArtifactBundle,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  buildIndexerCustomizationPlan,
  canonicalIndexerNodeRef,
  indexerArtifactResultDigest,
  indexerEvidenceBindingDigest,
  indexerProviderBundleIntegrity,
  indexerRenderedArtifactDigest,
  resolvedProviderReceiptDigest,
  validateIndexerRenderedArtifact,
  type ExpectedProviderResolution,
  type IndexerArtifactResult,
  type IndexerRegistryEntry,
  type IndexerSubjectKey,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { loadIndexerCustomization } from "../project/indexerCustomization.js";
import {
  materializeIndexerTemplate,
  renderIndexerTemplateArtifact,
  validateMaterializedIndexerTemplate,
} from "../project/indexerTemplateRendering.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};

function templateSource(summaryBody = "# {{variable:title}}\n\n{{variable:summary}}") {
  return [
    "---",
    "protocol: context.indexer.template/v1",
    "template_id: guide",
    "profile: component-library",
    "reader_goal: understand-capability",
    "applicability:",
    "  artifact_policy_variants: [standard]",
    "  condition_refs: [condition:public-component]",
    "variables:",
    "  - id: title",
    "    type: string",
    "    content_layer: semantic-prose",
    "    required: true",
    "    evidence_required: true",
    "    maximum_length: 120",
    "  - id: summary",
    "    type: string",
    "    content_layer: semantic-prose",
    "    required: true",
    "    evidence_required: true",
    "    maximum_length: 2000",
    "  - id: examples",
    "    type: string-list",
    "    content_layer: deterministic-fact",
    "    required: false",
    "    evidence_required: true",
    "    maximum_items: 8",
    "deterministic_blocks:",
    "  - id: example-list",
    "    renderer: bullet-list",
    "    source_variable_id: examples",
    "sections:",
    "  - section_key: summary",
    "    presence: required",
    "    question_ref: question:component-summary",
    "    reader_goal: understand-capability",
    "    variable_ids: [title, summary]",
    "    deterministic_block_ids: []",
    "    accepted_evidence_kinds: [code, documentation]",
    "    minimum_evidence_items: 1",
    "    on_missing: request-input",
    "    deletion_condition: Never delete; request current source evidence.",
    "  - section_key: examples",
    "    presence: optional",
    "    question_ref: question:component-examples",
    "    reader_goal: integrate-safely",
    "    variable_ids: [examples]",
    "    deterministic_block_ids: [example-list]",
    "    accepted_evidence_kinds: [code, documentation]",
    "    minimum_evidence_items: 1",
    "    on_missing: omit",
    "    deletion_condition: Omit when no current example evidence exists.",
    "page_policy:",
    "  split_suggestion: Split only when examples form an independent reader task.",
    "  semantic_boundaries: [capability, integration-example]",
    "  keep_single_page_conditions: [one-subject, short-example-set]",
    "anonymous_section_examples: [A capability summary backed by a public source.]",
    "anti_examples: [A symbol-by-symbol inventory without a reader task.]",
    "forbidden_outputs: [Unsupported claims and placeholder prose.]",
    "maximum_rendered_bytes: 65536",
    "---",
    "<!-- context:indexer-section summary -->",
    summaryBody,
    "<!-- /context:indexer-section -->",
    "<!-- context:indexer-section examples -->",
    "## Examples",
    "",
    "{{block:example-list}}",
    "<!-- /context:indexer-section -->",
    "",
  ].join("\n");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function manifestSource(): string {
  return [
    "protocol: context.indexer.provider/v1",
    "id: context-indexer-sample",
    "version: 1.2.0",
    "domains: [code]",
    "activation:",
    "  target_kinds: [package]",
    "  required_signals:",
    "    - { id: source, description: Contains current source files. }",
    "  supporting_signals: []",
    "  negative_signals: []",
    "provides:",
    "  profiles: [component-library]",
    "  operations:",
    "    - id: main-index",
    "      consumes: context.indexer.main-workset/v1",
    "      produces: context.indexer.main-result/v1",
    "provider:",
    "  templates:",
    "    - { id: guide, profile: component-library, path: templates/guide.md }",
    "customization:",
    "  supports: [template-override]",
    "",
  ].join("\n");
}

function registry(expected: ExpectedProviderResolution, customized = false): IndexerRegistryEntry {
  return {
    id: expected.indexerId,
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "workspace-knowledge",
      coverage_domains: ["public-contract"],
      owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
    profile: {
      primary: { id: "component-library", provider: expected.providerId },
      additional: [],
      composers: [],
    },
    providers: [{
      id: expected.providerId,
      role: "primary",
      skill: expected.skill,
      version: expected.version,
      integrity: expected.integrity,
      distribution: expected.distribution,
    }],
    ...(customized ? { customization: { mode: "extend" as const } } : {}),
  };
}

async function setup(customTemplate?: string) {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-template-"));
  const transport = join(root, "transport");
  await mkdir(join(transport, "templates"), { recursive: true });
  const manifest = Buffer.from(manifestSource());
  const template = Buffer.from(templateSource());
  await writeFile(join(transport, "context-indexer.yaml"), manifest);
  await writeFile(join(transport, "templates", "guide.md"), template);
  const files = [
    { path: "context-indexer.yaml", digest: sha256(manifest) },
    { path: "templates/guide.md", digest: sha256(template) },
  ];
  const integrity = indexerProviderBundleIntegrity(files);
  const expected: ExpectedProviderResolution = {
    indexerId: "component-indexer",
    providerId: "community",
    skill: "context-indexer-sample",
    version: "1.2.0",
    integrity,
    distribution: { kind: "workspace", locator: "workspace://sample-provider" },
  };
  const bundle: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: expected.indexerId,
      provider_id: expected.providerId,
      skill: expected.skill,
      version: expected.version,
      distribution: expected.distribution,
    },
    resolved: {
      integrity,
      manifest_digest: files[0]!.digest,
      issuer: "sample-publisher",
      trust: "verified",
    },
    transport: {
      kind: "directory",
      path: transport,
      expires_at: "2026-08-27T12:05:00.000Z",
    },
    files,
    receipt: {
      resolver: "sample-host/1.0.0",
      resolved_at: NOW.toISOString(),
      authority_ref: "host-provider:sample",
      receipt_digest: integrity,
    },
  };
  bundle.receipt.receipt_digest = resolvedProviderReceiptDigest(bundle);
  const staged = await stageIndexerProviderBundle({
    envelope: bundle,
    expected,
    runtimeRoot: join(root, "runtime"),
    now: NOW,
  });
  if (customTemplate !== undefined) {
    const customRoot = join(root, "src", "indexer", expected.indexerId, "templates");
    await mkdir(customRoot, { recursive: true });
    await writeFile(join(customRoot, "guide.md"), [
      "<!-- @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library -->",
      customTemplate,
    ].join("\n"));
  }
  const manifestValue = await import("@c4a/context").then(({ loadIndexerProviderManifest }) =>
    loadIndexerProviderManifest(staged.stage_path)
  );
  const customization = await loadIndexerCustomization({
    workspaceRoot: root,
    projectRef: "project:sample",
    indexer: registry(expected, customTemplate !== undefined),
    manifest: manifestValue,
    providerIntegrity: integrity,
    ...(customTemplate === undefined
      ? {}
      : {
          customizationPlan: buildIndexerCustomizationPlan({
            project_ref: "project:sample",
            indexer_id: expected.indexerId,
            provider_integrity: integrity,
            capability_gap_digest: digest("e"),
            selected_step: "template-override",
            rejected_smaller_steps: ["provider-only", "config", "instructions-append"]
              .map((step, index) => ({
                step: step as "provider-only" | "config" | "instructions-append",
                disposition: "insufficient" as const,
                reason_code: `${step}-insufficient`,
                evidence_digest: digest(String(index + 1)),
              })),
            affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
            introduces_external_dependencies: false,
          }),
        }),
  });
  const materialized = await materializeIndexerTemplate({
    bundle,
    staged,
    customization,
    workspaceRoot: root,
    templateId: "guide",
    profile: "component-library",
  });
  return { root, bundle, staged, expected, customization, materialized };
}

function artifactResult(input: {
  summary?: string;
  examples?: string[];
  gap?: boolean;
  providerIntegrity?: string;
  customizationFingerprint?: string | null;
} = {}): IndexerArtifactResult {
  const evidencePayload = {
    evidence_ref: "evidence:button-source",
    kind: "code" as const,
    source_ref: "repo:sample@revision",
    module_ref: "module:sample",
    locator: { path: "src/button.ts", start_line: 1, end_line: 20 },
    content_digest: digest("a"),
    coverage_tier: "ast-catalog" as const,
  };
  const evidence = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
  const variables: Record<string, {
    value: string | string[];
    fact_refs: string[];
    evidence_refs: string[];
  }> = {
    title: { value: "Button", fact_refs: [], evidence_refs: [evidence.evidence_ref] },
  };
  if (input.summary !== undefined) {
    variables.summary = {
      value: input.summary,
      fact_refs: [],
      evidence_refs: [evidence.evidence_ref],
    };
  }
  const facts = (input.examples ?? []).map((example, index) => ({
    fact_ref: `fact:button-example-${index + 1}`,
    fact_kind: "component-example",
    subject_key: SUBJECT,
    value: example,
    evidence_refs: [evidence.evidence_ref],
  }));
  if (input.examples !== undefined) {
    variables.examples = {
      value: input.examples,
      fact_refs: facts.map((fact) => fact.fact_ref),
      evidence_refs: [evidence.evidence_ref],
    };
  }
  const gap = input.gap === true;
  const payload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: digest("1"),
    partition_plan_binding_digest: digest("2"),
    group_projection_digest: digest("3"),
    indexer_id: "component-indexer",
    provider_layer_ref: "provider:community#primary",
    provider_integrity: input.providerIntegrity ?? digest("4"),
    provider_bundle_digest: digest("5"),
    config_fingerprint: digest("6"),
    customization_fingerprint: input.customizationFingerprint ?? null,
    requirement_ref: "requirement:workspace-knowledge",
    source_ref: evidence.source_ref,
    module_ref: evidence.module_ref,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: "component:button",
      subject_key: SUBJECT,
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: digest("1"),
      group_projection_digest: digest("3"),
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      member_ids: ["member:button"],
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: digest("1"),
      group_projection_digest: digest("3"),
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      dispositions: gap
        ? [{
            member_id: "member:button",
            member_kind: "component",
            inventory_disposition: "request-material",
            material_question_proposal_ref: "proposal:component-summary-gap",
          }]
        : [{
            member_id: "member:button",
            member_kind: "component",
            inventory_disposition: "owned",
            projection_disposition: "detailed",
            section_evidence: [{
              artifact_id: "button-guide",
              section_key: "summary",
              evidence_refs: [evidence.evidence_ref],
            }],
          }],
    }),
    facts,
    evidence_bindings: [evidence],
    artifacts: [{
      artifact_id: "button-guide",
      artifact_kind: "overview",
      artifact_policy_variant: "standard",
      representation: "template",
      template_id: "guide",
      variables,
      section_projections: [
        {
          section_key: "summary",
          owner_indexer_id: "component-indexer",
          document_kind: "reference",
          reader_goal: "understand-capability",
          artifact_kind: "overview",
        },
        {
          section_key: "examples",
          owner_indexer_id: "component-indexer",
          document_kind: "reference",
          reader_goal: "integrate-safely",
          artifact_kind: "overview",
        },
      ],
    }],
    artifact_bundle: buildIndexerArtifactBundle({
      logical_unit_ref: canonicalIndexerNodeRef(SUBJECT),
      artifact_policy_variant: "standard",
      artifacts: [{
        artifact_id: "button-guide",
        artifact_kind: "overview",
        purpose: "required",
        reader_question_refs: ["question:component-summary"],
        evidence_refs: [evidence.evidence_ref],
      }],
    }),
    material_question_proposals: gap ? [{
      proposal_ref: "proposal:component-summary-gap",
      requirement_ref: "requirement:workspace-knowledge",
      question_ref: "question:component-summary",
      question_target_key: "question-target:button-summary",
      answer_landing_hint: { artifact_id: "button-guide", section_key: "summary" },
      source_hints: [evidence.source_ref],
    }] : [],
    question_target_dispositions: gap ? [{
      question_target_key: "question-target:button-summary",
      state: "material-gap",
      material_question_proposal_ref: "proposal:component-summary-gap",
    }] : [{
      question_target_key: "question-target:button-summary",
      state: "answered",
      evidence_binding_digest: evidence.binding_digest,
    }],
    diagnostics: [],
    input_digest: digest("7"),
  };
  return { ...payload, output_digest: indexerArtifactResultDigest(payload) };
}

const QUESTION_BINDINGS = [{
  section_key: "summary",
  question_ref: "question:component-summary",
  question_target_key: "question-target:button-summary",
}];
const CONDITIONS = ["condition:public-component"];

function boundArtifactResult(
  materialized: {
    provider_integrity: string;
    customization_fingerprint: string | null;
  },
  input: Parameters<typeof artifactResult>[0],
): IndexerArtifactResult {
  return artifactResult({
    ...input,
    providerIntegrity: materialized.provider_integrity,
    customizationFingerprint: materialized.customization_fingerprint,
  });
}

describe("Indexer template materialization and rendering", () => {
  test("renders required content, deterministic blocks, and deletes unused optional Sections", async () => {
    const setupValue = await setup();
    validateMaterializedIndexerTemplate(setupValue.materialized);
    const withoutExamples = renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, {
        summary: "A reusable public control.",
      }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    });
    expect(withoutExamples.review_ready).toBe(true);
    expect(withoutExamples.sections.map((section) => section.section_key)).toEqual(["summary"]);
    expect(withoutExamples.sections[0]?.markdown).toContain("A reusable public control.");
    expect(validateIndexerRenderedArtifact(withoutExamples)).toEqual(withoutExamples);
    const forgedRendered = structuredClone(withoutExamples);
    forgedRendered.sections[0]!.markdown += "\nforged";
    const forgedPayload = Object.fromEntries(
      Object.entries(forgedRendered).filter(([key]) => key !== "rendered_digest"),
    ) as Omit<typeof forgedRendered, "rendered_digest">;
    forgedRendered.rendered_digest = indexerRenderedArtifactDigest(forgedPayload);
    expect(() => validateIndexerRenderedArtifact(forgedRendered)).toThrow("Section summary integrity");

    const withExamples = renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, {
        summary: "A reusable public control.",
        examples: ["Use a stable label.", "Bind the public event."],
      }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    });
    expect(withExamples.sections[1]?.markdown).toContain("- Use a stable label.");
    expect(withExamples.sections[1]?.evidence_refs).toEqual(["evidence:button-source"]);
    expect(withExamples.sections[1]?.content_blocks.map((block) => block.layer)).toEqual([
      "semantic-prose",
      "deterministic-block",
    ]);
    expect(withExamples.sections[1]?.content_blocks[1]?.fact_refs).toEqual([
      "fact:button-example-1",
      "fact:button-example-2",
    ]);
  });

  test("turns a required data/evidence gap into the exact material question before Review", async () => {
    const setupValue = await setup();
    const rendered = renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, { gap: true }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    });
    expect(rendered.review_ready).toBe(false);
    expect(rendered.sections).toEqual([]);
    expect(rendered.material_question_gaps).toEqual([{
      section_key: "summary",
      question_ref: "question:component-summary",
      question_target_key: "question-target:button-summary",
      material_question_proposal_ref: "proposal:component-summary-gap",
    }]);

    const inconsistent = boundArtifactResult(setupValue.materialized, { gap: true });
    inconsistent.material_question_proposals = [];
    inconsistent.question_target_dispositions = [];
    const payload = Object.fromEntries(
      Object.entries(inconsistent).filter(([key]) => key !== "output_digest"),
    ) as Omit<IndexerArtifactResult, "output_digest">;
    inconsistent.output_digest = indexerArtifactResultDigest(payload);
    expect(() => renderIndexerTemplateArtifact({
      artifactResult: inconsistent,
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    })).toThrow("material question transition");
  });

  test("hard-fails unresolved directives, placeholder prose, wrong types, and expansion overflow", async () => {
    await expect(setup(templateSource("# {{unknown:title}}"))).rejects.toThrow(
      "unsupported directive",
    );
    const setupValue = await setup();
    const tamperedTemplate = structuredClone(setupValue.materialized);
    tamperedTemplate.section_bodies.summary += "\nforged";
    expect(() => validateMaterializedIndexerTemplate(tamperedTemplate)).toThrow("payload digest");

    expect(() => renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, {
        summary: "A valid source-backed summary.",
      }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: [],
    })).toThrow("condition identity");

    const providerDrift = boundArtifactResult(setupValue.materialized, {
      summary: "A valid source-backed summary.",
    });
    providerDrift.provider_integrity = digest("f");
    const providerPayload = Object.fromEntries(
      Object.entries(providerDrift).filter(([key]) => key !== "output_digest"),
    ) as Omit<IndexerArtifactResult, "output_digest">;
    providerDrift.output_digest = indexerArtifactResultDigest(providerPayload);
    expect(() => renderIndexerTemplateArtifact({
      artifactResult: providerDrift,
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    })).toThrow("Provider/Artifact/condition identity");

    expect(() => renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, { summary: "TODO" }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    })).toThrow("template residue");

    expect(renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, {
        summary: "A known TODO is tracked with explicit status, source, and impact.",
      }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    }).sections[0]!.markdown).toContain("known TODO");

    const wrongType = boundArtifactResult(setupValue.materialized, {
      summary: "Valid summary.",
    });
    const artifact = wrongType.artifacts[0]!;
    if (artifact.representation !== "template") throw new Error("expected template");
    artifact.variables.summary!.value = ["not", "a", "string"];
    const wrongPayload = Object.fromEntries(
      Object.entries(wrongType).filter(([key]) => key !== "output_digest"),
    ) as Omit<IndexerArtifactResult, "output_digest">;
    wrongType.output_digest = indexerArtifactResultDigest(wrongPayload);
    expect(() => renderIndexerTemplateArtifact({
      artifactResult: wrongType,
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    })).toThrow("wrong type");

    const deterministicDrift = boundArtifactResult(setupValue.materialized, {
      summary: "Valid summary.",
      examples: ["Source-backed example."],
    });
    const deterministicArtifact = deterministicDrift.artifacts[0]!;
    if (deterministicArtifact.representation !== "template") {
      throw new Error("expected template");
    }
    deterministicArtifact.variables.examples!.value = ["Invented example."];
    const deterministicPayload = Object.fromEntries(
      Object.entries(deterministicDrift).filter(([key]) => key !== "output_digest"),
    ) as Omit<IndexerArtifactResult, "output_digest">;
    deterministicDrift.output_digest = indexerArtifactResultDigest(deterministicPayload);
    expect(() => renderIndexerTemplateArtifact({
      artifactResult: deterministicDrift,
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    })).toThrow("does not equal its Fact projection");

    expect(() => renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, {
        summary: "x".repeat(2001),
      }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    })).toThrow("maximum_length");

    const wrongEvidenceKind = boundArtifactResult(setupValue.materialized, {
      summary: "A summary with the wrong evidence kind.",
    });
    const originalEvidence = wrongEvidenceKind.evidence_bindings[0]!;
    const unsupportedPayload = {
      evidence_ref: "evidence:unsupported-summary",
      kind: "configuration" as const,
      source_ref: originalEvidence.source_ref,
      module_ref: originalEvidence.module_ref,
      locator: { path: "config/sample.json", start_line: 1, end_line: 2 },
      content_digest: digest("e"),
      coverage_tier: "lightweight-evidence" as const,
    };
    wrongEvidenceKind.evidence_bindings.push({
      ...unsupportedPayload,
      binding_digest: indexerEvidenceBindingDigest(unsupportedPayload),
    });
    const wrongEvidenceArtifact = wrongEvidenceKind.artifacts[0]!;
    if (wrongEvidenceArtifact.representation !== "template") throw new Error("expected template");
    wrongEvidenceArtifact.variables.summary!.evidence_refs = [unsupportedPayload.evidence_ref];
    const evidencePayload = Object.fromEntries(
      Object.entries(wrongEvidenceKind).filter(([key]) => key !== "output_digest"),
    ) as Omit<IndexerArtifactResult, "output_digest">;
    wrongEvidenceKind.output_digest = indexerArtifactResultDigest(evidencePayload);
    expect(() => renderIndexerTemplateArtifact({
      artifactResult: wrongEvidenceKind,
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    })).toThrow("material question transition");
  });

  test("uses only the declared same-name local override and binds its origin digest", async () => {
    const local = templateSource("# {{variable:title}}\n\nLocal: {{variable:summary}}");
    const setupValue = await setup(local);
    expect(setupValue.materialized.origin).toBe("customization-override");
    const rendered = renderIndexerTemplateArtifact({
      artifactResult: boundArtifactResult(setupValue.materialized, {
        summary: "A source-backed local presentation.",
      }),
      artifactId: "button-guide",
      template: setupValue.materialized,
      questionBindings: QUESTION_BINDINGS,
      applicabilityConditionRefs: CONDITIONS,
    });
    expect(rendered.sections[0]?.markdown).toContain("Local: A source-backed");
    expect(rendered.template_origin).toBe("customization-override");
  });
});
