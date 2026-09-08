import { expect, test } from "bun:test";
import { materializeIndexerStructuredContent, type IndexerArtifactFact, type IndexerJson } from "../index.js";

const subject = { protocol: "context.subject-key/v1" as const, namespace: "sample", kind: "component", local_key: "panel" };
const member = (name: string, extra: Record<string, IndexerJson> = {}) => ({
  name, kind: "prop", visibility: "exported", typeAnnotation: "boolean", optional: true, ...extra,
});
const fact = (id: string, value: Record<string, IndexerJson>): IndexerArtifactFact => ({
  fact_ref: `fact:${id}`, fact_kind: "code-symbol", subject_key: subject, evidence_refs: [`source:${id}`],
  value: { file: "panel.tsx", visibility: "exported", ...value },
});
const props = fact("props", { name: "Props", kind: "interface", members: [
  member("enabled", { defaultValue: "false", doc: "Show the panel." }),
  member("label", { typeAnnotation: "string", readonly: true, optional: false }),
] });
const component = (id: string, value: string) => fact(id, { name: id, kind: "component", propsType: "Props", members: [member("enabled", { defaultValue: value })] });
const render = (facts: IndexerArtifactFact[], selected = ["fact:props"]) => materializeIndexerStructuredContent({
  facts, blocks: [{ block_id: "api", layer: "deterministic-block", renderer: "public-contract-table", fact_refs: selected }],
})[0]!;

test.each([false, true])("partial implementation preserves declared fields and metadata; direct=%s", direct => {
  const facts = [props, component("Panel", "true")];
  const before = JSON.stringify(facts);
  const output = render(facts, direct ? ["fact:Panel", "fact:props"] : undefined);
  expect(output.markdown).toContain("| Props | label | string | required | unknown | readonly |");
  expect(output.markdown).toContain("| Props | enabled | boolean | optional | true |");
  expect(output.markdown).toContain("Show the panel.");
  expect(output.markdown).not.toContain("| Panel | enabled |");
  expect(JSON.stringify(facts)).toBe(before);
});

test("shared Props keeps component defaults distinct and output independent of supporting fact order", () => {
  const facts = [props, component("First", "true"), component("Second", "false")];
  const output = render(facts);
  expect(output.markdown).toContain("| Props (First) | enabled | boolean | optional | true |");
  expect(output.markdown).toContain("| Props (Second) | enabled | boolean | optional | false |");
  expect(output.markdown.match(/\| label \|/g)).toHaveLength(2);
  expect(render([...facts].reverse())).toEqual(output);
});

test("absent or ambiguous supporting facts do not overwrite declaration defaults", () => {
  expect(render([props]).markdown).toContain("| optional | false |");
  const duplicate = { ...props, fact_ref: "fact:duplicate" };
  const output = render([props, duplicate, component("Panel", "true")], ["fact:props", "fact:duplicate"]);
  expect(output.markdown).not.toContain("| optional | true |");
});

test.each([
  { file: "other.tsx" },
  { propsType: "OtherProps" },
  { propsType: "Props<string>" },
])("unsupported links remain separate rather than borrowing defaults: %j", difference => {
  const support = component("Panel", "true");
  support.value = { ...(support.value as Record<string, IndexerJson>), ...difference };
  const output = render([props, support]);
  expect(output.markdown).toContain("| optional | false |");
  expect(output.fact_refs).toEqual(["fact:props"]);
});

test("non-component contracts retain service fields, defaults and response types", () => {
  const method = fact("method", { name: "List", kind: "rpc-method", input_type: "Query", output_type: "Results",
    fields: [{ name: "limit", type: "int32", defaultValue: "20", optional: true }], server_streaming: true });
  const output = render([method, component("Panel", "true")], [method.fact_ref]);
  expect(output.markdown).toContain("| List | limit | int32 | optional | 20 |");
  expect(output.markdown).toContain("| List | response | Results |");
  expect(output.fact_refs).toEqual([method.fact_ref]);
});
