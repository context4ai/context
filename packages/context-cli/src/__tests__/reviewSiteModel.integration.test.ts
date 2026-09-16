import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { collectAllReviewCandidates } from "../project/reviewHtml.js";
import { collectReviewSiteModel, reviewSiteBaselineHash } from "../project/reviewSiteModel.js";

test("new and established workspaces derive real changes and bind only displayed body content", async () => {
  const root = await prepareRevisionKnowledge([]);
  try {
    const candidates = await collectAllReviewCandidates(root);
    const initial = await collectReviewSiteModel(root, candidates);
    expect(initial.pages.every(p => p.change === "new")).toBe(true);
    await approveCandidates(root, candidates.map(c => c.record));
    const original = candidates[0]!;
    const revised = { ...original, record: { ...original.record, review: { ...original.record.review, title: "Updated answer" },
      indexer_candidate: { ...original.record.indexer_candidate, sections: original.record.indexer_candidate.sections.map(s => ({ ...s,
        markdown: s.markdown.replace("value 42", "value 43") })) } } };
    const model = await collectReviewSiteModel(root, [revised]);
    expect(model.pages.find(p => p.candidate_id)?.change).toBe("modify");
    expect(model.pages.find(p => p.candidate_id)?.html).toContain("value 43");
    expect(model.pages.find(p => p.candidate_id)?.html).toContain("value 42");
    expect(model.pages.find(p => !p.candidate_id)?.html).toBe("");
    const paths = [original.record.path];
    const baseline = await reviewSiteBaselineHash(root, paths);
    const other = join(root, "knowledge", candidates[1]!.record.path);
    await writeFile(other, (await readFile(other, "utf8")).replace("value 42", "value 44"));
    expect(await reviewSiteBaselineHash(root, paths)).toBe(baseline);
    const affected = join(root, "knowledge", original.record.path);
    await writeFile(affected, (await readFile(affected, "utf8")).replace("value 42", "value 45"));
    expect(await reviewSiteBaselineHash(root, paths)).not.toBe(baseline);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 45000);
