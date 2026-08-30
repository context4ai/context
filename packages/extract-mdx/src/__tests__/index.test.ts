import { describe, expect, test } from "bun:test";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import {
  mdxSourcesToEvidenceAdapterResult,
  parseMdxSources,
  type MdxEvidenceAdapterInvocation,
  type MdxPublicTarget,
} from "../index.js";

const targets: MdxPublicTarget[] = [{
  target_ref: "public-target:button",
  export_name: "Button",
  source_module: "@fixture/ui",
}];

const files = {
  "docs/examples/button/usage.mdx": `
import {Button as Primary} from '@fixture/ui'
export {Primary as ExampleButton}

# Button usage

<Sandbox title="Preview">
  <Primary intent="strong" />
  <Unknown />
</Sandbox>

\`\`\`tsx demo title="Basic"
<Primary>Save</Primary>
\`\`\`
  `,
  "docs/alternate/usage.mdx": `
import {Button} from '@fixture/ui'

\`\`\`tsx
<Button />
\`\`\`
  `,
  "docs/delivery/guide.mdx": "# Delivery is not a live demo",
  "README.md": "# ordinary markdown",
} as const;

function invocation(): MdxEvidenceAdapterInvocation {
  return {
    adapter: {
      id: "extract-mdx",
      package: "@c4a/extract-mdx",
      export: "mdxSourcesToEvidenceAdapterResult",
      version: "0.7.0",
      digest: indexerEvidenceAdapterProtocolDigest("extract-mdx@0.7.0"),
    },
    authorized_scope: {
      source_ref: "source:repository",
      module_refs: ["module:docs"],
      scope_digest: indexerEvidenceAdapterProtocolDigest("scope"),
    },
    input_digest: indexerEvidenceAdapterProtocolDigest(files),
    precedence: 10,
    public_targets: targets,
    module_refs: {
      "docs/examples/button/usage.mdx": "module:docs",
      "docs/alternate/usage.mdx": "module:docs",
    },
  };
}

describe("MDX catalog bridge", () => {
  test("links ESM aliases, JSX components, fenced examples, and sandbox hosts to registered targets", () => {
    const documents = parseMdxSources(files, { public_targets: targets });
    const document = documents.find((item) => item.path === "docs/examples/button/usage.mdx")!;

    expect(document.disposition).toBe("analyzed");
    expect(document.imports).toEqual([expect.objectContaining({ source_module: "@fixture/ui", imported_name: "Button", local_name: "Primary" })]);
    expect(document.exports).toEqual([expect.objectContaining({ exported_name: "ExampleButton", local_name: "Primary" })]);
    expect(document.components.find((item) => item.component_name === "Primary")).toMatchObject({ target_ref: "public-target:button", example_ref: expect.stringContaining("#sandbox-host:") });
    expect(document.components.find((item) => item.component_name === "Unknown")?.target_ref).toBeNull();
    expect(document.examples).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "document-host", example_ref: "docs/examples/button/usage.mdx#document-host:1" }),
      expect.objectContaining({ kind: "sandbox-host", target_refs: ["public-target:button"] }),
      expect.objectContaining({ kind: "demo-host", language: "tsx", component_names: ["Primary"], target_refs: ["public-target:button"], parse_supported: true }),
    ]));
  });

  test("uses full source paths in example identity so equal basenames cannot collide", () => {
    const documents = parseMdxSources(files, { public_targets: targets });
    const refs = documents.flatMap((document) => document.examples.map((example) => example.example_ref));

    expect(refs).toContain("docs/examples/button/usage.mdx#code-block:1");
    expect(refs).toContain("docs/alternate/usage.mdx#code-block:1");
    expect(new Set(refs).size).toBe(refs.length);
    expect(documents.find((item) => item.path === "README.md")?.disposition).toBe("excluded");
    expect(documents.find((item) => item.path === "docs/delivery/guide.mdx")?.examples).toEqual([]);
  });

  test("publishes only digests for code content through the common Evidence ABI", () => {
    const result = mdxSourcesToEvidenceAdapterResult(files, invocation());
    const document = result.files.find((item) => item.normalized_path === "docs/examples/button/usage.mdx")!;
    const serialized = JSON.stringify(result);

    expect(document.coverage_tier).toBe("ast-catalog");
    expect(document.facts.some((fact) => fact.kind === "mdx-esm-import")).toBe(true);
    expect(document.facts.some((fact) => fact.kind === "mdx-component-reference")).toBe(true);
    expect(document.facts.some((fact) => fact.kind === "mdx-example")).toBe(true);
    expect(document.facts.some((fact) => fact.kind === "mdx-public-target-link")).toBe(true);
    expect(serialized).not.toContain("<Primary>Save</Primary>");
    expect(result.toolchain[0]!.capabilities).toContain("parser.mdx");
  });

  test("keeps invalid fenced scripts as diagnosed examples but rejects invalid MDX without partial facts", () => {
    const code = parseMdxSources({ "docs/code.mdx": "```tsx\n<Button\n```" }, { public_targets: targets })[0]!;
    expect(code).toMatchObject({ disposition: "analyzed", examples: [expect.objectContaining({ parse_supported: false })] });
    expect(code.diagnostics[0]?.code).toBe("mdx-code-block-syntax-unsupported");

    const result = mdxSourcesToEvidenceAdapterResult({ "docs/broken.mdx": "<Button>" }, {
      ...invocation(),
      input_digest: indexerEvidenceAdapterProtocolDigest("broken"),
      module_refs: { "docs/broken.mdx": "module:docs" },
    });
    expect(result.files[0]).toMatchObject({ disposition: "unsupported", facts: [] });
    expect(result.diagnostics[0]?.code).toBe("mdx-source-unsupported");
  });

  test("rejects ambiguous target registries instead of guessing public identity", () => {
    expect(() => parseMdxSources({ "docs/a.mdx": "<Button />" }, {
      public_targets: [
        { target_ref: "public-target:first", export_name: "Button" },
        { target_ref: "public-target:second", export_name: "Button" },
      ],
    })).toThrow("ambiguous MDX public target");
  });
});
