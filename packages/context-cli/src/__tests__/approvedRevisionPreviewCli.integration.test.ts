import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { collectProjectStatus } from "../project/status.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";
import { ensureRepoSources } from "../project/repoSources.js";
import { beginKnowledgeUpdate, completeKnowledgeUpdate, readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { readProductionRequirements } from "../project/productionRequirements.js";

const execute = promisify(execFile);
test.each(["direct", "source-update", "regenerate"] as const)("Node CLI %s preview and actual revision preserve payload and source boundaries without Provider registration", async mode => {
  const root = await realpath(await createDocumentRevisionWorkspace());
  try {
    expect((await ensureRepoSources({ projectRoot: root })).every(item => item.ready)).toBe(true);
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entry = join(root, "src/index.ts");
    await writeFile(entry, (await readFile(entry, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "preview-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await produceFixtureArticles(root, [{ path: "architecture/answer.md", question: "How is the exported answer used?",
      sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: '---\ntitle: Exported answer\ndescription: Locate the exported constant.\n---\n\n<!-- context:section id="usage" -->\n## Usage\n\nThe module exports answer with value 42.\n<!-- /context:section -->\n',
      references: { sections: [{ id: "usage", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
        locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
    }]);
    const candidates = await readCandidateRecords(root);
    const path = candidates[0]!.path;
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildProjectPackages(root);
    if (mode !== "source-update") {
      await prepareApprovedRevision({ projectRoot: root, selector: path, instruction: "Clarify the usage explanation.",
        ...(mode === "regenerate" ? { regenerate: true } : {}) });
    } else {
      const requirements = await readProductionRequirements(root);
      const requirement = requirements.requirements.find(item => item.target_scope.targets.some(target =>
        target.source_ref === DOCUMENT_REVISION_SOURCE_REF))!;
      const target = requirement.target_scope.targets.find(item => item.source_ref === DOCUMENT_REVISION_SOURCE_REF)!;
      await beginKnowledgeUpdate(root, { scopes: [{ requirement_ref: requirement.id,
        source_ref: DOCUMENT_REVISION_SOURCE_REF, ...(target.module_refs?.length ? { module_refs: target.module_refs } : {}) }] });
      const update = (await readKnowledgeUpdate(root))!;
      expect(update.candidates.map(candidate => candidate.path)).toEqual([path]);
      await completeKnowledgeUpdate({ projectRoot: root, revision: update.revision,
        decisions: [{ path, instruction: "Clarify usage against the captured code." }],
        scope_summary: "Reassess the selected code explanation.", new_topics: [] });
    }
    const request = (await readApprovedRevision(root))!;
    if (mode === "regenerate") expect(request.program_blocks?.length).toBeGreaterThan(0);
    else expect(request.program_blocks).toBeUndefined();
    const section = approvedContextSectionsInMarkdown(request.target.markdown)[0]!;
    const inputPath = join(root, ".tmp/edit.json");
    await writeFile(inputPath, JSON.stringify({ stage: "approved-revision", sections: [{ section_id: section.id,
      content: mode === "regenerate" ? [{ program: request.program_blocks![0]!.token }]
        : [{ markdown: section.readerVisibleBody + "\n\nRead the exported constant directly." }] }] }));
    const route = (await collectProjectStatus(root, { managed: true })).workflow.current!;
    const writing = route.action?.input as { writing_context: { requirements: unknown[]; indexer_usage: unknown[] } };
    expect(writing.writing_context.requirements.length).toBeGreaterThan(0);
    expect(writing.writing_context.indexer_usage).toEqual([]);
    expect(writing.writing_context).not.toHaveProperty("providers");
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
