import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";

test("a token-only library can use an explicit system subject without React exports", async () => {
  const root = await createDocumentRevisionWorkspace({
    purpose: "Locate token declarations and their scope; do not infer complete design rules from names.",
    packageJson: { exports: { "./tokens.css": "./src/tokens.css" } },
    sourceFiles: { "src/tokens.css": ":root { --color-action: #123456; --space-unit: 4px; }\n" },
  });
  try {
    await produceFixtureArticles(root, [{
      path: "architecture/theme-tokens.md", question: "Where are the token declarations?",
      sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: '---\ntitle: Theme tokens\ndescription: Token declarations and source scope.\n---\n\n<!-- context:section id="tokens" -->\nThe token source src/tokens.css declares --color-action and --space-unit under :root. Component consumption and broader design rules need separate evidence.\n<!-- /context:section -->\n',
      references: { sections: [{ id: "tokens", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
        locator: { path: "src/tokens.css", start_line: 1, end_line: 1 } }] }] },
    }]);
    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(0);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    for (const candidate of candidates) {
      expect(await readFile(join(root, "knowledge", candidate.path), "utf8")).toContain("--color-action");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
