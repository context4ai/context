import { expect, test } from "bun:test";
import { renderIndexerDeterministicFacts } from "../indexerContentLayers.js";

test("API tables retain unions, multiline declarations and literal markup", () => {
  const rendered = renderIndexerDeterministicFacts({ renderer: "multi-column-table", facts: [{
    fact_ref: "fact:api", fact_kind: "public-contract-table", evidence_refs: ["evidence:source"],
    subject_key: { protocol: "context.subject-key/v1", namespace: "sample", kind: "component", local_key: "view" },
    value: { columns: ["Name", "Type"], rows: [["value", "A | B\nArray<T>"], ["label", "&text"]] },
  }] });
  expect(rendered).toContain("A &#124; B<br>Array&lt;T&gt;");
  expect(rendered).toContain("&amp;text");
  expect(rendered).not.toContain("fact:api");
});

test("member API rows omit implementation declarations and distinguish unknown defaults", async () => {
  const { projectIndexerPublicContractTable } = await import("../indexerPublicContractTable.js");
  const base = { fact_ref: "fact:api", fact_kind: "code-symbol", evidence_refs: ["evidence:source"],
    subject_key: { protocol: "context.subject-key/v1" as const, namespace: "sample", kind: "component", local_key: "view" } };
  const result = projectIndexerPublicContractTable({ ...base, value: { kind: "component", name: "View",
    typeAnnotation: "/** internal declaration */ FC<Props>", params: [{name:"{ value }",type:"any"}],
    members: [{ name: "enabled", type: "boolean", optional: true, defaultValue: "false" }, { name: "label", type: "string" }] } });
  expect(result?.rows.map(row => row[1])).toEqual(["enabled", "label"]);
  expect(result?.rows[0]?.[4]).toBe("false");
  expect(result?.rows[1]?.[4]).toBe("unknown");
});

test("compact declarations remove represented fields but retain relationships and unique documentation", async () => {
  const { compactContractDeclaration: compact } = await import("../indexerContractDeclaration.js");
  const rows = [["Props", "items", "Item[]", "required", "unknown", "Items to show."]];
  expect(compact("{ /** Items to show.\n * @i18n zh-CN\n * 显示的条目。 */ items: Item[]; }", rows)).toBeUndefined();
  expect(compact("{ items: Item[]; } & Shared", rows)).toContain("& Shared");
  expect(compact("{ /** @deprecated use entries */ items: Item[]; }", rows)).toContain("@deprecated");
  expect(compact("{ items: Other[]; }", rows)).toContain("Other[]");
  expect(compact('{ token: "/* literal */"; }', rows)).toContain('"/* literal */"');
});

test("type supplements identify their owner and preserve unrepresented constraints", () => {
  const rendered = renderIndexerDeterministicFacts({ renderer: "public-contract-table", facts: [{
    fact_ref: "fact:props", fact_kind: "code-symbol", evidence_refs: ["evidence:source"],
    subject_key: { protocol: "context.subject-key/v1", namespace: "sample", kind: "entity", local_key: "Props" },
    value: { name: "Props", typeAnnotation: "{ /** Items to show. */ items: Item[]; } & Shared",
      members: [{ name: "items", typeAnnotation: "Item[]", optional: false, doc: "Items to show." }] },
  }] });
  expect(rendered).toContain("Props: type details");
  expect(rendered).toContain("& Shared");
  expect(rendered).not.toContain("/** Items to show. */");
  expect(rendered).toContain("Item[]");
});

test("removed comments leave compact lines without changing literal or retained comment whitespace", async () => {
  const { compactContractDeclaration: compact } = await import("../indexerContractDeclaration.js");
  const rows = [["Props", "id", "string", "optional", "unknown", "Identifier."]];
  for (const newline of ["\n", "\r\n"]) {
    const raw = ["{", "  /** Identifier. */", "  ", "  id?: string;", "", "  /** Identifier. */", "  value?: Other;", "} & Shared"].join(newline);
    expect(compact(raw, rows)).toBe(["{", "  id?: string;", "  value?: Other;", "} & Shared"].join(newline));
  }
  const literal = '`first\n  \nlast`';
  const comment = '/** Unique constraints.\n\n  Keep these lines. */';
  const raw = `{\n  value: ${literal};\n  ${comment}\n  id?: string;\n} & Shared`;
  expect(compact(raw, rows)).toContain(literal);
  expect(compact(raw, rows)).toContain(comment);
  expect(compact('{ value: "/* not a comment */"; } & Shared', rows)).toContain('"/* not a comment */"');
});

test("exported type members use owner visibility while private and internal APIs remain hidden", async () => {
  const { projectIndexerPublicContractTable: project } = await import("../indexerPublicContractTable.js");
  const base = { fact_ref: "fact:props", fact_kind: "code-symbol", evidence_refs: ["source:props"],
    subject_key: { protocol: "context.subject-key/v1" as const, namespace: "sample", kind: "entity", local_key: "Props" } };
  const members = [
    { name: "value", kind: "prop", visibility: "internal", typeAnnotation: "string", optional: true },
    { name: "secret", kind: "prop", visibility: "private", typeAnnotation: "string" },
    { name: "implementation", kind: "prop", visibility: "internal", doc: "For implementation. @internal" },
    { name: "protectedField", kind: "prop", visibility: "protected" },
  ];
  for (const kind of ["type", "interface"]) {
    const value = { name: "Props", kind, visibility: "exported", members, publicEntrypoints: ["index.ts"] };
    const result = project({ ...base, value });
    expect(result?.rows.map(row => row[1])).toEqual(["value", "export entry"]);
    expect(result?.rows[0]?.[4]).toBe("unknown");
    expect(project({ ...base, value: { ...value, visibility: "internal" } })?.rows.map(row => row[1])).toEqual(["export entry"]);
  }
  expect(project({ ...base, value: { name: "Service", kind: "class", visibility: "exported", members } })).toBeUndefined();
});
