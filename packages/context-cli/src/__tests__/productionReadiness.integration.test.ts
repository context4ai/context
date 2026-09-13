import { expect, test } from "bun:test";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { completeProductionSubmission, type ProductionSubmissionResult } from "../project/productionSubmission.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { collectProjectStatus } from "../project/status.js";

test("104-page production supports subset submission, fragment repair and failed build recovery", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 104 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    const entry = (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "scale-kb", template: { path: "src/package-templates/kb", vars: {} } })]');
    await writeFile(entryPath, entry);
    const articles = Array.from({ length: 104 }, (_, index) => {
      const name = index === 0 ? "answer" : index === 1 ? "secondaryAnswer" : `extra${index - 2}`;
      const path = index === 0 ? "src/index.ts" : index === 1 ? "src/secondary.ts" : `src/extra${index - 2}.ts`;
      const value = index === 0 ? 42 : index === 1 ? 84 : index - 2;
      return { path: `codeindex/${name}.md`, question: `What value does ${name} export?`,
        sources: [DOCUMENT_REVISION_SOURCE_REF],
        markdown: `---\ntitle: ${name}\ndescription: Public constant ${name}\n---\n\n<!-- context:section id="export" -->\n## Public export\n\nThe source \`${path}\` exports \`${name}\` with value ${value}.\n<!-- /context:section -->\n`,
        references: { sections: [{ id: "export", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
          locator: { path, start_line: 1, end_line: 1 } }] }] },
      };
    });
    const submitted: number[] = [];
    await produceFixtureArticles(root, articles, { submit: async input => {
      const agent = join(root, productionAgentDirectory(input.stage));
      const manifest = YAML.parse(await readFile(join(agent, input.path), "utf8")) as {
        stage: string; tasks: Array<{ task: string; input: string; content: string; references: string }>;
      };
      const last = manifest.tasks.at(-1)!;
      // A valid source identity but invalid region: only this article must fail.
      await writeFile(join(agent, last.references), YAML.stringify({ sections: [{ id: "export",
        references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
          locator: { path: "src/extra101.ts", start_line: 1, end_line: 99 } }] }] }));
      const accepted: ProductionSubmissionResult["accepted"] = [];
      for (let offset = 0; offset < manifest.tasks.length; offset += 26) {
        const tasks = manifest.tasks.slice(offset, offset + 26);
        await writeFile(join(agent, input.path), YAML.stringify({ stage: manifest.stage, tasks }));
        const result = await completeProductionSubmission(input);
        submitted.push(tasks.length);
        accepted.push(...result.accepted);
        expect(result.stage_state).toBe("active");
        expect(result.failed).toHaveLength(offset === 78 ? 1 : 0);
        expect(await readCandidateRecords(root)).toHaveLength(accepted.length);
      }
      expect(accepted).toHaveLength(103);
      const beforeRepair = await readCandidateRecords(root);
      const stageBeforeRepair = (await readProductionStage(root))!;
      expect(stageBeforeRepair.tasks.filter(task => task.status === "accepted")).toHaveLength(103);
      // Repair consumes the saved rejected draft, not this later unsubmitted edit.
      await writeFile(join(agent, last.content), "Unsubmitted replacement must not be read.");
      await writeFile(join(agent, "submissions/repair.yaml"), YAML.stringify({ edits: [{
        replace: ["export"], with: [{ id: "export", references: articles.at(-1)!.references.sections[0]!.references }],
      }] }));
      await writeFile(join(agent, input.path), YAML.stringify({ stage: manifest.stage,
        tasks: [{ task: last.task, input: last.input, edits: "submissions/repair.yaml" }] }));
      const repaired = await completeProductionSubmission(input);
      expect(repaired.failed).toEqual([]);
      expect(repaired.accepted.map(item => item.task)).toEqual([last.task]);
      const afterRepair = await readCandidateRecords(root);
      for (const candidate of beforeRepair) {
        expect(afterRepair.find(item => item.article_id === candidate.article_id)).toEqual(candidate);
      }
      expect(afterRepair.find(item => item.path === articles.at(-1)!.path)!.body).toContain("value 101");
      expect(new Set(afterRepair.map(item => item.article_id)).size).toBe(104);
      expect((await completeProductionSubmission(input)).accepted).toEqual(repaired.accepted);
      return { ...repaired, accepted: [...accepted, ...repaired.accepted] };
    } });
    expect(submitted).toEqual([26, 26, 26, 26]);
    const candidates = await readCandidateRecords(root);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    const beforeBuild = await readCandidateRecords(root);
    const stageBeforeBuild = await readProductionStage(root);
    // Retired delivery and run ledgers are not inputs of the new delivery.
    await mkdir(join(root, ".tmp/context-runtime/indexer/main-index"), { recursive: true });
    await writeFile(join(root, ".tmp/context-runtime/indexer/main-index/current.json"), "Invalid retired run");
    await writeFile(join(root, ".tmp/context-runtime/indexer/delivery.json"), "Invalid retired delivery");
    await writeFile(entryPath, "throw new Error('controlled build failure');\n");
    await expect(buildProjectPackages(root)).rejects.toThrow();
    expect(await readProductionStage(root)).toEqual(stageBeforeBuild);
    expect(await readCandidateRecords(root)).toEqual(beforeBuild);
    await writeFile(entryPath, entry);
    await buildProjectPackages(root);
    const status = await collectProjectStatus(root, { managed: true });
    expect(status.approvedPages).toBe(104);
    expect(status.draftCandidates).toBe(0);
    expect(status.verifyErrors).toBe(0);
    expect(await readProductionStage(root)).toBeUndefined();
    expect(await readCandidateRecords(root)).toEqual([]);
    expect(status.workflow.current?.node).toBe("reopen-cleared-task");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 600_000);
