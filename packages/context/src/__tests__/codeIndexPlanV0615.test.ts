import { describe, expect, test } from "bun:test";
import { extractTs, source } from "../index.js";

describe("0.6.15 code index plans", () => {
  test("supports Context-owned entries and requires a plan for entry-free scan mode", () => {
    const sampleLib = source("sample-lib");
    const configured = extractTs({
      source: sampleLib,
      collection: "codegraph",
      include: ["src/**/*.ts"],
      entries: ["./src/api.ts", "src/admin.ts", "src/api.ts"],
    });
    const scan = extractTs({
      source: sampleLib,
      collection: "codegraph",
      include: ["app/**/*.ts"],
      mode: "scan",
    });

    expect(configured).toMatchObject({
      mode: "exports",
      entries: ["src/api.ts", "src/admin.ts"],
      exportedOnly: true,
    });
    expect(scan).toMatchObject({
      mode: "scan",
      include: ["app/**/*.ts"],
      exportedOnly: false,
    });
    expect(scan.entries).toBeUndefined();
    expect(scan.indexPlan).toBe("inferred");
  });

  test("accepts an explicit stable index plan", () => {
    const sampleLib = source("sample-lib");
    const phase = extractTs({
      source: sampleLib,
      collection: "codegraph",
      indexUnits: [{
        id: "sample-public-api",
        inputSources: ["sample-lib"],
        outputOwner: "sample-lib",
        moduleType: "sdk-library",
        moduleTypes: ["sdk-library", "adapter"],
        facets: ["public-api", "plugin-extension"],
        moduleTypeEvidence: ["package.json exports and src/index.ts"],
        documents: ["./README.md", "docs/public-api.md"],
        outputProfile: "public-api-reference",
        responsibility: "Document the public package contract.",
        entries: ["src/index.ts"],
        pageKinds: ["module-map", "public-contract"],
        protocols: [],
        dependencies: [],
        exclusions: ["src/internal/**"],
        capability: "complete",
      }],
    });

    expect(phase.indexUnits).toEqual([expect.objectContaining({
      id: "sample-public-api",
      outputOwner: "sample-lib",
      outputProfile: "public-api-reference",
      moduleTypes: ["sdk-library", "adapter"],
      facets: ["public-api", "plugin-extension"],
      documents: ["README.md", "docs/public-api.md"],
    })]);
    expect(phase.indexPlan).toBe("declared");
  });

  test("does not combine unknown with a known module archetype", () => {
    const sampleLib = source("sample-lib");
    expect(() => extractTs({
      source: sampleLib,
      collection: "codegraph",
      indexUnits: [{
        id: "sample",
        inputSources: ["sample-lib"],
        outputOwner: "sample",
        moduleType: "unknown",
        moduleTypes: ["sdk-library"],
        moduleTypeEvidence: ["classification remains unresolved"],
        outputProfile: "module-map",
        responsibility: "Inspect the module.",
        entries: ["src/index.ts"],
        pageKinds: ["module-map"],
        protocols: [],
        dependencies: [],
        exclusions: [],
        capability: "complete",
      }],
    })).toThrow("cannot combine unknown with a known module type");
  });

  test("rejects unsupported enum values at runtime", () => {
    const sampleLib = source("sample-lib");
    const base = {
      id: "sample",
      inputSources: ["sample-lib"],
      outputOwner: "sample",
      moduleType: "sdk-library" as const,
      moduleTypeEvidence: ["src/index.ts public entry"],
      outputProfile: "public-api-reference" as const,
      responsibility: "Document the supported public boundary.",
      entries: ["src/index.ts"],
      pageKinds: ["public-api-reference"],
      protocols: [],
      dependencies: [],
      exclusions: [],
      lifecycle: "authoritative" as const,
      capability: "complete" as const,
    };

    for (const [field, indexUnit] of [
      ["moduleType", { ...base, moduleType: "application" as never }],
      ["moduleTypes", { ...base, moduleTypes: ["sdk-library", "application" as never] }],
      ["facets", { ...base, facets: ["public-api", "screen-routing" as never] }],
      ["outputProfile", { ...base, outputProfile: "bff-contract" as never }],
      ["lifecycle", { ...base, lifecycle: "copied" as never }],
      ["capability", { ...base, capability: "best-effort" as never }],
    ] as const) {
      expect(() => extractTs({
        source: sampleLib,
        collection: "codegraph",
        indexUnits: [indexUnit],
      }), field).toThrow(`.${field}`);
    }
  });

  test("accepts authoritative contract sources and cross-module flow profiles", () => {
    const schemas = source("schemas");
    const phase = extractTs({
      source: schemas,
      collection: "codegraph",
      indexUnits: [{
        id: "schema-contracts",
        inputSources: ["schemas"],
        outputOwner: "schema-contracts",
        moduleType: "contract-source",
        moduleTypeEvidence: ["schema/service.proto"],
        facets: ["protocol-provider"],
        outputProfile: "cross-module-flow",
        responsibility: "Locate the authoritative operations used across modules.",
        entries: [],
        pageKinds: ["cross-module-flow"],
        protocols: ["schema/service.proto"],
        dependencies: [],
        exclusions: [],
        lifecycle: "authoritative",
        capability: "complete",
      }],
    });

    expect(phase.indexUnits[0]).toMatchObject({
      moduleType: "contract-source",
      outputProfile: "cross-module-flow",
    });
  });
});
