import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import {
  parseStyleSources,
  styleSourcesToEvidenceAdapterResult,
  type StyleEvidenceAdapterInvocation,
} from "../index.js";

const files = {
  "components/Button/Button.module.scss": `
@use "../../tokens";
@import "./reset.css";
$button-radius: 4px !default;

.Button {
  --button-color: var(--color-primary);
  color: var(--button-color);

  &:hover,
  &[data-state="open"],
  &--primary,
  &.is-loading {
    border-radius: $button-radius;
  }
}
`,
  "components/Button/reset.css": ".reset { appearance: none; }",
  "_tokens.scss": ":root { --color-primary: blue; }\n@property --surface { syntax: '<color>'; inherits: true; initial-value: white; }",
  "README.md": "not style source",
} as const;

function invocation(sourceFiles: Readonly<Record<string, string>> = files): StyleEvidenceAdapterInvocation {
  return {
    adapter: {
      id: "extract-style",
      package: "@c4a/extract-style",
      export: "styleSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: indexerEvidenceAdapterProtocolDigest("extract-style@0.7.0"),
    },
    authorized_scope: {
      source_ref: "source:repository",
      module_refs: ["module:components"],
      scope_digest: indexerEvidenceAdapterProtocolDigest("scope"),
    },
    input_digest: indexerEvidenceAdapterProtocolDigest(sourceFiles),
    precedence: 20,
    module_refs: Object.fromEntries(Object.keys(sourceFiles).map((path) => [path, "module:components"])),
  };
}

describe("CSS and SCSS lightweight evidence", () => {
  test("catalogs registered imports, tokens, selectors, states, variants, and component candidates", () => {
    const documents = parseStyleSources(files);
    const button = documents.find((document) => document.path === "components/Button/Button.module.scss")!;

    expect(button.disposition).toBe("analyzed");
    expect(button.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "use", resolution: "registered", resolved_path: "_tokens.scss" }),
      expect.objectContaining({ kind: "import", resolution: "registered", resolved_path: "components/Button/reset.css" }),
    ]));
    expect(button.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "$button-radius", syntax: "scss-variable", configurable: true }),
      expect.objectContaining({ name: "--button-color", syntax: "custom-property" }),
    ]));
    expect(button.token_references.map((item) => item.name)).toEqual(expect.arrayContaining(["$button-radius", "--button-color", "--color-primary"]));
    expect(button.selectors.flatMap((item) => item.class_names)).toEqual(expect.arrayContaining(["Button", "is-loading"]));
    expect(button.variants_and_states).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidence_kind: "pseudo-class", name: "hover" }),
      expect.objectContaining({ evidence_kind: "state-attribute", name: "data-state" }),
      expect.objectContaining({ evidence_kind: "class-modifier", name: "primary" }),
      expect.objectContaining({ evidence_kind: "class-modifier", name: "is-loading" }),
    ]));
    expect(button.component_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ basis: "module-file", name: "Button" }),
      expect.objectContaining({ basis: "class-root", name: "Button" }),
    ]));
    expect(documents.find((document) => document.path === "README.md")?.disposition).toBe("excluded");
  });

  test("catalogs CSS custom properties and @property without exposing values", () => {
    const tokens = parseStyleSources(files).find((document) => document.path === "_tokens.scss")!.tokens;
    expect(tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "--color-primary", syntax: "custom-property", value_digest: expect.stringMatching(/^sha256:/) }),
      expect.objectContaining({ name: "--surface", syntax: "property-rule", value_digest: null }),
    ]));
    expect(JSON.stringify(tokens)).not.toContain("blue");
  });

  test("publishes lightweight Evidence with no coverage denominators or raw declaration values", () => {
    const result = styleSourcesToEvidenceAdapterResult(files, invocation());
    const button = result.files.find((file) => file.normalized_path === "components/Button/Button.module.scss")!;
    const serialized = JSON.stringify(result);

    expect(button.coverage_tier).toBe("lightweight-evidence");
    expect(button.facts.length).toBeGreaterThan(0);
    expect(button.facts.every((fact) => fact.denominator === "none")).toBe(true);
    expect(button.facts.some((fact) => fact.kind === "style-selector")).toBe(true);
    expect(button.facts.some((fact) => fact.kind === "style-variant-state")).toBe(true);
    expect(serialized).not.toContain("4px");
    expect(serialized).not.toContain("blue");
  });

  test("keeps unresolved relative imports explicit but never fetches external imports", () => {
    const input = {
      "styles/a.css": "@import './missing.css'; @import url('https://example.test/theme.css?token=private'); .a {}",
    };
    const document = parseStyleSources(input)[0]!;
    expect(document.disposition).toBe("analyzed");
    expect(document.imports).toEqual([
      expect.objectContaining({ resolution: "unresolved", specifier: "./missing.css" }),
      expect.objectContaining({ resolution: "external", specifier: null }),
    ]);
    expect(document.diagnostics[0]?.code).toBe("style-import-unresolved");
    const result = styleSourcesToEvidenceAdapterResult(input, invocation(input));
    expect(JSON.stringify(result)).not.toContain("token=private");
  });

  test("rejects invalid syntax and dynamic selector/import sources without partial facts", () => {
    for (const [path, source, code] of [
      ["styles/broken.css", ".a { color: red", "style-source-unsupported"],
      ["styles/dynamic.scss", ".item-#{$kind} { color: red; }", "style-selector-unsupported"],
      ["styles/import.scss", "@use \"theme-#{$name}\";", "style-import-dynamic-unsupported"],
    ] as const) {
      const input = { [path]: source };
      const result = styleSourcesToEvidenceAdapterResult(input, invocation(input));
      expect(result.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true);
    }
  });

  test("does not treat keyframe steps as component selectors", () => {
    const document = parseStyleSources({ "styles/motion.css": "@keyframes fade { from { opacity: 0 } to { opacity: 1 } } .fade { animation: fade 1s }" })[0]!;
    expect(document.selectors).toHaveLength(1);
    expect(document.selectors[0]?.class_names).toEqual(["fade"]);
  });
});
