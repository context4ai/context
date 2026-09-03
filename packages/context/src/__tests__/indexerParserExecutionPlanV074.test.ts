import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserExecutionPlan,
  indexerProtocolDigest,
  validateIndexerParserExecutionPlan,
} from "../index.js";

const digest = (label: string) => indexerProtocolDigest({ label });
const SOURCE_REF = "source:example-repository";
const MODULE_REF = "module:example-application";
const PATH = "docs/card.mdx";
const CONTENT_DIGEST = digest("card-mdx");

function planInput() {
  return {
    profile_contract_digest: digest("profile-contract"),
    source_registry_digest: digest("source-registry"),
    entries: [{
      capability: "parser.mdx",
      requirement_digest: digest("mdx-requirement"),
      parser_lock_digest: digest("mdx-lock"),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      authority_domain: "code-catalog",
      precedence: 100,
      files: [{
        normalized_path: PATH,
        content_digest: CONTENT_DIGEST,
        contract_scope: null,
        role: "primary-owner" as const,
      }],
    }, {
      capability: "parser.metadata",
      requirement_digest: digest("metadata-requirement"),
      parser_lock_digest: digest("metadata-lock"),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      authority_domain: "code-catalog",
      precedence: 50,
      files: [{
        normalized_path: PATH,
        content_digest: CONTENT_DIGEST,
        contract_scope: null,
        role: "enricher" as const,
      }],
    }, {
      capability: "parser.markdown",
      requirement_digest: digest("markdown-requirement"),
      parser_lock_digest: digest("markdown-lock"),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      authority_domain: "document-semantics",
      precedence: 100,
      files: [{
        normalized_path: PATH,
        content_digest: CONTENT_DIGEST,
        contract_scope: null,
        role: "primary-owner" as const,
      }],
    }],
    applicability: [{
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      content_digest: CONTENT_DIGEST,
      contract_scope: null,
      capability: "parser.mdx",
      authority_domain: "code-catalog",
      disposition: "applicable" as const,
      role: "primary-owner" as const,
    }, {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      content_digest: CONTENT_DIGEST,
      contract_scope: null,
      capability: "parser.metadata",
      authority_domain: "code-catalog",
      disposition: "applicable" as const,
      role: "enricher" as const,
    }, {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      content_digest: CONTENT_DIGEST,
      contract_scope: null,
      capability: "parser.markdown",
      authority_domain: "document-semantics",
      disposition: "applicable" as const,
      role: "primary-owner" as const,
    }, {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: "README.md",
      content_digest: digest("readme"),
      contract_scope: null,
      capability: "parser.typescript",
      authority_domain: "code-catalog",
      disposition: "not-applicable" as const,
      reason_code: "markdown-is-not-typescript",
    }],
  };
}

describe("0.7.4 parser execution plan", () => {
  test("binds applicability, authority domains, roles, locks, and canonical digest", () => {
    const plan = buildIndexerParserExecutionPlan(planInput());

    expect(validateIndexerParserExecutionPlan(plan)).toEqual(plan);
    expect(plan.protocol).toBe("context.indexer.parser-execution-plan/v1");
    expect(plan.entries).toHaveLength(3);
    expect(plan.applicability).toHaveLength(4);
    expect(plan.plan_digest).toBe(indexerProtocolDigest({
      protocol: plan.protocol,
      profile_contract_digest: plan.profile_contract_digest,
      source_registry_digest: plan.source_registry_digest,
      entries: plan.entries,
      applicability: plan.applicability,
    }));
  });

  test("allows the same file to have one primary owner in separate authority domains", () => {
    const plan = buildIndexerParserExecutionPlan(planInput());
    const primaryApplications = plan.applicability.filter((item) =>
      item.disposition === "applicable" && item.role === "primary-owner"
    );

    expect(primaryApplications.map((item) => item.authority_domain).sort()).toEqual([
      "code-catalog",
      "document-semantics",
    ]);
  });

  test("rejects two primary owners in one source/path/authority domain", () => {
    const input = planInput();
    input.entries[1]!.files[0]!.role = "primary-owner";
    const metadataApplication = input.applicability.find((item) =>
      item.capability === "parser.metadata"
    );
    if (metadataApplication?.disposition === "applicable") {
      metadataApplication.role = "primary-owner";
    }

    expect(() => buildIndexerParserExecutionPlan(input)).toThrow(/exactly one primary owner/);
  });

  test("rejects equal precedence and missing execution/applicability bindings", () => {
    const equalPrecedence = planInput();
    equalPrecedence.entries[1]!.precedence = 100;
    expect(() => buildIndexerParserExecutionPlan(equalPrecedence)).toThrow(/equal precedence/);

    const missingApplicability = planInput();
    missingApplicability.applicability = missingApplicability.applicability.filter((item) =>
      item.capability !== "parser.metadata"
    );
    expect(() => buildIndexerParserExecutionPlan(missingApplicability)).toThrow(
      /lacks exact applicability/,
    );
  });

  test("rejects content disagreement and forged plan digests", () => {
    const contentDisagreement = planInput();
    contentDisagreement.applicability[1]!.content_digest = digest("other-card-mdx");
    expect(() => buildIndexerParserExecutionPlan(contentDisagreement)).toThrow(
      /disagrees on content digest/,
    );

    const plan = buildIndexerParserExecutionPlan(planInput());
    expect(() => validateIndexerParserExecutionPlan({
      ...plan,
      plan_digest: digest("forged"),
    })).toThrow(/digest is invalid/);
  });
});
