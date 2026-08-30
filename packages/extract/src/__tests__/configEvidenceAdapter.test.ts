import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import {
  configSourcesToEvidenceAdapterMaterialization,
  configSourcesToEvidenceAdapterResult,
  parseConfigSources,
  type ConfigEvidenceAdapterInvocation,
} from "../index.js";

const files = {
  "config/app.json": JSON.stringify({
    runtime: { port: 8080, mode: "production" },
    routes: [{ path: "/health", handler: "health.check" }],
    password: "do-not-publish",
    databasePassword: "also-private",
    callbackUrl: "https://user:password@example.invalid/callback",
    unsafeInteger: 9_007_199_254_740_992,
  }),
  "config/services.yaml": "service:\n  endpoint: https://example.invalid/api\n  token: yaml-secret\n---\nentry: ./src/main.ts\n",
  "config/release.toml": "channel = \"stable\"\nreleased_at = 2026-08-28T12:30:00Z\n[[plugins]]\nname = \"alpha\"\n[[plugins]]\nname = \"beta\"\n[credentials]\nclient_secret = \"toml-secret\"\ncallback_url = \"https://user:password@example.invalid/callback\"\n",
  "README.md": "not a config source",
} as const;

function invocation(sourceFiles: Readonly<Record<string, string>> = files): ConfigEvidenceAdapterInvocation {
  return {
    adapter: {
      id: "extract-config",
      package: "@c4a/extract",
      export: "configSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: indexerEvidenceAdapterProtocolDigest("extract-config@0.7.0"),
    },
    authorized_scope: {
      source_ref: "source:repository",
      module_refs: ["module:config"],
      scope_digest: indexerEvidenceAdapterProtocolDigest("scope"),
    },
    input_digest: indexerEvidenceAdapterProtocolDigest(sourceFiles),
    precedence: 20,
    module_refs: Object.fromEntries(Object.keys(sourceFiles).map((path) => [path, "module:config"])),
  };
}

