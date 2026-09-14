import { expect, test } from "bun:test";
import * as contract from "@c4a/extract-contract";
import { projectIndexerPublicContractTable } from "@c4a/context";
import { loadRevisionContractDependencies, revisionContractDeclarations } from "../project/revisionContractDeclarations.js";

test("nested contract dependencies are already root-relative and are not joined twice", async () => {
  const reads: string[] = [];
  const texts = await loadRevisionContractDependencies(contract,
    { "contracts/api.json": '{"$ref":"./types.json#/User"}' },
    ["contracts/api.json", "contracts/types.json"], async path => { reads.push(path); return '{"User":{"type":"string"}}'; });
  expect(reads).toEqual(["contracts/types.json"]);
  expect(Object.keys(texts)).toEqual(["contracts/api.json", "contracts/types.json"]);
});

test("GraphQL regeneration retains schema fields and operation owners", () => {
  const declarations = revisionContractDeclarations(contract, {
    "schema.graphql": "type User { id: ID!, name: String } type Query { user(id: ID!): User }",
  });
  const rows = declarations.flatMap(item => projectIndexerPublicContractTable({ value: item.value })?.rows ?? []);
  expect(rows.some(row => row[0] === "User" && row[1] === "id" && row[2] === "ID!")).toBe(true);
  expect(rows.some(row => row[0] === "Query.user")).toBe(true);
});

test("OpenAPI regeneration retains parameter declarations and schema fields", () => {
  const declarations = revisionContractDeclarations(contract, {
    "api.json": JSON.stringify({ openapi: "3.0.3", info: { title: "Example", version: "1" },
      paths: { "/users": { get: { operationId: "listUsers", parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 20 } }], responses: { "200": { description: "OK" } } } } },
      components: { schemas: { User: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } },
    }),
  });
  const rows = declarations.flatMap(item => projectIndexerPublicContractTable({ value: item.value })?.rows ?? []);
  expect(rows.some(row => row[1] === "limit" && row[2] === "integer" && row[4] === "20")).toBe(true);
  expect(rows.some(row => row[0] === "User" && row[1] === "name" && row[3] === "required")).toBe(true);
});

test("contract regeneration does not pretend ordinary configuration or broken schemas are contracts", () => {
  expect(() => revisionContractDeclarations(contract, { "config.json": '{"enabled":true}' })).toThrow("config.json");
  expect(() => revisionContractDeclarations(contract, { "schema.graphql": "type Broken {" })).toThrow("schema.graphql");
});

test("contract dependencies use captured files without publishing their declarations", async () => {
  const initial = { "api.json": JSON.stringify({ openapi: "3.0.3", info: { title: "Example", version: "1" }, paths: {},
    components: { schemas: { User: { $ref: "types.json#/components/schemas/User" } } },
  }) };
  const reads: string[] = [];
  const texts = await loadRevisionContractDependencies(contract, initial, ["api.json", "types.json", "unrelated.json"], async path => {
    reads.push(path);
    return JSON.stringify({ components: { schemas: { User: { type: "object", properties: { name: { type: "string" } } } } } });
  });
  expect(reads).toEqual(["types.json"]);
  expect(Object.keys(initial)).toEqual(["api.json"]);
  const declarations = revisionContractDeclarations(contract, texts, ["api.json"]);
  expect(declarations.every(item => item.file === "api.json")).toBe(true);
  expect(declarations.length).toBeGreaterThan(0);
  await expect(loadRevisionContractDependencies(contract, initial, ["api.json"], async () => {
    throw new Error("must not read outside captured source");
  })).rejects.toThrow("outside the captured source");
});
