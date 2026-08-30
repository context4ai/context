import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import {
  contractSourcesToEvidenceAdapterResult,
  parseContractSources,
  type ContractEvidenceAdapterInvocation,
} from "../index.js";

const openApiFiles = {
  "api/openapi.yaml": `
openapi: "3.1.0"
info: { title: Catalog, version: "1" }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200":
          description: internal response prose
          content:
            application/json:
              schema: { $ref: "schemas.yaml#/components/schemas/Pet" }
    post:
      operationId: createPet
      deprecated: true
components:
  schemas:
    LocalError:
      type: object
      properties: { message: { type: string } }
`,
  "api/schemas.yaml": `
components:
  schemas:
    Pet:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
`,
  "notes/config.yaml": "enabled: true",
} as const;

const graphQlFiles = {
  "graphql/schema.graphql": `
schema { query: RootQuery, mutation: RootMutation }
type RootQuery { product: Product }
type RootMutation { updateProduct: Product @deprecated(reason: "old") }
type Query { mustNotBecomeRoot: String }
type Product { id: ID! }
`,
  "graphql/product-extension.graphql": `
extend type Product { name: String }
query ReadProduct { product { id } }
`,
} as const;

function invocation(files: Readonly<Record<string, string>>): ContractEvidenceAdapterInvocation {
  return {
    adapter: {
      id: "extract-contract",
      package: "@c4a/extract-contract",
      export: "contractSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: indexerEvidenceAdapterProtocolDigest("extract-contract@0.7.0"),
    },
    authorized_scope: {
      source_ref: "source:repository",
      module_refs: ["module:contracts"],
      scope_digest: indexerEvidenceAdapterProtocolDigest("scope"),
    },
    input_digest: indexerEvidenceAdapterProtocolDigest(files),
    precedence: 10,
    module_refs: Object.fromEntries(Object.keys(files).map((path) => [path, "module:contracts"])),
  };
}

