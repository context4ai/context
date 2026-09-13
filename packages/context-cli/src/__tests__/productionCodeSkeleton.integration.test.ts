import { expect, test } from "bun:test";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { readProductionRequirements } from "../project/productionRequirements.js";
import { prepareProductionPlanningMaterials } from "../project/productionPlanningMaterials.js";

test("code planning exposes file navigation and writing does not require a deep parser ledger", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1, sourceFiles: {
    "src/feature/entry.ts": "export function calculate(value: number) { return value + 1; }\n",
    ...Object.fromEntries(Array.from({ length: 65 }, (_, index) => [
      "src/feature/helper-" + index + ".ts", "export const helper" + index + " = " + index + ";\n",
    ])),
  } });
  try {
    const result = await prepareProductionPlanningMaterials({ projectRoot: root,
      requirements: await readProductionRequirements(root) });
    expect(result.gaps).toEqual([]);
    const skeleton = result.materials.sources!.get(DOCUMENT_REVISION_SOURCE_REF)!;
    expect(skeleton).toContain("src/feature/entry.ts");
    expect(skeleton).toContain("src/feature/helper-64.ts");
    expect(skeleton).toContain("Complete authorized tracked-file count:");
    expect(skeleton).not.toContain("export function calculate");
    const parserFiles = () => readdir(join(root, ".tmp/context-runtime/parser-preparations")).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return [];
    });
    expect(await parserFiles()).toEqual([]);
    await produceFixtureArticles(root, [{
      path: "architecture/calculation.md", question: "What does calculate return?",
      sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: '---\ntitle: Calculation entry\ndescription: The exported calculation behavior.\n---\n\n<!-- context:section id="behavior" -->\nThe calculate function returns its input plus one.\n<!-- /context:section -->\n',
      references: { sections: [{ id: "behavior", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
        locator: { path: "src/feature/entry.ts", start_line: 1, end_line: 1 } }] }] },
    }]);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    expect(await parserFiles()).toEqual([]);
    expect(await readFile(join(root, "knowledge/architecture/calculation.md"), "utf8")).toContain("input plus one");
  } finally { await rm(root, { recursive: true, force: true }); }
});