describe("schema-neutral JSON, YAML, and TOML evidence", () => {
  test("catalogs JSON structure, types, locators, and boundary candidates without raw scalar values", () => {
    const document = parseConfigSources({ "config/app.json": files["config/app.json"] })[0]!;
    expect(document).toMatchObject({ format: "json", disposition: "analyzed" });
    expect(document.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ key_path: [], value_type: "object", classification: "container" }),
      expect.objectContaining({ key_path: ["runtime", "port"], value_type: "number", boundary_candidate: "runtime" }),
      expect.objectContaining({ key_path: ["routes", "0", "path"], value_type: "string", boundary_candidate: "route" }),
    ]));
    expect(document.values.every((value) => value.locator.line > 0 && value.locator.column > 0)).toBe(true);
    expect(document.values.find((value) => value.key_path.at(-1) === "databasePassword")).toMatchObject({ classification: "secret-like", value_digest: null });
    expect(document.values.find((value) => value.key_path.at(-1) === "callbackUrl")).toMatchObject({ classification: "secret-like", value_digest: null });
    expect(document.values.find((value) => value.key_path.at(-1) === "unsafeInteger")?.value_digest).toBeNull();
    expect(JSON.stringify(document.values)).not.toContain("/health");
    expect(JSON.stringify(document.values)).not.toContain("health.check");
    expect(JSON.stringify(document.values)).not.toContain("also-private");
  });

  test("only exposes scalars selected by an exact non-sensitive enum allowlist", () => {
    const document = parseConfigSources(
      { "config/app.json": files["config/app.json"] },
      { non_sensitive_enums: [{ path: "config/app.json", key_path: ["runtime", "mode"], allowed_values: ["development", "production"] }] },
    )[0]!;
    expect(document.values.find((value) => value.key_path.join(".") === "runtime.mode")).toMatchObject({
      classification: "enum-allowlisted",
      normalized_value: "production",
    });
    expect(() => parseConfigSources(
      { "config/app.json": files["config/app.json"] },
      { non_sensitive_enums: [{ path: "config/app.json", key_path: ["password"], allowed_values: ["do-not-publish"] }] },
    )).toThrow(/secret-like/u);
  });

  test("supports YAML multi-documents and suppresses digests for secret-like paths", () => {
    const document = parseConfigSources({ "config/services.yaml": files["config/services.yaml"] })[0]!;
    expect(document.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ key_path: ["$document", "0", "service", "endpoint"], classification: "reference-like" }),
      expect.objectContaining({ key_path: ["$document", "1", "entry"], boundary_candidate: "entry" }),
      expect.objectContaining({ key_path: ["$document", "0", "service", "token"], classification: "secret-like", value_digest: null }),
    ]));
    expect(JSON.stringify(document.values)).not.toContain("yaml-secret");
    expect(JSON.stringify(document.values)).not.toContain("example.invalid");
  });

  test("parses TOML 1.0 arrays of tables and datetime values with stable paths", () => {
    const document = parseConfigSources({ "config/release.toml": files["config/release.toml"] })[0]!;
    expect(document.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ key_path: ["released_at"], value_type: "datetime" }),
      expect.objectContaining({ key_path: ["plugins", "0", "name"], value_type: "string" }),
      expect.objectContaining({ key_path: ["plugins", "1", "name"], value_type: "string" }),
    ]));
    expect(document.values.find((value) => value.key_path.join("/") === "plugins/1/name")?.locator.line).toBe(6);
    expect(document.values.find((value) => value.key_path.join("/") === "credentials/client_secret")).toMatchObject({
      classification: "secret-like",
      value_digest: null,
    });
    expect(document.values.find((value) => value.key_path.join("/") === "credentials/callback_url")).toMatchObject({
      classification: "secret-like",
      value_digest: null,
    });
    expect(JSON.stringify(document.values)).not.toContain("toml-secret");
    expect(JSON.stringify(document.values)).not.toContain("user:password");
  });

  test("marks malformed and unstable-key inputs unsupported instead of emitting partial facts", () => {
    const documents = parseConfigSources({
      "bad.json": "{\"a\": 1,}",
      "complex.yaml": "? [one, two]\n: value\n",
      "future.toml": "value = 0x\n",
    });
    expect(documents.every((document) => document.disposition === "unsupported")).toBe(true);
    expect(documents.every((document) => document.values.length === 0)).toBe(true);
    expect(documents.every((document) => document.diagnostics[0]?.code === "config-source-unsupported")).toBe(true);
  });

  test("publishes lightweight Evidence with no source LOC or symbol denominators", () => {
    const materialized = configSourcesToEvidenceAdapterMaterialization(files, invocation(), {
      non_sensitive_enums: [{ path: "config/release.toml", key_path: ["channel"], allowed_values: ["stable", "canary"] }],
    });
    const result = materialized.result;
    expect(result.files.find((file) => file.normalized_path === "README.md")?.disposition).toBe("excluded");
    const analyzed = result.files.filter((file) => file.disposition === "analyzed");
    expect(analyzed.every((file) => file.coverage_tier === "lightweight-evidence")).toBe(true);
    expect(analyzed.flatMap((file) => file.facts).every((fact) => fact.denominator === "none")).toBe(true);
    expect(analyzed.flatMap((file) => file.facts).some((fact) => fact.kind === "config-value")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("do-not-publish");
    expect(JSON.stringify(result)).not.toContain("yaml-secret");
    expect(JSON.stringify(result)).not.toContain("toml-secret");
    expect(materialized.fact_payloads).toHaveLength(
      analyzed.flatMap((file) => file.facts).length,
    );
    expect(materialized.fact_payloads.every((item) => {
      const descriptor = analyzed.flatMap((file) => file.facts)
        .find((fact) => fact.fact_ref === item.fact_ref);
      return descriptor?.payload_digest === indexerEvidenceAdapterProtocolDigest(item.payload);
    })).toBe(true);
    expect(JSON.stringify(materialized.fact_payloads)).not.toContain("do-not-publish");
    expect(JSON.stringify(materialized.fact_payloads)).not.toContain("yaml-secret");
    expect(JSON.stringify(materialized.fact_payloads)).not.toContain("toml-secret");
  });

  test("rejects module projections outside the authorized scope", () => {
    const badInvocation = invocation({ "config/app.json": files["config/app.json"] });
    badInvocation.module_refs = { "config/app.json": "module:other" };
    expect(() => configSourcesToEvidenceAdapterResult(
      { "config/app.json": files["config/app.json"] },
      badInvocation,
    )).toThrow(/escapes authorized scope/u);
  });
});
