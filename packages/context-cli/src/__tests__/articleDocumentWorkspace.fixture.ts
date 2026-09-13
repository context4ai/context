import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { captureFile, source } from "@c4a/context";
import type { ArticleScenario } from "./articleCodeScenarios.fixture.js";
import type { ProductionRequirements } from "../project/productionRequirements.js";
import { addFileSource } from "../project/documentSourceRegistration.js";
import { runCaptureFilePhase } from "../project/documentCapture.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";

export async function createArticleDocumentWorkspace(scenario: ArticleScenario, readerGoals: string[]) {
  const parent = resolve(import.meta.dir, "../../../../.tmp/document-fixtures");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  const type = scenario.sourceType!;
  const name = type === "file" ? "20260903/manual" : "20260903/manual.md";
  const sourceRef = `${type}:${name}`;
  const registry: ProductionRequirements = {
    requirements: [{ id: "reader-tasks", reader_goals: readerGoals, purpose: scenario.articles.map(article => article.task).join("; "),
      coverage_domains: { "business-semantics": "required" },
      target_scope: { targets: [{ source_ref: sourceRef, module_refs: [] }] },
      evidence_source_scope: { targets: [{ source_ref: sourceRef, module_refs: [] }] } }],
  };
  await mkdir(join(root, "src")); await mkdir(join(root, "knowledge"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "article-document-fixture", private: true, context: { project: true, entry: "src/index.ts" } }));
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify(registry));
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify({ articles: [] }));
  await writeFile(join(root, "src/index.ts"), `import { captureFile, defineProject, source } from "@c4a/context";\nconst manual = source("${name}", {type: "${type}"});\nexport default defineProject({ sources: [manual], phases: ${type === "file" ? "[captureFile({source: manual})]" : "[]"}, packages: [] });\n`);
  if (type === "file") {
    const docs = join(root, "source-documents");
    await mkdir(docs); await writeFile(join(docs, "manual.md"), scenario.source);
    await addFileSource({ projectRoot: root, name, namespace: "20260903", module: "manual", local: docs });
    await runCaptureFilePhase({ projectRoot: root, phase: captureFile({ source: source(name, { type: "file" }) }) });
  } else await importManagedDocument(root, { type, name, markdown: scenario.source });
  return root;
}
