import { describe, expect, test } from "bun:test";
import {
  analyzeIndexerSubjectKeySchemaTransition,
  authorizeIndexerSubjectReidentification,
  canonicalIndexerNodeRef,
  enforceIndexerSubjectKeySchemaTransition,
  indexerOperatorContractDigest,
  indexerProfileContractDigest,
  indexerProtocolDigest,
  indexerResolvedSubjectKeySchemaDigest,
  indexerSubjectKeySchemaDigest,
  parseIndexerProviderManifest,
  requireIndexerSubjectKeySchemaBinding,
  resolveIndexerSubjectKeySchemas,
  validateIndexerSubjectKeyForSchema,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerResolvedSubjectKeySchema,
  type IndexerSubjectKey,
  type IndexerSubjectKeyContract,
} from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function operators(): IndexerOperatorContract {
  const payload: Omit<IndexerOperatorContract, "contract_digest"> = {
    protocol: "context.indexer.operator-contract/v1",
    version: "1.0.0",
    selector_operators: ["all-inventory"],
    grouping_operators: ["by-subject-key"],
    metric_operators: [],
    threshold_operators: [],
    selector_fact_paths: ["target.eligible"],
  };
  return { ...payload, contract_digest: indexerOperatorContractDigest(payload) };
}

function profileContract(operatorContract = operators()): IndexerProfileContract {
  const payload: Omit<IndexerProfileContract, "contract_digest"> = {
    protocol: "context.indexer.profile-contract/v1",
    version: "1.0.0",
    operator_contract_version: operatorContract.version,
    operator_contract_digest: operatorContract.contract_digest,
    coverage_domains: [
      "technical-structure",
      "public-contract",
      "business-semantics",
      "operations",
    ],
    profiles: [{
      id: "component-library",
      parser_requirements: [],
      inventory_domains: [{
        id: "inventory",
        selector: { operator: "all-inventory" },
        disposition_required: true,
      }],
      required_dispositions: ["owned"],
      metrics: [],
      artifact_policy_variants: [],
      question_target_domains: [{
        id: "components",
        selector: { operator: "all-inventory" },
        grouping_operator: "by-subject-key",
        subject_key_kind: "component",
        granularity: "identity",
      }],
      reader_question_contracts: [],
      layout_mappings: [],
      variant_schema: { axes: [] },
    }],
    subject_key_schemas: [{
      profile: "component-library",
      version: 1,
      namespace: { operator: "canonical-source-module-namespace" },
      kinds: [{
        id: "component",
        local_key: { operator: "canonical-export-family" },
      }],
      normalization: ["trim", "unicode-nfc", "preserve-case"],
    }],
  };
  return { ...payload, contract_digest: indexerProfileContractDigest(payload) };
}

function extensionManifest(version = "1.2.0") {
  return parseIndexerProviderManifest([
    "protocol: context.indexer.provider/v1",
    "id: example-indexer",
    `version: ${version}`,
    "domains: [code]",
    "activation:",
    "  target_kinds: [package]",
    "  required_signals:",
    "    - { id: source-present, description: Source is present. }",
    "  supporting_signals: []",
    "  negative_signals: []",
    "provides:",
    "  profiles: [example/framework-application]",
    "  operations:",
    "    - { id: main-index, consumes: context.indexer.main-workset/v1, produces: context.indexer.main-result/v1 }",
    "provider:",
    "  instructions:",
    "    - { path: references/indexer.md, profiles: [example/framework-application] }",
    "composition:",
    "  extensions:",
    "    - profile: example/framework-application",
    "      extends: component-library",
    "      subject_key_schema:",
    "        version: 1",
    "        namespace: { operator: canonical-source-module-namespace }",
    "        kinds:",
    "          - id: application",
    "            local_key: { operator: canonical-module-identity }",
    "        normalization: [trim, unicode-nfc, preserve-case]",
    "",
  ].join("\n"));
}

