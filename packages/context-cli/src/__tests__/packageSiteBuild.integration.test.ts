import { approvedKnowledgeMapTargets } from "../project/knowledgeMapCoverage.js";
import { applyKnowledgeMapUpdate, readKnowledgeMap } from "../project/knowledgeMap.js";
import { expect, test } from "bun:test";
import { cp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildProjectPackages, collectPackageFreshness } from "../project/packageBuilder.js";
import { loadContextProjectModule } from "../project/workspace.js";
import { inspectWorkspacePublish, markWorkspacePublished } from "../project/workspacePublishVersion.js";
import { inspectWorkspaceVersion, readWorkspaceChangelog } from "../project/workspaceChangelog.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("normal build publishes the website, reuses an unchanged build and removes a disabled channel", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/llms"), join(root, "src/package-templates/llms"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    const entry = (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, llmsPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "site-test", site: { title: "Sample knowledge" }, template: { path: "src/package-templates/kb", vars: {} } }), llmsPackage({ name: "llms-test", template: { path: "src/package-templates/llms", vars: {} } })]');
    await writeFile(entryPath, entry);
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    await completeAuthorStage(root, { markdown: "Use the public entry point." });
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    // The legacy single-page author fixture chooses identities after planning.
    // It must place those approved pages before packaging as well.
    await expect(buildProjectPackages(root)).rejects.toMatchObject({ detail: { reason_code: "knowledge-map-incomplete" } });
    await applyKnowledgeMapUpdate(root, { expected_revision: (await readKnowledgeMap(root))?.revision ?? null, remove: [],
      upsert: (await approvedKnowledgeMapTargets(root)).map(article => ({ key: article.artifact_ref, parent: null, title: "Guide", order: 0, target: { artifact_ref: article.artifact_ref } })) });
    const version = await inspectWorkspaceVersion(root);
    const payload = join(root, ".tmp/version.json");
    await writeFile(payload, JSON.stringify({ expected_digest: version.expected_digest, version: "0.1.0",
      title: "Initial delivery", changes: ["Added guide"], triggers: [{ kind: "initial", description: "User request" }] }));
    const recorded = JSON.parse((await promisify(execFile)("node", [join(import.meta.dir, "../../dist/cli.js"),
      "--workflow-managed", "version", "record", "--input", payload, "--format", "json"], { cwd: root })).stdout);
    expect(recorded.outcome).toBe("recorded");
    expect(recorded.workflow).toBeDefined();
    expect(recorded.next_action).toBeUndefined();
    const built = await buildProjectPackages(root);
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    expect((await readWorkspaceChangelog(root)).map(item => item.version)).toEqual(["0.1.0"]);
    const first = built.packages[0]!;
    const llms = built.packages[1]!;
    expect(await readFile(join(root, llms.outDir, "llms.txt"), "utf8")).toContain("Guide");
    expect(await readFile(join(root, llms.outDir, "llms-full.txt"), "utf8")).toContain("Use the public entry point.");
    expect(built.agent_hints).toContainEqual(expect.objectContaining({
      reason_code: "website-deployment-ready", site_dir: "dist/site-test-site",
    }));
    const sitePath = join(root, first.siteOutDir!, "index.html");
    expect(await readFile(sitePath, "utf8")).toContain("Sample knowledge");
    expect(await readFile(sitePath, "utf8")).toContain("LLM Docs");
    expect(await readFile(join(root, first.siteOutDir!, "changelog.html"), "utf8")).toContain("Initial delivery");
    expect(await readFile(join(root, first.siteOutDir!, "llms/index.html"), "utf8")).toContain("LLM Docs");
    expect(await readFile(join(root, first.siteOutDir!, "llms.txt"), "utf8")).toContain("Guide");
    expect(await readFile(join(root, first.siteOutDir!, "llms-full.txt"), "utf8")).toContain("Use the public entry point.");
    const before = (await stat(sitePath)).mtimeMs;
    const reused = await buildProjectPackages(root);
    expect(reused.packages[0]!.state).toBe("unchanged");
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    expect(reused.agent_hints.some(hint => hint.reason_code === "website-deployment-ready")).toBe(true);
    expect((await stat(sitePath)).mtimeMs).toBe(before);
    const publish = await inspectWorkspacePublish(root);
    expect(publish.needs_version).toBe(false);
    await expect(markWorkspacePublished(root, "wrong-hash", "test-publication")).rejects.toThrow("baseline changed");
    await markWorkspacePublished(root, publish.hash, "test-publication");
    expect((await inspectWorkspacePublish(root)).unchanged).toBe(true);
    const loaded = await loadContextProjectModule(root);
    expect((await collectPackageFreshness(root, loaded.project.packages))[0]!.state).toBe("ready");
    await expect(stat(join(root, first.outDir, "site"))).rejects.toMatchObject({ code: "ENOENT" });
    const originalSite = await readFile(sitePath, "utf8");
    await writeFile(sitePath, originalSite + "<!-- external edit -->");
    await expect(inspectWorkspacePublish(root)).rejects.toThrow("Build output changed");
    expect((await collectPackageFreshness(root, loaded.project.packages))[0]!.state).not.toBe("ready");
    await writeFile(sitePath, originalSite);
    const map = (await readKnowledgeMap(root))!;
    await applyKnowledgeMapUpdate(root, { expected_revision: map.revision, remove: [],
      upsert: map.entries.map(item => ({ ...item, title: "Updated navigation" })) });
    const changed = await buildProjectPackages(root);
    expect(changed.packages[0]!.state).not.toBe("unchanged");
    expect((await inspectWorkspacePublish(root)).needs_version).toBe(true);
    expect(await readFile(join(root, first.siteOutDir!, "llms.txt"), "utf8")).toContain("Updated navigation");
    expect(await readFile(join(root, llms.outDir, "llms.txt"), "utf8")).toContain("Updated navigation");
    const kbIndex = await readFile(join(root, first.outDir, "wikis/index.md"), "utf8");
    await writeFile(entryPath, entry.replace('site: { title: "Sample knowledge" }, ', ""));
    const kbOnly = await buildProjectPackages(root);
    expect(kbOnly.agent_hints.some(hint => hint.reason_code === "website-deployment-ready")).toBe(false);
    await expect(stat(sitePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, first.outDir, "wikis/index.md"), "utf8")).toBe(kbIndex);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
