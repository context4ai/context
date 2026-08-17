import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readProseCompileBatchProgress } from "../project/proseCompileBatch.js";
import type { AlignPayload } from "../project/proseAlignTypes.js";

describe("0.6.2 prose resource repair", () => {
  test("an approved view requiring resource repair re-enters the compile batch", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-prose-resource-repair-"));
    try {
      const approvedPath = join(projectRoot, "knowledge", "sop", "example.md");
      await mkdir(dirname(approvedPath), { recursive: true });
      await writeFile(approvedPath, [
        "---",
        "view_ref: sop:action/example",
        "---",
        "",
        "# Example",
      ].join("\n"), "utf8");
      const structure = {
        structure_digest: "sha256:structure",
        sources: ["lark:20260812/reference"],
        lifecycle: { state: "confirmed", phase_collection: "sop" },
        views: [{ view_ref: "sop:action/example", collection: "sop" }],
      } as unknown as AlignPayload;

      const current = await readProseCompileBatchProgress({ projectRoot, structure });
      expect(current).toMatchObject({ complete: true, remainingViewRefs: [] });

      const repair = await readProseCompileBatchProgress({
        projectRoot,
        structure,
        recompileViewRefs: new Set(["sop:action/example"]),
      });
      expect(repair).toMatchObject({
        complete: false,
        nextViewRef: "sop:action/example",
        remainingViewRefs: ["sop:action/example"],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
