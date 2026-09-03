import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserExecutionPlan,
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerProtocolDigest,
  mergeIndexerEvidenceAdapterExecutions,
  type IndexerEvidenceAdapterResult,
} from "../index.js";

const digest = (label: string) => indexerProtocolDigest({ label });
const SOURCE_REF = "source:contracts";
const MODULE_REF = "module:api";
const PATH = "contracts/openapi.yaml";
const CONTENT_DIGEST = digest("openapi-source");

function executionPlan() {
  return buildIndexerParserExecutionPlan({
    profile_contract_digest: digest("profile"),
    source_registry_digest: digest("sources"),
    entries: [{
      capability: "parser.openapi",
      requirement_digest: digest("openapi-requirement"),
      parser_lock_digest: digest("openapi-lock"),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      authority_domain: "protocol-contract",
      precedence: 100,
      files: [{
        normalized_path: PATH,
        content_digest: CONTENT_DIGEST,
        contract_scope: "openapi",
        role: "primary-owner",
      }],
    }, {
      capability: "parser.yaml",
      requirement_digest: digest("yaml-requirement"),
      parser_lock_digest: digest("yaml-lock"),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      authority_domain: "protocol-contract",
      precedence: 50,
      files: [{
        normalized_path: PATH,
        content_digest: CONTENT_DIGEST,
        contract_scope: "openapi",
        role: "enricher",
      }],
    }],
    applicability: [{
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      content_digest: CONTENT_DIGEST,
      contract_scope: "openapi",
      capability: "parser.openapi",
      authority_domain: "protocol-contract",
      disposition: "applicable",
      role: "primary-owner",
    }, {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      content_digest: CONTENT_DIGEST,
      contract_scope: "openapi",
      capability: "parser.yaml",
      authority_domain: "protocol-contract",
      disposition: "applicable",
      role: "enricher",
    }],
  });
}

function adapterResult(input: {
  capability: "parser.openapi" | "parser.yaml";
  role: "primary-owner" | "enricher";
  precedence: number;
  disposition?: "analyzed" | "unsupported";
}): IndexerEvidenceAdapterResult {
  const packageName = input.capability === "parser.openapi"
    ? "@c4a/extract-contract"
    : "@c4a/extract";
  const exportName = input.capability === "parser.openapi"
    ? "contractSourcesToEvidenceAdapterResult"
    : "configSourcesToEvidenceAdapterResult";
  const kind = input.capability === "parser.openapi" ? "contract-operation" : "config-value";
  const locator = {
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    normalized_path: PATH,
    qualified_item_path: kind,
    signature_digest: digest(`${kind}-signature`),
  };
  const disposition = input.disposition ?? "analyzed";
  const payload: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: {
      id: input.capability,
      package: packageName,
      export: exportName,
      version: "0.7.1",
      digest: digest(`${input.capability}-package`),
    },
    authorized_scope: {
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
      scope_digest: digest(`${input.capability}-scope`),
    },
    input_digest: digest(`${input.capability}-input`),
    precedence: input.precedence,
    files: [{
      file_ref: indexerEvidenceAdapterFileRef({
        source_ref: SOURCE_REF,
        module_ref: MODULE_REF,
        normalized_path: PATH,
      }),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: PATH,
      role: input.role,
      coverage_tier: input.role === "primary-owner" ? "ast-catalog" : "lightweight-evidence",
      disposition,
      facts: disposition === "analyzed" ? [{
        fact_ref: indexerEvidenceAdapterFactRef({ ...locator, kind }),
        kind,
        locator,
        payload_digest: digest(`${kind}-payload`),
        denominator: input.role === "primary-owner" ? "protocol-item" : "none",
      }] : [],
    }],
    diagnostics: [],
    toolchain: [{
      step: input.capability === "parser.openapi" ? "parse-contract" : "parse-config",
      package: packageName,
      export: exportName,
      version: "0.7.1",
      digest: digest(`${input.capability}-package`),
      capabilities: [input.capability],
      input_digest: digest(`${input.capability}-input`),
      output_digest: digest(`${input.capability}-output`),
    }],
  };
  return { ...payload, output_digest: indexerEvidenceAdapterOutputDigest(payload) };
}

describe("0.7.4 authority-aware Evidence Adapter merge", () => {
  test("merges one protocol owner and one config enricher for the same file", () => {
    const plan = executionPlan();
    const merged = mergeIndexerEvidenceAdapterExecutions({
      execution_plan: plan,
      executions: [{
        capability: "parser.yaml",
        authority_domain: "protocol-contract",
        source_ref: SOURCE_REF,
        module_ref: MODULE_REF,
        result: adapterResult({
          capability: "parser.yaml",
          role: "enricher",
          precedence: 50,
        }),
      }, {
        capability: "parser.openapi",
        authority_domain: "protocol-contract",
        source_ref: SOURCE_REF,
        module_ref: MODULE_REF,
        result: adapterResult({
          capability: "parser.openapi",
          role: "primary-owner",
          precedence: 100,
        }),
      }],
    });

    expect(merged.primary_owners).toHaveLength(1);
    expect(merged.primary_owners[0]).toMatchObject({
      capability: "parser.openapi",
      authority_domain: "protocol-contract",
      disposition: "analyzed",
    });
    expect(merged.facts.map((fact) => fact.capability).sort()).toEqual([
      "parser.openapi",
      "parser.yaml",
    ]);
    expect(merged.blockers).toEqual([]);
    expect(merged.merge_digest).toBe(indexerProtocolDigest({
      protocol: merged.protocol,
      execution_plan_digest: merged.execution_plan_digest,
      result_digests: merged.result_digests,
      primary_owners: merged.primary_owners,
      facts: merged.facts,
      conflicts: merged.conflicts,
      blockers: merged.blockers,
      toolchain_digest: merged.toolchain_digest,
    }));
  });

  test("keeps unsupported primary files as blockers and rejects partial execution", () => {
    const plan = executionPlan();
    const primary = adapterResult({
      capability: "parser.openapi",
      role: "primary-owner",
      precedence: 100,
      disposition: "unsupported",
    });
    const enricher = adapterResult({
      capability: "parser.yaml",
      role: "enricher",
      precedence: 50,
    });
    const executions = [{
      capability: "parser.openapi",
      authority_domain: "protocol-contract",
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      result: primary,
    }, {
      capability: "parser.yaml",
      authority_domain: "protocol-contract",
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      result: enricher,
    }];

    expect(mergeIndexerEvidenceAdapterExecutions({
      execution_plan: plan,
      executions,
    }).blockers).toEqual([expect.objectContaining({
      capability: "parser.openapi",
      disposition: "unsupported",
    })]);
    expect(() => mergeIndexerEvidenceAdapterExecutions({
      execution_plan: plan,
      executions: executions.slice(0, 1),
    })).toThrow(/unexecuted entries/);
  });
});
