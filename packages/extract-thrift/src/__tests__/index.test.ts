import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import { parseThriftSources, thriftSourcesToEvidenceAdapterResult, type ThriftEvidenceAdapterInvocation } from "../index.js";

const files = {
  "idl/common.thrift": `
    namespace go example.common
    struct Request { 1: required string query }
    struct Response { 1: string value }
  `,
  "idl/search.thrift": `
    include "common.thrift"
    namespace go example.search
    typedef string SearchId
    service SearchService {
      common.Response Search(1: common.Request request) (api.stability = "stable")
      oneway void Reindex(1: SearchId id)
    } (service.owner = "search")
  `,
  "README.md": "not IDL",
} as const;

function invocation(): ThriftEvidenceAdapterInvocation {
  return {
    adapter: {
      id: "extract-thrift",
      package: "@c4a/extract-thrift",
      export: "thriftSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: indexerEvidenceAdapterProtocolDigest("extract-thrift@0.7.0"),
    },
    authorized_scope: {
      source_ref: "source:repository",
      module_refs: ["module:contracts"],
      scope_digest: indexerEvidenceAdapterProtocolDigest("scope"),
    },
    input_digest: indexerEvidenceAdapterProtocolDigest(files),
    precedence: 10,
    module_refs: {
      "idl/common.thrift": "module:contracts",
      "idl/search.thrift": "module:contracts",
    },
  };
}

describe("Thrift catalog parser", () => {
  test("extracts imports, types, services, methods, annotations, and locators", () => {
    const documents = parseThriftSources(files);
    const search = documents.find((document) => document.path === "idl/search.thrift")!;

    expect(search.disposition).toBe("analyzed");
    expect(search.imports).toEqual([expect.objectContaining({ path: "common.thrift", resolved_path: "idl/common.thrift" })]);
    expect(search.types).toEqual([expect.objectContaining({ kind: "typedef", name: "SearchId" })]);
    expect(search.services[0]).toMatchObject({
      name: "SearchService",
      methods: [
        { name: "Search", return_type: "common.Response", oneway: false },
        { name: "Reindex", return_type: "void", oneway: true },
      ],
    });
    expect(search.services[0]!.methods[0]!.locator).toMatchObject({ path: "idl/search.thrift", line: expect.any(Number), column: expect.any(Number) });
    expect(search.annotations.map((annotation) => annotation.name)).toEqual(["api.stability", "service.owner"]);
    expect(documents.find((document) => document.path === "README.md")?.disposition).toBe("excluded");
  });

  test("publishes common Evidence ABI facts and explicit dispositions", () => {
    const result = thriftSourcesToEvidenceAdapterResult(files, invocation());
    const search = result.files.find((file) => file.normalized_path === "idl/search.thrift")!;
    const qualifiedPaths = search.facts.map((fact) => fact.locator.qualified_item_path);

    expect(result.protocol).toBe("context.indexer.evidence-adapter-result/v1");
    expect(search.role).toBe("primary-owner");
    expect(search.coverage_tier).toBe("ast-catalog");
    expect(qualifiedPaths).toContain("generated-boundary");
    expect(qualifiedPaths).toContain("service:SearchService");
    expect(qualifiedPaths).toContain("service:SearchService:method:Search");
    expect(search.facts.some((fact) => fact.kind === "protocol-disposition")).toBe(true);
    expect(result.toolchain[0]!.capabilities).toContain("parser.thrift");
  });

  test("makes missing or escaping includes unsupported without partial facts", () => {
    for (const target of ["missing.thrift", "../secret.thrift", "/tmp/secret.thrift"]) {
      const result = thriftSourcesToEvidenceAdapterResult({ "idl/broken.thrift": `include "${target}"\nservice Broken { void Call() }` }, {
        ...invocation(),
        input_digest: indexerEvidenceAdapterProtocolDigest(target),
        module_refs: { "idl/broken.thrift": "module:contracts" },
      });
      expect(result.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
      expect(result.diagnostics[0]?.code).toBe("thrift-source-unsupported");
    }
  });
});
