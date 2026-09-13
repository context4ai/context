import { expect, test } from "bun:test";
import { loadRevisionProtocolDependencies, revisionProtocolDeclarations } from "../project/revisionProtocolDeclarations.js";
import * as proto from "@c4a/extract-proto";
import * as thrift from "@c4a/extract-thrift";

test.each([
  { capability: "parser.proto", parser: proto, entry: "api.proto", dependency: "types.proto",
    content: 'syntax = "proto3"; // import "unrelated.proto";\nimport public "types.proto"; service Search { rpc Find(Request) returns (Request); }',
    imported: 'syntax = "proto3"; import "api.proto"; message Request { string name = 1; }' },
  { capability: "parser.thrift", parser: thrift, entry: "idl/api.thrift", dependency: "idl/types.thrift",
    content: '# include "unrelated.thrift"\ninclude "types.thrift"\nservice Search { types.Request Find() }',
    imported: 'include "api.thrift"\nstruct Request { 1: string name }' },
])("$capability loads cyclic imports once and emits only selected declarations", async ({ capability, parser, entry, dependency, content, imported }) => {
  const reads: string[] = [];
  const initial = { [entry]: content };
  const texts = await loadRevisionProtocolDependencies(capability, parser, initial, [entry, dependency, "unrelated.proto"], async path => {
    reads.push(path);
    expect(path).toBe(dependency);
    return imported;
  });
  expect(reads).toEqual([dependency]);
  expect(Object.keys(initial)).toEqual([entry]);
  const declarations = revisionProtocolDeclarations(capability, parser, texts, [entry]);
  expect(declarations.map(item => item.name)).toEqual(["Search.Find"]);
});

test("protocol dependency reads reject missing, escaping and changed sources", async () => {
  for (const dependency of ["missing.proto", "../outside.proto", "/outside.proto"]) {
    const reads: string[] = [];
    await expect(loadRevisionProtocolDependencies("parser.proto", proto, {
      "api.proto": `syntax = "proto3"; import "${dependency}";`,
    }, ["api.proto"], async path => { reads.push(path); return ""; })).rejects.toThrow();
    expect(reads).toEqual([]);
  }
  await expect(loadRevisionProtocolDependencies("parser.proto", proto, {
    "api.proto": 'syntax = "proto3"; import "types.proto";',
  }, ["api.proto", "types.proto"], async () => { throw new Error("captured source changed"); })).rejects.toThrow("captured source changed");
});

test("protocol regeneration rejects parser diagnostics instead of emitting a partial result", () => {
  expect(() => revisionProtocolDeclarations("parser.proto", proto, {
    "valid.proto": 'syntax = "proto3"; message Request { string name = 1; }',
    "broken.proto": 'syntax = "proto3"; message Broken {',
  })).toThrow("broken.proto");
  expect(() => revisionProtocolDeclarations("parser.thrift", thrift, {
    "broken.thrift": "struct Broken {",
  })).toThrow("broken.thrift");
});

test("protocol methods retain their service identity when names overlap", () => {
  const declarations = revisionProtocolDeclarations("parser.proto", proto, {
    "api.proto": 'syntax = "proto3"; message Request {} service One { rpc Find(Request) returns (Request); } service Two { rpc Find(Request) returns (Request); }',
  });
  expect(declarations.map(item => item.name)).toEqual(["Request", "One.Find", "Two.Find"]);
});
