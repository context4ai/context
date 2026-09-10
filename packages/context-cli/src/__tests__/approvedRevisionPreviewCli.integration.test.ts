import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { completeCurrentIndexerAction } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { collectProjectStatus } from "../project/status.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";
import { ensureRepoSources } from "../project/repoSources.js";

const execute = promisify(execFile);
test("Node CLI preview and actual revision consume the same structured payload and preserve revision checks", async () => {
  const root = await realpath(await createDocumentRevisionWorkspace());
  try {
    expect((await ensureRepoSources({ projectRoot: root })).every(item => item.ready)).toBe(true);
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "preview-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerAction({ cwd: root, revision: structure.revision, managed: true,
      value: { stage: "structure-review", decision: "approved" } });
    await completeAuthorStage(root);
    const candidates = await readCandidateRecords(root);
    const path = candidates[0]!.path;
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    await prepareApprovedRevision({ projectRoot: root, selector: path, instruction: "Clarify the usage explanation." });
    const request = (await readApprovedRevision(root))!;
    const section = approvedContextSectionsInMarkdown(request.target.markdown)[0]!;
    const inputPath = join(root, ".tmp/edit.json");
    await writeFile(inputPath, JSON.stringify({ stage: "approved-revision", sections: [{ section_id: section.id,
      content: [{ markdown: section.readerVisibleBody + "\n\nRead the exported constant directly." }] }] }));
    const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    const cli = process.env.CONTEXT_TEST_CLI ? resolve(process.env.CONTEXT_TEST_CLI) : resolve(import.meta.dir, "../../dist/cli.js");
    const args = [cli, "action", "complete-current", "--managed", "--revision", route.revision, "--input", inputPath, "--format", "json"];
    const options = { cwd: root, timeout: 60_000, env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" }, maxBuffer: 8 * 1024 * 1024 };
    const preview = JSON.parse((await execute("node", [...args, "--preview"], options)).stdout);
    expect(preview.protocol).toBe("context.approved-revision-preview/v1");
    expect(preview.changed).toBe(true);
    expect(await readApprovedRevision(root)).toEqual(request);
    expect(await readCandidateRecords(root)).toEqual([]);
    const submitted = JSON.parse((await execute("node", args, options)).stdout);
    expect(submitted).toBeDefined();
    expect((await readCandidateRecords(root))[0]!.body).toBe(preview.markdown);
    await expect(execute("node", [...args, "--preview"], options)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120_000);
