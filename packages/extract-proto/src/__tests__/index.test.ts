import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import { parseProtoSources, protoSourcesToEvidenceAdapterResult, type ProtoEvidenceAdapterInvocation } from "../index.js";

const files = {
  "proto/common/types.proto": `
    syntax = "proto3";
    package example.common;
    message SearchRequest { string query = 1; }
    message SearchResponse { message Item { string value = 1; } repeated Item items = 1; }
  `,
  "proto/search.proto": `
    syntax = "proto3";
    package example.search;
    import "common/types.proto";
    option java_package = "example.search.generated";
    service SearchService {
      option deprecated = false;
      rpc Search(stream example.common.SearchRequest) returns (stream example.common.SearchResponse) {
        option deprecated = false;
      }
    }
  `,
  "notes.txt": "not proto",
} as const;

function invocation(): ProtoEvidenceAdapterInvocation {
  return {
    adapter: {
      id: "extract-proto",
      package: "@c4a/extract-proto",
      export: "protoSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: indexerEvidenceAdapterProtocolDigest("extract-proto@0.7.0"),
    },
    authorized_scope: {
      source_ref: "source:repository",
      module_refs: ["module:contracts"],
      scope_digest: indexerEvidenceAdapterProtocolDigest("scope"),
    },
    input_digest: indexerEvidenceAdapterProtocolDigest(files),
    precedence: 10,
    import_roots: ["proto"],
    module_refs: {
      "proto/common/types.proto": "module:contracts",
      "proto/search.proto": "module:contracts",
    },
  };
}

describe("Protocol Buffers catalog parser", () => {
  test("extracts package, imports, nested types, options, services, and streaming RPCs", () => {
    const documents = parseProtoSources(files, { import_roots: ["proto"] });
    const common = documents.find((document) => document.path === "proto/common/types.proto")!;
    const search = documents.find((document) => document.path === "proto/search.proto")!;

    expect(common.types.map((type) => type.qualified_name)).toEqual(["SearchRequest", "SearchResponse", "SearchResponse.Item"]);
    expect(search).toMatchObject({ disposition: "analyzed", syntax: "proto3", package: "example.search" });
    expect(search.imports).toEqual([expect.objectContaining({ path: "common/types.proto", resolved_path: "proto/common/types.proto", modifier: "normal" })]);
    expect(search.options.map((option) => [option.owner, option.name])).toEqual([
      ["file", "java_package"],
      ["service:SearchService", "deprecated"],
      ["rpc:Search", "deprecated"],
    ]);
    expect(search.services[0]!.methods[0]).toMatchObject({
      name: "Search",
      input_type: "example.common.SearchRequest",
      output_type: "example.common.SearchResponse",
      client_streaming: true,
      server_streaming: true,
      locator: { path: "proto/search.proto", line: expect.any(Number), column: expect.any(Number) },
    });
    expect(documents.find((document) => document.path === "notes.txt")?.disposition).toBe("excluded");
  });

  test("publishes common Evidence ABI facts and explicit dispositions", () => {
    const result = protoSourcesToEvidenceAdapterResult(files, invocation());
    const search = result.files.find((file) => file.normalized_path === "proto/search.proto")!;
    const qualifiedPaths = search.facts.map((fact) => fact.locator.qualified_item_path);

    expect(search.coverage_tier).toBe("ast-catalog");
    expect(qualifiedPaths).toContain("generated-boundary");
    expect(qualifiedPaths).toContain("service:SearchService");
    expect(qualifiedPaths).toContain("service:SearchService:method:Search");
    expect(search.facts.some((fact) => fact.kind === "protocol-disposition")).toBe(true);
    expect(result.toolchain[0]!.capabilities).toContain("parser.proto");
  });

  test("makes missing or escaping imports unsupported without partial facts", () => {
    for (const target of ["missing.proto", "../secret.proto", "/tmp/secret.proto"]) {
      const result = protoSourcesToEvidenceAdapterResult({ "proto/broken.proto": `syntax = "proto3"; import "${target}"; service Broken { rpc Call(A) returns (B); }` }, {
        ...invocation(),
        input_digest: indexerEvidenceAdapterProtocolDigest(target),
        module_refs: { "proto/broken.proto": "module:contracts" },
      });
      expect(result.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
      expect(result.diagnostics[0]?.code).toBe("proto-source-unsupported");
    }
  });
});
