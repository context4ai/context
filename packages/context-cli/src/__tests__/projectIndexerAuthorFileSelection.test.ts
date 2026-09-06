import { describe, expect, test } from "bun:test";
import { selectIndexerAuthorFiles } from "../project/indexerAuthorFileSelection.js";
import { selectIndexerAuthorReading } from "../project/indexerAuthorReadingSelection.js";
import type { IndexerAuthorizedWorksetView } from "@c4a/context";

const file = (path: string, imports: string[] = []) => ({
  file_ref: `file:${path}`, normalized_path: path,
  facts: [{ fact_ref: `symbol:${path}`, kind: "code-symbol", payload: { name: path } },
    ...imports.map((to) => ({ fact_ref: `import:${path}:${to}`, kind: "code-relation", payload: { type: "imports", to } }))],
});
const files = [
  file("src/hooks/useValue.ts", ["./normalize"]), file("src/hooks/normalize.ts"), file("src/hooks/useOther.ts"),
  file("src/hooks/__tests__/useValue.test.ts"), file("src/hooks/__tests__/useOther.test.ts"),
  file("tests/behavior.spec.ts", ["../src/hooks/useValue"]), file("tests/unrelated.spec.ts", ["../src/hooks/useOther"]),
];
describe("focused Author material", () => {
  test("keeps owned sources, implementation dependencies and relevant tests, not the whole family", () => {
    expect([...selectIndexerAuthorFiles({ files, member_ids: new Set(["symbol:src/hooks/useValue.ts"]) })].sort()).toEqual([
      "src/hooks/__tests__/useValue.test.ts", "src/hooks/normalize.ts", "src/hooks/useValue.ts", "tests/behavior.spec.ts",
    ]);
  });
  test("unknown custom ownership is not pruned and explicitly requested material survives", () => {
    expect(selectIndexerAuthorFiles({ files, member_ids: new Set(["custom:target"]) }).size).toBe(files.length);
    expect(selectIndexerAuthorFiles({ files, member_ids: new Set(["symbol:src/hooks/useValue.ts"]),
      requested_paths: new Set(["src/hooks/useOther.ts"]) }).has("src/hooks/useOther.ts")).toBe(true);
  });
  test("keeps ancestor manifests and leaves non-code dependency policies alone", () => {
    expect(selectIndexerAuthorFiles({ files: [...files, file("package.json"), file("packages/other/package.json")],
      member_ids: new Set(["symbol:src/hooks/useValue.ts"]) })).toEqual(new Set([
      "src/hooks/useValue.ts", "package.json", "src/hooks/__tests__/useValue.test.ts", "tests/behavior.spec.ts", "src/hooks/normalize.ts",
    ]));
    const protocolFiles = files.map((source) => ({ ...source, facts: source.facts.map((fact) => ({ ...fact, kind: "protocol-item" })) }));
    expect(selectIndexerAuthorFiles({ files: protocolFiles, member_ids: new Set(["symbol:src/hooks/useValue.ts"]) }).size).toBe(files.length);
  });
  test("does not recursively explode a shared barrel or loop cyclic imports", () => {
    const selected = selectIndexerAuthorFiles({ files: [file("src/main.ts", ["./index", "./dep"]),
      file("src/index.ts", ["./unrelated"]), file("src/dep.ts", ["./main"]), file("src/unrelated.ts")],
      member_ids: new Set(["symbol:src/main.ts"]) });
    expect([...selected].sort()).toEqual(["src/dep.ts", "src/index.ts", "src/main.ts"]);
  });
  test("focuses a resumed View without changing task identity, accepted authority or explicit expansion", () => {
    const items = files.flatMap((source) => source.facts.map((fact) => ({
      ref: fact.fact_ref, category: "fact", provenance: { protocol: "fixture", container_ref: source.file_ref },
      value: { ...fact, locator: { source_ref: "repo:sample", normalized_path: source.normalized_path } },
    })));
    const view = { source_ref: "repo:sample", execution_request_digest: "unchanged", items: [
      ...items,
      { ref: "member:owned", category: "inventory-member", value: { member_id: "symbol:src/hooks/useValue.ts" } },
      { ref: "span:requested", category: "dependency", value: { kind: "source-span", source_ref: "repo:sample",
        locator: { path: "src/hooks/useOther.ts" }, targets: [{ level: "logical-unit" }] } },
      { ref: "extension:other", category: "extension", value: { data: "Keep unknown Provider material" } },
    ] } as unknown as IndexerAuthorizedWorksetView;
    const original = JSON.stringify(view);
    const selected = selectIndexerAuthorReading(view);
    expect(selected.execution_request_digest).toBe("unchanged");
    expect(JSON.stringify(view)).toBe(original);
    expect(selected.items.some((item) => item.ref === "symbol:src/hooks/useOther.ts")).toBe(true);
    expect(selected.items.some((item) => item.ref === "symbol:src/hooks/__tests__/useOther.test.ts")).toBe(false);
    expect(selected.items.some((item) => item.ref === "extension:other")).toBe(true);
    expect(selected.items.filter((item) => item.category === "inventory-member")).toEqual(view.items.filter((item) => item.category === "inventory-member"));
  });
});
