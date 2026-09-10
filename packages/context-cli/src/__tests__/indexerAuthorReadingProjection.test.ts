import { expect, test } from "bun:test";
import { authorOptionalSource, authorRecordRows, projectAuthorAuthority, projectAuthorStyleNames, reuseAuthorMembers } from "../project/indexerAuthorReadingProjection.js";
import { buildIndexerTaskReading } from "../project/indexerAgentReading.js";
import { planIndexerReadingFiles } from "../project/indexerReadingFiles.js";
import { authorReadingFixture } from "./indexerBatchReading.fixture.js";

test("style index keeps exact identities, names and positions without classifying public APIs", () => {
  const entries = [
    { ref: "fact:hover", kind: "style-selector", denominator: "none", locator: {}, payload: {
      class_names: ["button"], pseudo_classes: ["hover"], id_names: [], locator: { line: 4, end_line: 6 } } },
    { ref: "fact:token", kind: "style-token-reference", denominator: "none", locator: {}, payload: { name: "--space", locator: { line: 8 } } },
    { ref: "fact:custom", kind: "style-selector", locator: {}, payload: { name: "special", public_contract: { override: true } } },
  ];
  const before = structuredClone(entries);
  const output = projectAuthorStyleNames(entries);
  expect(output[0]).toEqual({ kind: "style-selector", columns: ["ref", "names", "position", "denominator"],
    position_columns: ["line", "end_line", "column"],
    rows: [["fact:hover", { class_names: ["button"], pseudo_classes: ["hover"] }, [4, 6, null], "none"]] });
  expect(output[2]).toEqual(entries[2]);
  expect(entries).toEqual(before);
});

test("style supporting rows hide only non-member IDs and preserve unknown extensions", () => {
  const fact = (ref: string, locator: unknown = { line: 3 }) => ({ ref, kind: "style-component-candidate", denominator: "none", locator: {}, payload: { name: "control", locator } });
  const records = [fact("fact:owned"), fact("fact:support"), fact("fact:extended", { line: 5, macro: "origin" }),
    { ...fact("fact:custom"), contract: { external: true } }];
  const serialized = JSON.stringify(records);
  const output = projectAuthorStyleNames(records, new Set(["fact:owned"]));
  const text = JSON.stringify(output);
  expect(text).toContain("fact:owned");
  expect(text).not.toContain("fact:support");
  expect(text).toContain("fact:custom");
  expect(text).toContain('"macro":"origin"');
  expect(text).toContain("control");
  expect(JSON.stringify(records)).toBe(serialized);
  const unusual = projectAuthorStyleNames([fact("fact:unusual", ["custom", 7])]);
  expect(JSON.stringify(unusual)).toContain('["custom",7]');
});

test("member row layout is lossless and leaves heterogeneous extension records intact", () => {
  const members = [{ member_id: "fact:one", member_kind: "component" }, { member_kind: "entry", member_id: "fact:two" }];
  const result = authorRecordRows(members) as { columns: string[]; rows: unknown[][] };
  const restored = result.rows.map(row => Object.fromEntries(result.columns.map((key, i) => [key, row[i]])));
  expect(restored).toEqual(members);
  const extended = [...members, { member_id: "fact:three", required_note: "read first" }];
  expect(authorRecordRows(extended)).toEqual(extended);
});

test("member reuse is exact, unique and acyclic and does not lose component defaults", () => {
  const members = [{ name: "enabled", defaultValue: "true", file: "base.ts", doc: "Enabled by default" }];
  const props = { ref: "fact:props", kind: "code-symbol", payload: { name: "Options", kind: "interface", members } };
  const component = { ref: "fact:component", kind: "code-symbol", payload: { name: "Control", kind: "component", propsType: "Options", members,
    params: [{ name: "enabled", defaultValue: "true" }] } };
  const [retained, reused] = reuseAuthorMembers([props, component]);
  expect(retained).toEqual(props);
  expect(reused).toEqual({ ...component, payload: { name: "Control", kind: "component", propsType: "Options", members_from: "fact:props", params: component.payload.params } });
  expect(reuseAuthorMembers([props, { ...props, ref: "fact:ambiguous" }, component])[2]).toEqual(component);
  const different = { ...component, payload: { ...component.payload, members: [{ ...members[0], defaultValue: "false" }] } };
  expect(reuseAuthorMembers([props, different])[1]).toEqual(different);
  const cyclic = { ...props, payload: { ...props.payload, propsType: "Control" } };
  expect(reuseAuthorMembers([cyclic, component])).toEqual([cyclic, component]);
  expect(component.payload.members).toEqual(members);
});