function resolved(input: {
  profile?: string;
  schema: IndexerSubjectKeyContract;
  providerVersion?: string;
}): IndexerResolvedSubjectKeySchema {
  const profile = input.profile ?? "example/framework-application";
  const payload: Omit<IndexerResolvedSubjectKeySchema, "resolved_digest"> = {
    protocol: "context.indexer.resolved-subject-key-schema/v1",
    indexer_id: "workspace-code",
    profile,
    authority: {
      kind: "provider-extension",
      extends: "component-library",
      provider_layer_id: "framework",
      provider_id: "example-indexer",
      provider_version: input.providerVersion ?? "1.2.0",
      provider_integrity: DIGEST_A,
      manifest_digest: DIGEST_B,
    },
    schema: input.schema,
    schema_digest: indexerSubjectKeySchemaDigest(profile, input.schema),
  };
  return { ...payload, resolved_digest: indexerResolvedSubjectKeySchemaDigest(payload) };
}

const OLD_SCHEMA: IndexerSubjectKeyContract = {
  version: 1,
  namespace: { operator: "canonical-source-module-namespace" },
  kinds: [{
    id: "application",
    local_key: { operator: "canonical-module-identity" },
  }],
  normalization: ["trim", "unicode-nfc", "preserve-case"],
};

const APPROVED_ONE: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "example/app",
  kind: "application",
  local_key: "main",
};

const APPROVED_TWO: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "example/other",
  kind: "application",
  local_key: "main",
};

