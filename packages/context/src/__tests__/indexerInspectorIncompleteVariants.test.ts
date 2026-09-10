import { expect, test } from "bun:test";
import { assertIndexerInspectorProfileVariants, indexerInspectorFactPayloadSchema } from "../indexerControlledProgram.js";

test("incomplete Inspector evidence can leave a configured axis unknown without inventing its value", () => {
  for (const status of ["request-material", "enrichment-unavailable", "unsupported"] as const) {
    const projection = indexerInspectorFactPayloadSchema.parse({ profile: "sample-contract", profile_variants: {},
      source_fact_refs: [], template_variables: {}, status, reason_code: "endpoint-unresolved" });
    expect(() => assertIndexerInspectorProfileVariants(projection, { endpoint: "rpc" })).not.toThrow();
    expect(projection.profile_variants).toEqual({});
    expect(projection.status).toBe(status);
    expect(() => assertIndexerInspectorProfileVariants({ ...projection, profile_variants: { endpoint: "http" } }, { endpoint: "rpc" })).toThrow("variant drifted");
  }
});

test("an available Inspector projection must actually establish the configured variant", () => {
  const projection = indexerInspectorFactPayloadSchema.parse({ profile: "sample-contract", profile_variants: {},
    source_fact_refs: ["fact:source"], template_variables: { entry: "src/contract.ts" }, status: "available" });
  expect(() => assertIndexerInspectorProfileVariants(projection, { endpoint: "rpc" })).toThrow("variant drifted");
  expect(() => assertIndexerInspectorProfileVariants({ ...projection, profile_variants: { endpoint: "rpc" } }, { endpoint: "rpc" })).not.toThrow();
});
