import { expect, test } from "bun:test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureFile, source, loadSourcesRegistry } from "@c4a/context";
import { createArticleDocumentWorkspace } from "./articleDocumentWorkspace.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { runCaptureFilePhase } from "../project/documentCapture.js";
import { readDocumentSnapshotForSource } from "../project/documentBatchManifest.js";
import { registeredArticleSourceReader } from "../project/articleSourceReader.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { walkMarkdown } from "../project/verifyProjectFiles.js";

test("captured visual material stays readable and a file-submitted Mermaid article survives Review and package output", async () => {
  const root = await createArticleDocumentWorkspace({ id: "visual-delivery", sourceType: "file", profile: "domain-reference",
    source: "# Request flow\n\nRequest then reply.\n", articles: [{ type: "c01", title: "Request flow", task: "Understand request flow", slots: { scope: "Request then reply." } }] }, ["understand-domain"]);
  try {
    await mkdir(join(root, "source-documents/assets"));
    const imageBytes = Buffer.from("anonymous-image-fixture");
    await writeFile(join(root, "source-documents/assets/flow.png"), imageBytes);
    await writeFile(join(root, "source-documents/manual.md"), "# Request flow\n\nRequest then reply.\n\n![Flow](assets/flow.png)\n");
    await runCaptureFilePhase({ projectRoot: root, phase: captureFile({ source: source("20260903/manual", { type: "file" }) }) });
    const entry = (await loadSourcesRegistry({ rootDir: root })).files.find(file => file.name === "20260903/manual")!;
    const manifest = (await readDocumentSnapshotForSource(join(root, entry.snapshot!.manifest!), entry.name))!;
    const document = manifest.files.find(file => file.path.endsWith("manual.md"))!;
    const image = manifest.assets!.find(asset => asset.path.endsWith("flow.png"))!;
    expect(await readFile(join(root, entry.materializedAt, image.path))).toEqual(imageBytes);
    const captured = await (await registeredArticleSourceReader(root))("file:20260903/manual", document.path, true);
    expect(captured).toContain("![Flow]");
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const config = join(root, "src/index.ts");
    await writeFile(config, (await readFile(config, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({name: "visual-kb", template: {path: "src/package-templates/kb", vars: {}}})]'));
    const markdown = '---\ntitle: Request flow\ndescription: A documented request and reply.\n---\n\n<!-- context:section id="flow" -->\nThe source defines request then reply.\n\n```mermaid\nflowchart LR\n Client --> Service\n Service --> Client\n```\n<!-- /context:section -->\n';
    await produceFixtureArticles(root, [{ path: "architecture/flow.md", question: "How do request and reply flow?",
      sources: ["file:20260903/manual"], markdown,
      references: { sections: [{ id: "flow", references: [{ source_ref: "file:20260903/manual",
        locator: { path: document.path, start_line: 1, end_line: 5 } }] }] },
    }]);
    const candidates = await readCandidateRecords(root);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    const content = await readFile(join(root, "knowledge", candidates[0]!.path), "utf8");
    expect(content).toContain("```mermaid");
    expect(content).not.toContain("![");
    await acceptStarterPackageTemplates({ projectRoot: root });
    expect((await buildFixturePackages(root)).packages).toHaveLength(1);
    const pages = await walkMarkdown(join(root, "dist/visual-kb"));
    const outputs = await Promise.all(pages.map(page => readFile(page.absPath, "utf8")));
    expect(outputs.some(page => page.includes("```mermaid"))).toBe(true);
    expect(outputs.join("\n")).not.toContain("context:visual");
    expect(outputs.join("\n")).not.toContain("![Source resource]");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
