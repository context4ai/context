import { bundledIndexerProfileContract } from "../project/indexerBaseContracts.js";
import { indexerTemplateContractSchema } from "@c4a/context";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { expandArticleBlueprint } from "../project/indexerArticleBlueprint.js";
import { projectAuthorWritingBrief } from "../project/indexerAuthorWritingBrief.js";
import { encodeTemplateSnapshots, hydrateTemplateSnapshots } from "../project/indexerTemplateSnapshots.js";
import { splitFrontmatter, parseSectionBodies } from "../project/indexerTemplateRendering.js";
import { buildIndexerTaskReading } from "../project/indexerAgentReading.js";
import { planIndexerReadingFiles } from "../project/indexerReadingFiles.js";
import { authorReadingFixture } from "./indexerBatchReading.fixture.js";

const metadata = { program: { article: "s06", policies: ["standard"], sections: { entry: "Entry", next: "Next investigation" } } };
const binding = { id: "service-s06-page", profile: "service", reader_goal: "investigate-service" };
const template = expandArticleBlueprint(metadata, binding)!;

test("all shipped profile bindings expand shared blueprints with their original identities", async () => {
  const root = join(import.meta.dir, "../../../../plugins/context/skills");
  for (const provider of ["context-code-indexer", "context-markdown-indexer", "context-note-indexer", "context-sessions-indexer"]) {
    const manifest = YAML.parse(await readFile(join(root, provider, "context-indexer.yaml"), "utf8"));
    const bindings = manifest.provider.templates.filter((item: { kind?: string }) => item.kind === "page-program");
    const resources = new Set<string>();
    for (const item of bindings) {
      const parsed = splitFrontmatter(await readFile(join(root, provider, item.path), "utf8"));
      const expanded = expandArticleBlueprint(parsed.metadata, item) ?? { contract: indexerTemplateContractSchema.parse(parsed.metadata), section_bodies: parseSectionBodies(parsed.body) };
      expect(expanded.contract.template_id).toBe(item.id);
      expect(expanded.contract.profile).toBe(item.profile);
      if (item.reader_goal !== undefined) expect(expanded.contract.reader_goal).toBe(item.reader_goal);
      expect(parsed.body.trim().length).toBeGreaterThan(0);
      expect(Object.keys(expanded.section_bodies)).toEqual(expanded.contract.sections.map(section => section.section_key));
      resources.add(item.path);
    }
    expect(resources.size).toBeLessThan(bindings.length);
  }
});

test("multi-article reading combines guidance and slots without repeating machine contracts or mutating the View", () => {
  const input = authorReadingFixture(0, 0);
  const value = { page_plan: { articles: [{ key: "dependency", template_id: binding.id }, { key: "another", template_id: binding.id }] },
    article_templates: { dependency: template, another: template },
    article_guidance: { dependency: { template_id: binding.id, content: "Follow the caller. Example: name the actual initialization function, then link its consumer." } } };
  const projected = projectAuthorWritingBrief(value);
  expect(projected).not.toHaveProperty("article_templates");
  expect(projected.writing_brief).toContain("initialization function");
  expect(projected.writing_brief).toContain("Next investigation");
  expect(projected.writing_brief).not.toContain("minimum_evidence_items");
  input.view.items.find(item => item.category === "author-authority")!.value = projected as never;
  const before = JSON.stringify(input.view);
  const files = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  expect(files.readings[0]!.markdown).toContain("initialization function");
  expect(files.readings[0]!.markdown).not.toContain("minimum_evidence_items");
  expect(JSON.stringify(input.view)).toBe(before);
  expect(value.article_templates.dependency).toBe(template);
});

test("request snapshots reuse a template across tasks, hydrate losslessly, and detect missing or corrupt material", async () => {
  const scratch = join(import.meta.dir, "../../.tmp/template-compaction");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "snapshots-"));
  try {
    const request = (task: string, selected = template) => ({ protocol: "context.indexer.main-run-spec/v1", request: { task }, validation: { article_templates: { entry: selected }, article_guidance: { entry: "Preserve the reader example" } } });
    const first = await encodeTemplateSnapshots(root, request("a"));
    const other = expandArticleBlueprint(metadata, { ...binding, id: "worker-s06-page", profile: "worker", reader_goal: "investigate-worker" })!;
    const second = await encodeTemplateSnapshots(root, request("b", other));
    const dir = join(root, ".tmp/context-runtime/indexer/template-snapshots");
    const paths = await readdir(dir);
    expect(paths).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain("minimum_evidence_items");
    expect(await hydrateTemplateSnapshots(root, first)).toEqual(request("a"));
    expect(await hydrateTemplateSnapshots(root, second)).toEqual(request("b", other));
    expect(await hydrateTemplateSnapshots(root, request("legacy"))).toEqual(request("legacy"));
    await writeFile(join(dir, paths[0]!), "{}");
    await expect(hydrateTemplateSnapshots(root, first)).rejects.toThrow("integrity");
    await rm(join(dir, paths[0]!));
    await expect(hydrateTemplateSnapshots(root, second)).rejects.toThrow("missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("small one-task guidance stays inline instead of opening extra shared files", () => {
  const input = authorReadingFixture(0, 0);
  input.view.items.find(item => item.category === "index-requirement")!.value = { purpose: "A short reading goal" };
  const files = planIndexerReadingFiles([buildIndexerTaskReading(input)]);
  expect(files.readings[0]!.markdown).toContain("A short reading goal");
  expect(files.shared.some(file => file.markdown.includes("A short reading goal"))).toBe(false);
});

test("writing brief preserves procedure-only and distinct same-ID guidance in mixed plans", () => {
  const result = projectAuthorWritingBrief({ article_templates: { a: template, b: template }, article_guidance: {
    a: { template_id: binding.id, content: "First custom guidance" },
    b: { template_id: binding.id, content: "Second custom guidance" },
    c: { template_id: "legacy-procedure", content: "Legacy collaboration example" },
  } });
  expect(result.writing_brief).toContain("First custom guidance");
  expect(result.writing_brief).toContain("Second custom guidance");
  expect(result.writing_brief).toContain("Legacy collaboration example");
});


test("shared programs retain profile-approved decision and operational evidence", () => {
  for (const [profileId, article, expected] of [
    ["decision-record", "c06", ["decision-record"]],
    ["background-runtime", "s07", ["runbook", "test-result", "runtime-observation"]],
    ["background-runtime", "d04", ["runbook", "test-result", "runtime-observation"]],
  ] as const) {
    const profile = bundledIndexerProfileContract().profiles.find(profile => profile.id === profileId)!;
    const allowed = [...new Set(profile.reader_question_contracts.flatMap(question => question.evidence_contract.accepted_kinds))];
    const expanded = expandArticleBlueprint({ program: { article, policies: ["standard"], sections: { explanation: "Source-backed explanation" } } },
      { id: `${profileId}-${article}-page`, profile: profileId, reader_goal: profile.layout_mappings[0]!.reader_goal, accepted_evidence_kinds: allowed })!;
    expect(expanded.contract.sections[0]!.accepted_evidence_kinds).toEqual(allowed);
    for (const kind of expected) expect(expanded.contract.sections[0]!.accepted_evidence_kinds).toContain(kind);
  }
});
