import { expect, test } from "bun:test";
import { openApiSourceDependencies } from "../openApiParser.js";

test("OpenAPI dependency discovery shares relative path rules and ignores local pointers", () => {
  expect(openApiSourceDependencies("contracts/api.yaml", `
first: { $ref: 'types.yaml#/User' }
second: { $ref: 'types.yaml#/Other' }
local: { $ref: '#/first' }
dynamic: { $dynamicRef: 'extra.json#/$defs/Value' }
description: '$ref: fake.yaml'
`)).toEqual(["contracts/types.yaml", "contracts/extra.json"]);
});

test("OpenAPI dependency discovery rejects remote, escaping and rebased references", () => {
  for (const ref of ["https://example.org/api.json", "../outside.json", "/outside.json"]) {
    expect(() => openApiSourceDependencies("api.json", JSON.stringify({ $ref: ref }))).toThrow("scope");
  }
  expect(() => openApiSourceDependencies("api.json", JSON.stringify({ $id: "other/", $ref: "types.json" }))).toThrow("$id");
  expect(() => openApiSourceDependencies("api.json", "{ broken")).toThrow();
  expect(openApiSourceDependencies("schema.graphql", "type Query { name: String }")).toEqual([]);
});

test("relative dot segments resolve inside the captured root, never outside it", () => {
  expect(openApiSourceDependencies("contracts/api.json", JSON.stringify({
    allOf: [{ $ref: "./types.json#/User" }, { $ref: "../shared.json#/Item" }],
  }))).toEqual(["contracts/types.json", "shared.json"]);
  expect(() => openApiSourceDependencies("contracts/api.json", '{"$ref":"../../outside.json"}')).toThrow("scope");
});
