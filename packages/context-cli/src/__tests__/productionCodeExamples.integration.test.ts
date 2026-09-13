import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";

test("code examples with the same basename retain distinct full paths and source evidence in formal articles", async () => {
  const paths = ["src/index.ts", "examples/basic/demo.tsx", "examples/advanced/demo.tsx"];
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1, sourceFiles: {
    "src/index.ts": "export const answer = 42;\n",
    "examples/basic/demo.tsx": 'import {answer} from "../../src/index";\nexport const Basic = () => String(answer);\n',
    "examples/advanced/demo.tsx": 'import {answer} from "../../src/index";\nexport const Advanced = () => String(answer * 2);\n',
  } });
  try {
    await produceFixtureArticles(root, [{
      path: "architecture/examples.md", question: "Where are the basic and advanced examples?",
      sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: '---\ntitle: Public constant examples\ndescription: Distinct basic and advanced usage examples.\n---\n\n<!-- context:section id="examples" -->\nThe basic example displays the answer; the advanced example displays twice the answer.\n<!-- /context:section -->\n',
      references: { sections: [{ id: "examples", references: paths.map(path => ({
        source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path, start_line: 1, end_line: path === "src/index.ts" ? 1 : 2 },
      })) }] },
    }]);
    const candidates = await readCandidateRecords(root);
    expect(candidates).toHaveLength(1);
    const references = candidates[0]!.indexer_candidate.sections.flatMap(section => section.references);
    expect(references.map(reference => reference.locator.path).sort()).toEqual([...paths].sort());
    expect(references.every(reference => /^sha256:[a-f0-9]{64}$/.test(reference.content_digest))).toBe(true);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    await rm(join(root, ".tmp"), { recursive: true, force: true });
    const structure = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8"));
    expect(structure.articles[0].sections[0].references).toEqual(references);
    expect(await readFile(join(root, "knowledge/architecture/examples.md"), "utf8")).toContain("twice the answer");
  } finally { await rm(root, { recursive: true, force: true }); }
});
