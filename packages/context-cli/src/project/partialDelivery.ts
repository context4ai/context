import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { observeApprovedRevisionBatch } from "./approvedRevisionBatch.js";
import { markdownReaderLinks } from "./markdownLinks.js";

export interface PartialDeliveryScope {
  kind: "indexer" | "revision";
  paths: string[];
  refs: string[];
}

/** Use the current revision and approval records. This selects delivery,
 * never approval, and deliberately retains source baselines until all work ends. */
export async function selectPartialDelivery(root: string): Promise<PartialDeliveryScope | undefined> {
  const candidates = await readCandidateRecords(root);
  if (!candidates.some(item => item.status === "draft")) return undefined;
  const revision = await readApprovedRevision(root);
  if (!revision) return undefined;
  const status = await observeApprovedRevisionBatch(root, revision);
  if (status.state !== "current" || status.revision_pending) {
    throw new TypeError("Finish the active Author or repair Route before requesting partial delivery; no approval was changed");
  }
  const pages = [...revision.batch_candidates ?? [], ...revision.candidate ? [revision.candidate] : []]
    .map(item => ({ path: `knowledge/${item.path}`, ref: item.article_id }));
  const unresolved = new Set(candidates.map(item => `knowledge/${item.path}`));
  const approved = pages.filter(item => !unresolved.has(item.path) && existsSync(join(root, item.path)));
  if (approved.length === 0) return undefined; // Already waiting at Review; a repeated request grants no approval.
  await assertIndependentPages(root, approved.map(item => item.path), unresolved);
  return { kind: "revision", paths: approved.map(item => item.path), refs: approved.map(item => item.ref) };
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
  const revision = await readApprovedRevision(root);
  if (!revision) throw new TypeError("Partial revision delivery is no longer active; refresh context status --format json.");
  const status = await observeApprovedRevisionBatch(root, revision);
  if (status.state !== "current" || status.revision_pending) throw new TypeError("Partial delivery compile changed; follow the current Review/repair Route before close");
  const expected = [...revision.batch_candidates ?? [], ...revision.candidate ? [revision.candidate] : []];
  if (scope.kind !== "revision" || scope.paths.length !== scope.refs.length || scope.paths.some((path, index) =>
    !expected.some(candidate => `knowledge/${candidate.path}` === path && candidate.article_id === scope.refs[index]))) {
    throw new TypeError("Partial delivery selection is outside the active revision batch; request delivery again.");
  }
  await assertIndependentPages(root, scope.paths,
    new Set((await readCandidateRecords(root)).map(item => `knowledge/${item.path}`)));
}
