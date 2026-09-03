import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserCoordinateMapping,
  buildIndexerParserResolutionLock,
  indexerProtocolDigest,
  type IndexerParserRequirement,
  type IndexerParserResolutionLock,
} from "@c4a/context";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import {
  buildProjectIndexerParserExecutionPlan,
  type IndexerParserAuthorizedFile,
} from "../project/indexerParserExecutionPlanning.js";

const digest = (label: string) => indexerProtocolDigest({ label });
const SOURCE_REF = "source:example-repository";
const MODULE_REF = "module:example-module";

const operators = bundledIndexerOperatorContract();
const profiles = bundledIndexerProfileContract(operators);

function requirements(profileId: string): IndexerParserRequirement[] {
  return profiles.profiles.find((profile) => profile.id === profileId)!
    .parser_requirements;
}

function lock(requirement: IndexerParserRequirement): IndexerParserResolutionLock {
  const mapping = buildIndexerParserCoordinateMapping({
    requirement,
    resolution: "direct",
    registry: "npm",
    actual_coordinate: requirement.community_coordinate,
    abi_digest: requirement.abi_digest,
  });
  return buildIndexerParserResolutionLock({
    requirement,
    mapping,
    lock_integrity: "sha512-Y29udGV4dC1wYXJzZXItbG9jaw==",
    resolved_content_digest: digest(requirement.capability),
  });
}

function file(input: Partial<IndexerParserAuthorizedFile> & {
  normalized_path: string;
}): IndexerParserAuthorizedFile {
  return {
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    content_digest: digest(input.normalized_path),
    ...input,
  };
}

function plan(input: {
  profileId: string;
  files: IndexerParserAuthorizedFile[];
  capabilities: string[];
}) {
  const byCapability = new Map(requirements(input.profileId).map((requirement) => [
    requirement.capability,
    requirement,
  ]));
  return buildProjectIndexerParserExecutionPlan({
    profile_contract: profiles,
    profile_id: input.profileId,
    source_registry_digest: digest("source-registry"),
    authorized_files: input.files,
    parser_locks: input.capabilities.map((capability) => lock(byCapability.get(capability)!)),
  });
}

describe("0.7.4 project parser execution planning", () => {
  test("declares profile capability ranges instead of one global TypeScript requirement", () => {
    expect(requirements("monorepo-container").map((item) => item.capability)).toEqual([
      "parser.rush",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ]);
    expect(requirements("component-library").map((item) => item.capability)).toEqual([
      "parser.typescript",
      "parser.javascript",
      "parser.mdx",
      "parser.css",
      "parser.scss",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ]);
    expect(requirements("documentation-site")).toEqual([]);
  });

  test("materializes only the contract parser selected by registered file scope", () => {
    const result = plan({
      profileId: "contract-source",
      files: [file({ normalized_path: "idl/service.thrift", contract_scope: "thrift" })],
      capabilities: ["parser.thrift"],
    });

    expect(result.entries.map((entry) => entry.capability)).toEqual(["parser.thrift"]);
    expect(result.applicability.find((item) => item.capability === "parser.thrift"))
      .toMatchObject({ disposition: "applicable", role: "primary-owner" });
    expect(result.applicability.filter((item) => item.disposition === "not-applicable"))
      .toHaveLength(requirements("contract-source").length - 1);
  });

  test("makes config an enricher when Rush or OpenAPI owns the same authority domain", () => {
    const rush = plan({
      profileId: "monorepo-container",
      files: [file({ normalized_path: "rush.json" })],
      capabilities: ["parser.rush", "parser.json"],
    });
    expect(rush.entries.map((entry) => ({
      capability: entry.capability,
      domain: entry.authority_domain,
      role: entry.files[0]!.role,
    }))).toEqual([{
      capability: "parser.json",
      domain: "workspace-structure",
      role: "enricher",
    }, {
      capability: "parser.rush",
      domain: "workspace-structure",
      role: "primary-owner",
    }]);

    const openapi = plan({
      profileId: "contract-source",
      files: [file({
        normalized_path: "contracts/openapi.yaml",
        contract_scope: "openapi",
      })],
      capabilities: ["parser.openapi", "parser.yaml"],
    });
    expect(openapi.entries.map((entry) => ({
      capability: entry.capability,
      domain: entry.authority_domain,
      role: entry.files[0]!.role,
    }))).toEqual([{
      capability: "parser.openapi",
      domain: "protocol-contract",
      role: "primary-owner",
    }, {
      capability: "parser.yaml",
      domain: "protocol-contract",
      role: "enricher",
    }]);
  });

  test("records excluded and binary files without requiring a parser lock", () => {
    const result = plan({
      profileId: "web-application",
      files: [
        file({ normalized_path: "fixtures/example.ts", scope_disposition: "excluded" }),
        file({ normalized_path: "assets/logo.png", media_kind: "binary" }),
      ],
      capabilities: [],
    });

    expect(result.entries).toEqual([]);
    expect(new Set(result.applicability.map((item) => item.disposition))).toEqual(new Set([
      "excluded-by-scope",
      "unsupported-format",
    ]));
  });

  test("fails closed when an applicable parser has no exact resolution lock", () => {
    expect(() => plan({
      profileId: "web-application",
      files: [file({ normalized_path: "src/index.ts" })],
      capabilities: [],
    })).toThrow(/lacks a resolution lock/);
  });
});
