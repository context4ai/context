import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { readCandidateRecords } from "./candidateLedger.js";
import { loadProjectIndexerCandidateCompileIndex, readProjectIndexerCandidateCompileStatus } from "./indexerCandidateCompileActions.js";
import { markdownReaderLinks } from "./markdownLinks.js";

export interface PartialDeliveryScope {
  kind: "indexer" | "revision";
  paths: string[];
  refs: string[];
}

/** Use the existing current compile and approval ledger. This selects delivery,
 * never approval, and deliberately retains source baselines until all work ends. */
export async function selectPartialDelivery(root: string, currentRefs?: ReadonlySet<string>): Promise<PartialDeliveryScope | undefined> {
  const candidates = await readCandidateRecords(root);
  if (!candidates.some(item => item.status === "draft")) return undefined;
  const status = await readProjectIndexerCandidateCompileStatus(root);
  if (status.state !== "current" || status.revision_pending) {
    throw new TypeError("Finish the active Author or repair Route before requesting partial delivery; no approval was changed");
  }
  const index = await loadProjectIndexerCandidateCompileIndex(root);
  const revision = index.approvedRevisionCandidates;
  const pages = revision ? revision.map(item => ({ path: `knowledge/${item.path}`, ref: item.view_ref }))
    : [...index.filesByDigest.values()].filter(item => currentRefs === undefined || currentRefs.has(item.artifact_ref))
      .map(item => ({ path: item.output_path, ref: item.artifact_ref }));
  const unresolved = new Set(candidates.map(item => `knowledge/${item.path}`));
  const approved = pages.filter(item => !unresolved.has(item.path) && existsSync(join(root, item.path)));
  if (approved.length === 0) return undefined; // Already waiting at Review; a repeated request grants no approval.
  await assertIndependentPages(root, approved.map(item => item.path), unresolved);
  return { kind: revision ? "revision" : "indexer", paths: approved.map(item => item.path), refs: approved.map(item => item.ref) };
}

async function assertIndependentPages(root: string, paths: string[], unresolved: ReadonlySet<string>): Promise<void> {
  for (const path of paths) {
    if (unresolved.has(path)) throw new TypeError(`Selected delivery page now needs Review: ${path}. Return to the current Route.`);
    const markdown = await readFile(join(root, path), "utf8");
    for (const link of markdownReaderLinks(markdown)) {
      if (link.image || /^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(link.target)) continue;
      let href: string;
      try { href = decodeURIComponent(link.target.split(/[?#]/u)[0]!); } catch { continue; }
      const target = posix.normalize(posix.join(posix.dirname(path), href));
      if (target.startsWith("knowledge/") && /\.md$/iu.test(target) &&
        (unresolved.has(target) || !existsSync(join(root, target)))) {
        throw new TypeError(`Partial delivery must include its linked page: ${path} → ${target}. Finish that page's Review/repair, then request delivery again; existing approvals remain.`);
      }
    }
  }
}

export async function assertPartialDeliveryCurrent(root: string, scope: PartialDeliveryScope): Promise<void> {
  const status = await readProjectIndexerCandidateCompileStatus(root);
  if (status.state !== "current" || status.revision_pending) throw new TypeError("Partial delivery compile changed; follow the current Review/repair Route before close");
  await assertIndependentPages(root, scope.paths,
    new Set((await readCandidateRecords(root)).map(item => `knowledge/${item.path}`)));
}
