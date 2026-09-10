import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates, completePartitionStage, completeAuthorStage } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { advanceCurrentIndexerLifecycle } from "../project/indexerCurrentLifecycle.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";

test("a token-only library can use an explicit system subject without React exports", async () => {
  const root = await createDocumentRevisionWorkspace({
    purpose: "Locate token declarations and their scope; do not infer complete design rules from names.",
    packageJson: { exports: { "./tokens.css": "./src/tokens.css" } },
    sourceFiles: { "src/tokens.css": ":root { --color-action: #123456; --space-unit: 4px; }\n" },
  });
  try {
    await completePartitionStage(root, true, false, "theme-tokens", undefined, "design-system", "component-library-l03");
    const review = (await currentIndexerStructureReview(root))!;
    expect(JSON.stringify(review.preview)).toContain("design-system");
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: review.revision, decision: "approved" });
    await completeAuthorStage(root, { markdown: "The token source is `src/tokens.css`: `--color-action` and `--space-unit` are declared under `:root`. Start at that file to inspect values; component consumption and broader design rules need separate evidence." });
    await advanceCurrentIndexerLifecycle(root);
    const candidates = await readCandidateRecords(root);
    expect(candidates.length).toBeGreaterThan(0);
    await approveCandidates(root, candidates);
    await closeProjectWorkspace(root);
    for (const candidate of candidates) {
      expect(await readFile(join(root, "knowledge", candidate.path), "utf8")).toContain("--color-action");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
