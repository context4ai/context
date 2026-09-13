import { expect } from "bun:test";
import { readArticleContracts } from "./articleContractReading.fixture.js";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import type { ArticleScenario } from "./articleCodeScenarios.fixture.js";
import { createArticleDocumentWorkspace } from "./articleDocumentWorkspace.fixture.js";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { registeredArticleSourceReader } from "../project/articleSourceReader.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildProjectPackages } from "../project/packageBuilder.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { collectProjectStatus } from "../project/status.js";
import { applyKnowledgeMapUpdate, readKnowledgeMap } from "../project/knowledgeMap.js";
import { readProductionStage } from "../project/productionStageStore.js";

// Recorded classification decisions for these transcripts, not CLI inference
// from a skill, template identity or code symbol kind.
const documentCollections: Record<string, string> = {
  "domain-reference": "business", "product-requirements": "product",
  "technical-guide": "architecture", "user-and-developer-guide": "architecture",
  "public-api-reference": "architecture", "standard-policy": "standards",
  "decision-record": "decision", "incident-review": "incident",
  "test-validation": "test", runbook: "sop", "faq-support": "faq",
  "release-migration-guide": "sop", "documentation-site": "architecture",
};

export async function runArticleScenario(scenario: ArticleScenario, options: { organization?: { proposed: string; accepted: string } } = {}) {
  const path = scenario.sourcePath ?? (scenario.sourceType ? "manual.md" : scenario.source.includes("<button") ? "src/index.tsx" : "src/index.ts");
  const readerGoals = scenario.articles.map(article => article.task);
  const root = scenario.sourceType ? await createArticleDocumentWorkspace(scenario, readerGoals) : await createDocumentRevisionWorkspace({ sourceCount: 1, profile: scenario.profile,
    purpose: scenario.articles.map(article => article.task).join("; "),
    readerGoals,
    sourceFiles: { [path]: scenario.source }, packageJson: { exports: { ".": `./${path}` } } });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({name: "scenario-kb", template: {path: "src/package-templates/kb", vars: {}}})]'));
    if (options.organization) {
      await mkdir(join(root, ".tmp"), { recursive: true });
      // A recorded Agent/user exchange, not CLI parsing or an invented gate.
      await writeFile(join(root, ".tmp/work-start-report.md"), `# Structure proposal\n\nProposed: ${options.organization.proposed}\nRecorded fixture feedback: ${options.organization.accepted}\n\n${scenario.articles.map(article => `- ${article.title}: ${article.task}; sections: ${Object.keys(article.slots).join(", ")}`).join("\n")}\n`);
    }
    const sourceRef = scenario.sourceType
      ? `${scenario.sourceType}:20260903/manual${scenario.sourceType === "file" ? "" : ".md"}`
      : DOCUMENT_REVISION_SOURCE_REF;
    const sourceReader = await registeredArticleSourceReader(root);
    const sourceText = await sourceReader(sourceRef, path, true);
    const references = [{ source_ref: sourceRef, locator: { path, start_line: 1,
      end_line: Math.max(1, sourceText.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length) } }];
    const renderContracts = scenario.articles.some(article => article.symbols)
      ? await readArticleContracts(root, path) : undefined;
    const collection = scenario.sourceType ? documentCollections[scenario.profile] : "codeindex";
    if (!collection) throw new Error(`Scenario needs a recorded knowledge classification: ${scenario.profile}`);
    await produceFixtureArticles(root, scenario.articles.map(article => {
      const sections = Object.entries(article.slots).map(([id, markdown]) => ({ id, heading: id, markdown }));
      if (article.symbols) sections.push({ id: "public-api", heading: "API", markdown: renderContracts!(article.symbols) });
      return { path: `${collection}/${article.key ?? article.type}.md`, question: article.task, sources: [sourceRef],
        markdown: `---\n${YAML.stringify({ title: article.title, description: article.task })}---\n\n` + sections.map(section =>
          `<!-- context:section id="${section.id}" -->\n## ${section.heading}\n\n${section.markdown}\n<!-- /context:section -->\n`).join("\n"),
        references: { sections: sections.map(section => ({ id: section.id, references })) },
      };
    }));
    const candidates = await readCandidateRecords(root);
    expect(candidates).toHaveLength(scenario.articles.length);
    const delivered = candidates.map(candidate => {
      const article = scenario.articles.find(article => article.title === candidate.review.title)!;
      expect(article).toBeDefined();
      for (const text of Object.values(article.slots)) expect(candidate.body).toContain(text);
      expect(candidate.source_refs).toEqual([sourceRef]);
      return { type: article.type, key: article.key ?? article.type, path: candidate.path };
    });
    await approveCandidates(root, candidates);
    const previous = await readKnowledgeMap(root);
    await applyKnowledgeMapUpdate(root, { expected_revision: previous?.revision ?? null, remove: [], upsert: [
      ...(options.organization ? [{ key: "reader-root", parent: null, title: options.organization.accepted, order: 0 }] : []),
      ...candidates.map((candidate, index) => ({ key: delivered[index]!.key, parent: options.organization ? "reader-root" : null,
        title: candidate.review.title, order: index, target: { artifact_ref: candidate.article_id! } })),
    ] });
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await (await import("./workspaceVersionDelivery.fixture.js")).recordFixtureVersionIfRequired(root);
    await buildProjectPackages(root);
    expect(new Set(delivered.map(page => page.key))).toEqual(new Set(scenario.articles.map(article => article.key ?? article.type)));
    const status = await collectProjectStatus(root, { managed: true });
    expect(status.approvedPages).toBe(scenario.articles.length);
    expect(status.draftCandidates).toBe(0);
    expect(status.verifyErrors).toBe(0);
    expect(await readProductionStage(root)).toBeUndefined();
    expect(status.workflow.current?.node).toBe("reopen-cleared-task");
    if (options.organization) {
      const reading = (await readKnowledgeMap(root))!;
      expect(reading.entries.find(entry => entry.key === "reader-root")?.title).toBe(options.organization.accepted);
      const output = JSON.parse(await readFile(join(root, "dist/scenario-kb/context-knowledge-map.json"), "utf8"));
      expect(output.entries[0].title).toBe(options.organization.accepted);
      expect(output.entries[0].children).toHaveLength(scenario.articles.length);
      for (const entry of output.entries[0].children as Array<{ href?: string }>) {
        expect(entry.href?.startsWith("./")).toBe(true);
        const target = join(root, "dist/scenario-kb", decodeURIComponent(entry.href!.slice(2).split("#")[0]!));
        expect((await readFile(target, "utf8")).trim().length).toBeGreaterThan(0);
      }
      expect(await readFile(join(root, ".tmp/work-start-report.md"), "utf8")).toContain(options.organization.proposed);
      await buildProjectPackages(root);
      expect((await readKnowledgeMap(root))?.revision).toBe(reading.revision);
    }
    for (const page of delivered) {
      const article = scenario.articles.find(article => (article.key ?? article.type) === page.key)!;
      const markdown = await readFile(join(root, "knowledge", page.path), "utf8");
      expect(markdown).not.toContain("{{variable:");
      expect(markdown).toContain(path);
      if (article.symbols) {
        const otherSymbols = scenario.articles.flatMap(other => other.symbols ?? []).filter(symbol => !article.symbols!.includes(symbol));
        for (const symbol of otherSymbols) expect(markdown).not.toContain(`| ${symbol} |`);
        expect(markdown).toContain("## API");
        for (const [symbol, name] of article.apiRows ?? []) expect(markdown).toContain(`| ${symbol} | ${name} |`);
      }
    }
    if (process.env.CONTEXT_ARTICLE_SCENARIO_OUTPUT) {
      const output = resolve(process.env.CONTEXT_ARTICLE_SCENARIO_OUTPUT, scenario.id);
      await rm(output, { recursive: true, force: true });
      await mkdir(output, { recursive: true });
      await cp(join(root, "knowledge"), join(output, "knowledge"), { recursive: true });
      await cp(join(root, "dist"), join(output, "dist"), { recursive: true });
      await writeFile(join(output, "receipt.json"), JSON.stringify({ scenario: scenario.id, profile: scenario.profile, delivered }, null, 2));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