test("identical member lists from different source files are not joined by type name", () => {
  const input = authorReadingFixture(0, 0);
  const base = input.view.items[0]!;
  const members = [{ name: "active", defaultValue: "true" }];
  input.view.items.push(...[
    { name: "Options", kind: "interface", file: "src/options.ts", members },
    { name: "Control", kind: "component", file: "src/control.ts", propsType: "Options", members },
  ].map((payload, index) => ({ ...base, category: "fact", ref: `fact:cross-file-${index}`,
    value: { kind: "code-symbol", payload, locator: { source_ref: input.view.source_ref, module_ref: null, normalized_path: payload.file } },
  })) as typeof input.view.items);
  const files = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  expect(files.readings[0]!.markdown).not.toContain('"members_from"');
  for (const file of ["src/options.ts", "src/control.ts"]) expect(files.readings[0]!.markdown).toContain(file);
});

test("package briefs retain conditional exports; partial JSON is never reconstructed", () => {
  const manifest = { name: "example", exports: { ".": { browser: "./web.js", node: "./node.js", default: "./fallback.js" } },
    peerDependencies: { framework: "^2" }, scripts: { build: "compile" }, devDependencies: { compiler: "1" } };
  const projected = authorOptionalSource("nested/package.json", [{ start_line: 1, text: JSON.stringify(manifest) }]);
  expect(projected && "fields" in projected ? projected.fields : undefined).toEqual({ name: manifest.name, exports: manifest.exports, peerDependencies: manifest.peerDependencies });
  const partial = authorOptionalSource("package.json", [{ start_line: 1, text: '{"name":"example",' }, { start_line: 9, text: '"version":"1"}' }]);
  expect(partial && "fields" in partial ? partial.fields : undefined).toBeUndefined();
  expect(authorOptionalSource("readme.md", [])).toBeUndefined();
});

test("selected authority retains executable thresholds and unknown constraints", () => {
  const value = { page_plan: { artifact_intent: "source/usage/use/content" }, allowed_artifact_intents: ["other"], available_templates: ["full"],
    primary_artifact_options: [{ policy: "standard" }], extension: { must_preserve: true },
    artifact_policy_eligibility: { protocol: "internal", eligibility_digest: "internal", eligible_variants: [{ id: "standard", thresholds: [{ hard_max: 3 }] }] } };
  const result = projectAuthorAuthority(value)!;
  expect(result.page_plan).toEqual(value.page_plan);
  expect(result.primary_artifact_options).toEqual(value.primary_artifact_options);
  expect(result.extension).toEqual(value.extension);
  expect(result.artifact_policy_eligibility).toEqual({ eligible_variants: value.artifact_policy_eligibility.eligible_variants });
  expect(projectAuthorAuthority({ allowed_artifact_intents: ["other"] })).toBeUndefined();
});

test("CSS and package bodies are reachable in emitted detail files without mutating the View", () => {
  for (const path of ["styles/theme.scss", "package.json"]) {
    const input = authorReadingFixture(0, 0);
    const source = input.view.items.find(item => item.category === "source-text")!;
    const value = source.value as { path: string; spans: { text: string }[] };
    value.path = path;
    const text = path.endsWith(".scss") ? ".control { color: var(--accent); }" : '{"scripts":{"build":"compile"},"exports":{".":"./index.js"}}';
    value.spans[0]!.text = text;
    for (const item of input.view.items) {
      const node = item.value as { kind?: string; locator?: { path: string } };
      if (item.category === "dependency" && node.kind === "source-span") node.locator!.path = path;
    }
    const authority = input.view.items.find(item => item.category === "author-authority")!;
    authority.value = { page_plan: { artifact_intent: "source/usage/use/content" }, allowed_artifact_intents: ["optional-intent"], custom_constraint: "keep-me" };
    const original = structuredClone(input.view);
    const files = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
    const main = files.readings[0]!.markdown;
    expect(main).toContain(source.ref);
    expect(main).toContain("keep-me");
    expect(main).not.toContain(text);
    expect(main).not.toContain("optional-intent");
    expect(files.details.some(file => file.markdown.includes(text))).toBe(true);
    expect(files.details.some(file => file.markdown.includes("optional-intent"))).toBe(true);
    for (const detail of files.details) expect(main).toContain(`./${detail.digest.slice(7)}.md`);
    expect(input.view).toEqual(original);
  }
});