describe("SubjectKey schema authority and re-identification", () => {
  test("resolves community and extension authority into one canonical digest set", () => {
    const operatorContract = operators();
    const contract = profileContract(operatorContract);
    const manifest = extensionManifest();
    const set = resolveIndexerSubjectKeySchemas({
      profile_contract: contract,
      operator_contract: operatorContract,
      selections: [{
        indexer_id: "workspace-code",
        profile: "component-library",
        role: "primary",
        provider_layer_id: "community",
      }, {
        indexer_id: "workspace-code",
        profile: "example/framework-application",
        role: "extension",
        provider_layer_id: "framework",
      }],
      providers: [{
        indexer_id: "workspace-code",
        provider_layer_id: "community",
        provider_integrity: DIGEST_A,
        manifest_digest: DIGEST_B,
        manifest: parseIndexerProviderManifest([
          "protocol: context.indexer.provider/v1",
          "id: community-indexer",
          "version: 1.0.0",
          "domains: [code]",
          "activation:",
          "  target_kinds: [package]",
          "  required_signals:",
          "    - { id: source-present, description: Source is present. }",
          "  supporting_signals: []",
          "  negative_signals: []",
          "provides:",
          "  profiles: [component-library]",
          "  operations:",
          "    - { id: main-index, consumes: context.indexer.main-workset/v1, produces: context.indexer.main-result/v1 }",
          "provider:",
          "  instructions:",
          "    - { path: references/indexer.md, profiles: [component-library] }",
          "",
        ].join("\n")),
      }, {
        indexer_id: "workspace-code",
        provider_layer_id: "framework",
        provider_integrity: DIGEST_B,
        manifest_digest: DIGEST_A,
        manifest,
      }],
    });
    expect(set.schemas.map((schema) => schema.authority.kind)).toEqual([
      "community-base",
      "provider-extension",
    ]);
    expect(set.set_digest).toBe(indexerProtocolDigest({
      protocol: set.protocol,
      schemas: set.schemas,
    }));
    expect(requireIndexerSubjectKeySchemaBinding({
      schema_set: set,
      indexer_id: "workspace-code",
      profile: "component-library",
      schema_digest: set.schemas[0]!.schema_digest,
    })).toEqual(set.schemas[0]!);
    expect(() => requireIndexerSubjectKeySchemaBinding({
      schema_set: set,
      indexer_id: "workspace-code",
      profile: "component-library",
      schema_digest: DIGEST_A,
    })).toThrow(/stale/);
    expect(validateIndexerSubjectKeyForSchema({
      protocol: "context.subject-key/v1",
      namespace: "example/pkg",
      kind: "component",
      local_key: "Button",
    }, set.schemas[0])).toBeTruthy();
    expect(() => validateIndexerSubjectKeyForSchema({
      protocol: "context.subject-key/v1",
      namespace: " example/pkg ",
      kind: "component",
      local_key: "Button",
    }, set.schemas[0])).toThrow(/trim normalization/);
  });

  test("rejects missing, non-owner, and ambiguous extension authorities", () => {
    const operatorContract = operators();
    const contract = profileContract(operatorContract);
    const manifest = extensionManifest();
    const selection = [{
      indexer_id: "workspace-code",
      profile: "example/framework-application",
      role: "extension" as const,
      provider_layer_id: "framework",
    }];
    expect(() => resolveIndexerSubjectKeySchemas({
      profile_contract: contract,
      operator_contract: operatorContract,
      selections: selection,
      providers: [],
    })).toThrow(/no exact owner/);

    const authority = {
      indexer_id: "workspace-code",
      provider_layer_id: "framework",
      provider_integrity: DIGEST_A,
      manifest_digest: DIGEST_B,
      manifest,
    };
    expect(() => resolveIndexerSubjectKeySchemas({
      profile_contract: contract,
      operator_contract: operatorContract,
      selections: selection,
      providers: [authority, {
        ...authority,
        provider_layer_id: "impostor",
        manifest: extensionManifest("1.3.0"),
      }],
    })).toThrow(/unique owner authority/);
  });

  test("treats added kinds as compatible and does not request a Gate", () => {
    const nextSchema: IndexerSubjectKeyContract = {
      ...OLD_SCHEMA,
      version: 2,
      kinds: [...OLD_SCHEMA.kinds, {
        id: "route",
        local_key: { operator: "canonical-module-identity" },
      }],
    };
    const transition = {
      old_schema: resolved({ schema: OLD_SCHEMA }),
      new_schema: resolved({ schema: nextSchema }),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(APPROVED_ONE),
        subject_key: APPROVED_ONE,
      }],
      proposed_mappings: [],
    };
    const report = analyzeIndexerSubjectKeySchemaTransition(transition);
    expect(report).toMatchObject({
      classification: "compatible",
      affected_node_refs: [],
      gate_required: false,
      activation_allowed: true,
      issues: [],
    });
    expect(enforceIndexerSubjectKeySchemaTransition({
      report,
      ...transition,
      project_ref: "project:example",
    })).toEqual(report);
  });

  test("requires a Provider major and an exact non-delegable Gate for approved Nodes", () => {
    const nextSchema: IndexerSubjectKeyContract = {
      ...OLD_SCHEMA,
      version: 2,
      namespace: { operator: "canonical-service-namespace" },
    };
    const newSubject: IndexerSubjectKey = {
      ...APPROVED_ONE,
      namespace: "service/example-app",
    };
    const withoutMajorTransition = {
      old_schema: resolved({ schema: OLD_SCHEMA, providerVersion: "1.2.0" }),
      new_schema: resolved({ schema: nextSchema, providerVersion: "1.3.0" }),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(APPROVED_ONE),
        subject_key: APPROVED_ONE,
      }],
      proposed_mappings: [{
        old_node_ref: canonicalIndexerNodeRef(APPROVED_ONE),
        new_subject_key: newSubject,
      }],
    };
    const withoutMajor = analyzeIndexerSubjectKeySchemaTransition(withoutMajorTransition);
    expect(withoutMajor.issues).toContain("authority-major-not-increased");
    expect(() => enforceIndexerSubjectKeySchemaTransition({
      report: withoutMajor,
      ...withoutMajorTransition,
      project_ref: "project:example",
    })).toThrow(/blocked/);

    const transition = {
      old_schema: resolved({ schema: OLD_SCHEMA, providerVersion: "1.2.0" }),
      new_schema: resolved({ schema: nextSchema, providerVersion: "2.0.0" }),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(APPROVED_ONE),
        subject_key: APPROVED_ONE,
      }],
      proposed_mappings: [{
        old_node_ref: canonicalIndexerNodeRef(APPROVED_ONE),
        new_subject_key: newSubject,
      }],
    };
    const report = analyzeIndexerSubjectKeySchemaTransition(transition);
    expect(report).toMatchObject({
      classification: "identity-breaking",
      gate_required: true,
      activation_allowed: true,
      missing_node_refs: [],
      collisions: [],
    });
    const reportWithoutDigest = Object.fromEntries(
      Object.entries(report).filter(([key]) => key !== "report_digest"),
    );
    const forgedPayload = {
      ...reportWithoutDigest,
      affected_node_refs: [],
      gate_required: false,
    };
    const forged = {
      ...forgedPayload,
      report_digest: indexerProtocolDigest(forgedPayload),
    };
    expect(() => enforceIndexerSubjectKeySchemaTransition({
      report: forged,
      ...transition,
      project_ref: "project:example",
    })).toThrow(/not recomputed/);
    expect(() => enforceIndexerSubjectKeySchemaTransition({
      report,
      ...transition,
      project_ref: "project:example",
    })).toThrow();
    const authorization = authorizeIndexerSubjectReidentification({
      report,
      project_ref: "project:example",
      authorized_by: "human:reviewer",
      authorized_at: "2026-08-27T12:00:00.000Z",
    });
    expect(authorization.non_delegable).toBe(true);
    expect(enforceIndexerSubjectKeySchemaTransition({
      report,
      ...transition,
      project_ref: "project:example",
      authorization,
    })).toEqual(report);
    expect(() => enforceIndexerSubjectKeySchemaTransition({
      report,
      ...transition,
      project_ref: "project:other",
      authorization,
    })).toThrow(/stale|another transition/);
  });

  test("reports missing mappings, ambiguity, and collisions and blocks activation", () => {
    const nextSchema: IndexerSubjectKeyContract = {
      ...OLD_SCHEMA,
      version: 2,
      namespace: { operator: "canonical-service-namespace" },
    };
    const approved = [APPROVED_ONE, APPROVED_TWO].map((subjectKey) => ({
      node_ref: canonicalIndexerNodeRef(subjectKey),
      subject_key: subjectKey,
    }));
    const commonNew: IndexerSubjectKey = {
      protocol: "context.subject-key/v1",
      namespace: "service/shared",
      kind: "application",
      local_key: "main",
    };
    const faulty = analyzeIndexerSubjectKeySchemaTransition({
      old_schema: resolved({ schema: OLD_SCHEMA, providerVersion: "1.2.0" }),
      new_schema: resolved({ schema: nextSchema, providerVersion: "2.0.0" }),
      approved_subjects: approved,
      proposed_mappings: [{
        old_node_ref: approved[0]!.node_ref,
        new_subject_key: commonNew,
      }, {
        old_node_ref: approved[0]!.node_ref,
        new_subject_key: { ...commonNew, local_key: "alternate" },
      }],
    });
    expect(faulty.issues).toEqual(expect.arrayContaining([
      "missing-mapping",
      "ambiguous-mapping",
    ]));
    expect(faulty.splits).toHaveLength(1);

    const collisionTransition = {
      old_schema: resolved({ schema: OLD_SCHEMA, providerVersion: "1.2.0" }),
      new_schema: resolved({ schema: nextSchema, providerVersion: "2.0.0" }),
      approved_subjects: approved,
      proposed_mappings: approved.map((item) => ({
        old_node_ref: item.node_ref,
        new_subject_key: commonNew,
      })),
    };
    const collision = analyzeIndexerSubjectKeySchemaTransition(collisionTransition);
    expect(collision.issues).toContain("collision");
    expect(collision.merges).toHaveLength(1);
    expect(collision.collisions).toHaveLength(1);
    expect(() => enforceIndexerSubjectKeySchemaTransition({
      report: collision,
      ...collisionTransition,
      project_ref: "project:example",
    })).toThrow(/collision/);
  });

  test("skips the human Gate when no approved Node exists but keeps conformance hard", () => {
    const nextSchema: IndexerSubjectKeyContract = {
      ...OLD_SCHEMA,
      version: 2,
      namespace: { operator: "canonical-service-namespace" },
    };
    const transition = {
      old_schema: resolved({ schema: OLD_SCHEMA, providerVersion: "1.2.0" }),
      new_schema: resolved({ schema: nextSchema, providerVersion: "2.0.0" }),
      approved_subjects: [],
      proposed_mappings: [],
    };
    const report = analyzeIndexerSubjectKeySchemaTransition(transition);
    expect(report).toMatchObject({
      classification: "identity-breaking",
      gate_required: false,
      activation_allowed: true,
    });
    expect(enforceIndexerSubjectKeySchemaTransition({
      report,
      ...transition,
      project_ref: "project:empty",
    })).toEqual(report);
  });
});
