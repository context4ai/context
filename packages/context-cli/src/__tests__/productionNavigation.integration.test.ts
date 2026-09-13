import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildFixturePackages } from "./workspaceVersionDelivery.fixture.js";
import { readKnowledgeMap } from "../project/knowledgeMap.js";
import { adjustCurrentTaskSources } from "../project/taskSourceAdjustment.js";

test("reader navigation spans current articles and can be renamed without rewriting their prose", async () => {
  const roots: string[] = [];
  try {
    const root = await prepareRevisionKnowledge(roots);
    const candidates = await readCandidateRecords(root);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    const bodies = await Promise.all(candidates.map(candidate => readFile(join(root, "knowledge", candidate.path), "utf8")));
    await adjustCurrentTaskSources(root, { knowledge_map: { expected_revision: null, remove: [], upsert: [
      { key: "guide", parent: null, title: "Public entry guide", order: 0 },
      ...candidates.map((candidate, index) => ({ key: "article-" + index, parent: "guide",
        title: candidate.review.title, order: index, target: { artifact_ref: candidate.article_id,
          section_key: candidate.indexer_candidate.sections[0]!.section_key } })),
    ] } });
    await acceptStarterPackageTemplates({ projectRoot: root });
    await buildFixturePackages(root);
    const navigation = JSON.parse(await readFile(join(root, "dist/update-kb/context-knowledge-map.json"), "utf8"));
    expect(navigation.warnings).toEqual([]);
    expect(navigation.entries[0].children).toHaveLength(candidates.length);
    for (const child of navigation.entries[0].children) {
      const [path, anchor] = child.href.split("#");
      expect(await readFile(join(root, "dist/update-kb", decodeURIComponent(path)), "utf8")).toContain('<a id="' + anchor + '"></a>');
    }
    const map = (await readKnowledgeMap(root))!;
    await adjustCurrentTaskSources(root, { knowledge_map: { expected_revision: map.revision, remove: [],
      upsert: [{ ...map.entries.find(entry => entry.key === "guide")!, title: "Adoption by reader task" }] } });
    expect((await buildFixturePackages(root)).packages[0]!.state).toBe("updated");
    expect(await readFile(join(root, "dist/update-kb/index.md"), "utf8")).toContain("Adoption by reader task");
    expect(await Promise.all(candidates.map(candidate => readFile(join(root, "knowledge", candidate.path), "utf8")))).toEqual(bodies);
    expect((await buildFixturePackages(root)).packages[0]!.state).toBe("unchanged");
  } finally { for (const root of roots) await rm(root, { recursive: true, force: true }); }
}, 60_000);