describe("OpenAPI and GraphQL contract catalog", () => {
  test("catalogs OpenAPI endpoints, operations, schemas, and registered external references", () => {
    const documents = parseContractSources(openApiFiles);
    const root = documents.find((document) => document.path === "api/openapi.yaml")!;
    const schemas = documents.find((document) => document.path === "api/schemas.yaml")!;

    expect(root).toMatchObject({ format: "openapi", version: "3.1.0", disposition: "analyzed" });
    expect(root.endpoints).toEqual([expect.objectContaining({ path_or_type: "/pets" })]);
    expect(root.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "listPets", operation_kind: "get", deprecated: false }),
      expect.objectContaining({ name: "createPet", operation_kind: "post", deprecated: true }),
    ]));
    expect(root.types).toEqual([expect.objectContaining({ name: "LocalError", field_names: ["message"] })]);
    expect(root.references).toEqual([expect.objectContaining({ target_path: "api/schemas.yaml", target_item_path: "components/schemas/Pet" })]);
    expect(schemas).toMatchObject({ format: "openapi-fragment", disposition: "analyzed" });
    expect(schemas.types).toEqual([expect.objectContaining({ name: "Pet", field_names: ["id", "name"] })]);
    expect(documents.find((document) => document.path === "notes/config.yaml")?.disposition).toBe("excluded");
  });

  test("supports JSON documents and array JSON Pointer segments", () => {
    const files = {
      "api.json": JSON.stringify({ openapi: "3.1.0", info: { title: "A", version: "1" }, paths: {}, components: { schemas: { First: { $ref: "parts.json#/0" } } } }),
      "parts.json": JSON.stringify([{ type: "string" }]),
    };
    const root = parseContractSources(files).find((document) => document.path === "api.json")!;
    expect(root.disposition).toBe("analyzed");
    expect(root.references[0]).toMatchObject({ target_path: "parts.json", target_item_path: "0" });
  });

  test("rejects missing, escaping, remote, nested-base, and missing-pointer refs without partial facts", () => {
    const cases: ReadonlyArray<{ ref: string; code: string; extra?: Readonly<Record<string, string>> }> = [
      { ref: "missing.yaml#/Pet", code: "openapi-ref-missing" },
      { ref: "../secret.yaml#/Pet", code: "openapi-ref-out-of-scope" },
      { ref: "https://example.test/schema.yaml#/Pet", code: "openapi-ref-out-of-scope" },
      { ref: "parts.yaml#/missing", code: "openapi-ref-pointer-missing", extra: { "api/parts.yaml": "Pet: { type: string }" } },
    ];
    for (const item of cases) {
      const files = {
        "api/openapi.yaml": `openapi: "3.1.0"\ninfo: { title: A, version: "1" }\npaths: {}\ncomponents: { schemas: { Pet: { $ref: "${item.ref}" } } }`,
        ...(item.extra ?? {}),
      };
      const result = contractSourcesToEvidenceAdapterResult(files, invocation(files));
      const root = result.files.find((file) => file.normalized_path === "api/openapi.yaml")!;
      expect(root).toMatchObject({ disposition: "unsupported", facts: [] });
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === item.code)).toBe(true);
    }

    const nestedBase = {
      "api/openapi.yaml": `openapi: "3.1.0"\ninfo: { title: A, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $id: "urn:pet"\n      allOf: [{ $ref: "parts.yaml#/Pet" }]`,
      "api/parts.yaml": "Pet: { type: string }",
    };
    const result = contractSourcesToEvidenceAdapterResult(nestedBase, invocation(nestedBase));
    expect(result.files.find((file) => file.normalized_path === "api/openapi.yaml")).toMatchObject({ disposition: "unsupported", facts: [] });
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "openapi-ref-base-uri-unsupported")).toBe(true);
  });

  test("marks external reference cycles and every dependent root unsupported", () => {
    const files = {
      "api/openapi.yaml": "openapi: '3.1.0'\ninfo: { title: A, version: '1' }\npaths: {}\ncomponents: { schemas: { Root: { $ref: 'a.yaml#/A' } } }",
      "api/a.yaml": "A: { $ref: 'b.yaml#/B' }",
      "api/b.yaml": "B: { $ref: 'a.yaml#/A' }",
    };
    const result = contractSourcesToEvidenceAdapterResult(files, invocation(files));
    expect(result.files.every((file) => file.disposition === "unsupported" && file.facts.length === 0)).toBe(true);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "openapi-external-ref-cycle")).toHaveLength(2);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "openapi-ref-target-unsupported")).toBe(true);
  });

  test("resolves GraphQL extensions and honors explicit schema root types", () => {
    const documents = parseContractSources(graphQlFiles);
    const schema = documents.find((document) => document.path === "graphql/schema.graphql")!;
    const extension = documents.find((document) => document.path === "graphql/product-extension.graphql")!;

    expect(schema.disposition).toBe("analyzed");
    expect(schema.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "product", operation_kind: "query", parent: "RootQuery" }),
      expect.objectContaining({ name: "updateProduct", operation_kind: "mutation", deprecated: true }),
    ]));
    expect(schema.operations.some((operation) => operation.name === "mustNotBecomeRoot")).toBe(false);
    expect(extension.operations).toEqual([expect.objectContaining({ name: "ReadProduct", parent: "executable-document" })]);
    expect(extension.types).toEqual([expect.objectContaining({ name: "Product", extension: true, field_names: ["name"] })]);
    expect(extension.references).toEqual([expect.objectContaining({ target_path: "graphql/schema.graphql", target_item_path: "type:Product" })]);
  });

  test("rejects missing or ambiguous GraphQL bases without partial facts", () => {
    const missing = { "graphql/extension.graphql": "extend type Product { name: String }" };
    const missingResult = contractSourcesToEvidenceAdapterResult(missing, invocation(missing));
    expect(missingResult.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
    expect(missingResult.diagnostics[0]?.code).toBe("graphql-extension-base-missing");

    const ambiguous = {
      "graphql/a.graphql": "type Product { id: ID! }",
      "graphql/b.graphql": "type Product { name: String }",
      "graphql/c.graphql": "extend type Product { price: Int }",
    };
    const result = contractSourcesToEvidenceAdapterResult(ambiguous, invocation(ambiguous));
    expect(result.files.every((file) => file.disposition === "unsupported" && file.facts.length === 0)).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "graphql-extension-base-ambiguous")).toBe(true);
  });

  test("publishes the common Evidence ABI without source prose and rejects syntax errors", () => {
    const result = contractSourcesToEvidenceAdapterResult(openApiFiles, invocation(openApiFiles));
    const root = result.files.find((file) => file.normalized_path === "api/openapi.yaml")!;
    const serialized = JSON.stringify(result);

    expect(root.coverage_tier).toBe("ast-catalog");
    expect(root.facts.some((fact) => fact.kind === "generated-source-boundary")).toBe(true);
    expect(root.facts.some((fact) => fact.kind === "contract-operation")).toBe(true);
    expect(root.facts.some((fact) => fact.kind === "contract-reference")).toBe(true);
    expect(root.facts.some((fact) => fact.kind === "protocol-disposition")).toBe(true);
    expect(serialized).not.toContain("internal response prose");
    expect(result.toolchain[0]!.capabilities).toEqual(expect.arrayContaining(["parser.openapi", "parser.graphql"]));

    const broken = { "graphql/broken.graphql": "type Query { broken: }" };
    const brokenResult = contractSourcesToEvidenceAdapterResult(broken, invocation(broken));
    expect(brokenResult.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
    expect(brokenResult.diagnostics[0]?.code).toBe("contract-source-unsupported");
  });

  test("rejects non-portable registered source paths", () => {
    expect(() => parseContractSources({ "../api.yaml": "openapi: '3.1.0'" })).toThrow("not portable");
  });
});
