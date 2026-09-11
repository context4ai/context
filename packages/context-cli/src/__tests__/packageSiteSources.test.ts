import { expect, test } from "bun:test";
import type { SourcesRegistry } from "@c4a/context";
import { siteArticleSources } from "../project/packageSiteSources.js";
const registry: SourcesRegistry = {
  kind: "sources.registry", registryPaths: { repo: "", file: "", lark: "" }, absolutePaths: { repo: "", file: "", lark: "" },
  repos: [{ id: "snapshot/ui", name: "ui", namespace: "snapshot", module: "ui", materializedAt: "", subpath: "packages/ui", remote: "git@github.com:example/widgets.git", ref: "abc123def4567890abc123def4567890abc123de" }],
  larks: [{ id: "snapshot/guide", name: "guide", title: "Usage guide", materializedAt: "", url: "https://docs.example.com/guide" }], files: [], notes: [], sessions: [],
};
test("recorded repository paths and document URLs become deduplicated source links", () => {
  const result = siteArticleSources('---\nsources: ["repo:snapshot/ui/src/button.ts", "lark:snapshot/guide"]\n---\n<!-- context:section source_ref="repo:snapshot/ui/src/button.ts" -->', registry);
  expect(result).toHaveLength(2);
  expect(result[0]!.href).toBe("https://github.com/example/widgets/blob/abc123def4567890abc123def4567890abc123de/packages/ui/src/button.ts");
  expect(result[0]!.label).toBe("example/widgets/packages/ui/src/button.ts # abc123");
  expect(result[1]).toEqual({ label: "Usage guide", href: "https://docs.example.com/guide" });
});
test("unknown sources and prose do not invent provenance; unsafe paths and URLs are not linked", () => {
  expect(siteArticleSources("# Button\n`src/button.ts` https://docs.example.com/unknown", registry)).toEqual([]);
  const unsafe = { ...registry, larks: [{ ...registry.larks[0]!, url: "javascript:alert(1)" }] };
  const result = siteArticleSources('---\nsources: ["repo:snapshot/ui/../../secret", "lark:snapshot/guide"]\n---', unsafe);
  expect(result.every(source => source.href === undefined)).toBe(true);
});
