import { readFile, writeFile } from "node:fs/promises";
import { approvedPageForArticleId, updateFrontmatter, writeReviewActionLog,
  type ReviewMaintenanceResult } from "./reviewShared.js";
import { withProjectWriteLock } from "./writeLock.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";

/** Region changes use normal revision, not a second evidence-maintenance flow. */
export function deprecateApprovedPage(input: {
  projectRoot: string;
  viewRef: string;
}): Promise<ReviewMaintenanceResult> {
  return withProjectWriteLock(input.projectRoot, "deprecate-article", async () => {
    const page = await approvedPageForArticleId(input.projectRoot, input.viewRef);
    const original = await readFile(page.path, "utf8");
    const content = parseFrontmatterLoose(original).deprecated === true ? original
      : updateFrontmatter(original, metadata => ({ ...metadata, deprecated: true, timestamp: new Date().toISOString() }));
    const changed = content !== original;
    if (changed) await writeFile(page.path, content, "utf8");
    const actionLog = await writeReviewActionLog({ projectRoot: input.projectRoot,
      action: "deprecate", id: input.viewRef, summary: { path: page.relPath, changed } });
    return { id: input.viewRef, path: page.relPath, changed, actionLog };
  });
}
