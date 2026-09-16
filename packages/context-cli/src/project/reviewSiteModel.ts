import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { validateKnowledgeMap } from "@c4a/context";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { loadContextProjectModule } from "./workspace.js";
import { readPendingReviewFeedback } from "./reviewFeedback.js";
import { readKnowledgeMap } from "./knowledgeMap.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { readApprovedMarkdownFiles } from "./approvedFileRead.js";
import { renderReviewMarkdown, escapeReviewHtml } from "./reviewMarkdown.js";
import type { ReviewCandidateView } from "./reviewShared.js";

export type ReviewChange = "new" | "modify" | "unchanged";
export interface ReviewSiteNode { key: string; parent: string | null; title: string; order: number; page?: string;
  change: ReviewChange; oldTitle?: string; removed?: boolean }
export interface ReviewSitePage { id: string; title: string; path: string; previousPath?: string; candidate_id?: string;
  change: ReviewChange; html: string; sources: string[]; revisionInstruction?: string }
export interface ReviewSiteModel { title: string; baselineHash: string; nodes: ReviewSiteNode[]; pages: ReviewSitePage[];
  navigationBaseline: "git-head" | "current" | "empty" }
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const body = (s: string) => s.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/u, "").replace(/<!--[^]*?-->/gu, "").trim();
const title = (s: string, fallback: string) => {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(s);
  const value = front ? (parse(front[1]!) as { title?: unknown })?.title : undefined;
  return typeof value === "string" ? value : /^#\s+(.+)$/mu.exec(s)?.[1] ?? fallback;
};
async function optional(path: string) {
  try { return await readFile(path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
}
/** Binds only displayed inputs, not every source, tool version or unrelated runtime file. */
export async function reviewSiteBaselineHash(root: string, reviewedPaths: readonly string[]): Promise<string> {
  const files = await readApprovedMarkdownFiles(root);
  return hash(JSON.stringify([await optional(join(root, "src/knowledge-map.yaml")) ?? null,
    files.map(f => [f.relPath, reviewedPaths.includes(f.relPath) ? hash(f.content) : title(f.content, f.relPath)]).sort((a, b) => a[0]!.localeCompare(b[0]!))]));
}
/** Compare complete Markdown blocks, including fenced code, tables and nested lists. */
export function reviewBodyDiff(previous: string, next: string): string {
  function blocks(markdown: string): string[] {
    const text = body(markdown);
    const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
    const definitions = tree.children.filter(node => node.type === "definition")
      .map(node => text.slice(node.position?.start.offset, node.position?.end.offset)).join("\n");
    return tree.children.filter(node => node.type !== "definition").map(node =>
      renderReviewMarkdown(text.slice(node.position?.start.offset, node.position?.end.offset) + "\n\n" + definitions));
  }
  const before = blocks(previous), after = blocks(next);
  const remaining = [...before];
  let omitted = false;
  const result = after.map(block => {
    const exact = remaining.indexOf(block);
    if (exact >= 0) {
      remaining.splice(exact, 1);
      if (/^<h[1-6]>/u.test(block)) { omitted = false; return block; }
      if (omitted) return "";
      omitted = true;
      return '<div class="unchanged" data-label="unchanged">Unchanged content omitted.</div>';
    }
    omitted = false;
    return `<section class="changed"><span class="badge modify">Modify</span>${block}</section>`;
  });
  if (remaining.length) result.push(`<section class="changed"><span class="badge modify">Modify</span><details open><summary data-label="removed">Previous or removed content</summary>${remaining.join("\n")}</details></section>`);
  return result.join("\n");
}
export async function collectReviewSiteModel(root: string, candidates: readonly ReviewCandidateView[]): Promise<ReviewSiteModel> {
  const pendingFeedback = new Map((await readPendingReviewFeedback(root, candidates)).map(r => [r.candidate_id, r.instruction]));
  const current = await readKnowledgeMap(root);
  const metadata = await readApprovedKnowledgeMetadataIndex(root);
  const articles = (metadata.structure?.articles ?? []) as Array<{ article_id: string; path: string }>;
  const files = await readApprovedMarkdownFiles(root);
  const byPath = new Map(files.map(f => [f.relPath, f.content]));
  const pages: ReviewSitePage[] = files.map(f => ({ id: articles.find(a => a.path === f.relPath)?.article_id ?? f.relPath,
    path: f.relPath, title: title(f.content, f.relPath), change: "unchanged", html: "", sources: [] }));
  for (const { record: r } of candidates) {
    const found = pages.find(p => p.id === r.article_id || p.path === (r.approved_revision?.previous_path ?? r.path));
    const old = found && byPath.get(found.path);
    const next = r.indexer_candidate.sections.map(s => s.markdown).join("\n\n");
    const page: ReviewSitePage = { id: r.article_id, candidate_id: r.candidate_id, title: r.review.title, path: r.path,
      ...(pendingFeedback.has(r.candidate_id) ? { revisionInstruction: pendingFeedback.get(r.candidate_id)! } : {}),
      ...(found && found.path !== r.path ? { previousPath: found.path } : {}), change: found ? "modify" : "new",
      html: old === undefined ? renderReviewMarkdown(next.replace(/^# [^\n]+\n*/u, "")) : reviewBodyDiff(body(old).replace(/^# [^\n]+\n*/u, ""), next.replace(/^# [^\n]+\n*/u, "")), sources: [...r.source_refs, ...r.indexer_candidate.sections.flatMap(s => s.references.map(ref => JSON.stringify(ref)))] };
    if (found) pages.splice(pages.indexOf(found), 1, page); else pages.push(page);
  }
  let baseline = current, navigationBaseline: ReviewSiteModel["navigationBaseline"] = files.length ? "current" : "empty";
  if (files.length) {
    try { const { stdout } = await promisify(execFile)("git", ["show", "HEAD:./src/knowledge-map.yaml"], { cwd: root, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
      baseline = validateKnowledgeMap(parse(stdout)); navigationBaseline = "git-head";
    } catch { /* Unversioned workspace: current navigation is context, not an invented old tree. */ }
  }
  const nodes: ReviewSiteNode[] = (current?.entries ?? []).map(n => {
    const old = baseline?.entries.find(b => b.key === n.key);
    const page = n.target && pages.find(p => p.id === n.target?.artifact_ref);
    return { key: n.key, parent: n.parent ?? null, title: n.title, order: n.order ?? 0,
      ...(page ? { page: page.id } : {}), ...(old && old.title !== n.title ? { oldTitle: old.title } : {}),
      change: navigationBaseline === "empty" || !old ? "new" : JSON.stringify(old) !== JSON.stringify(n) ? "modify" : "unchanged" };
  });
  for (const n of baseline?.entries ?? []) if (!nodes.some(v => v.key === n.key)) nodes.push({ key: n.key, parent: n.parent ?? null,
    title: n.title, order: n.order ?? 0, removed: true, change: "modify" });
  const unplaced = pages.filter(p => p.candidate_id && !nodes.some(n => n.page === p.id));
  if (unplaced.length) { nodes.push({ key: "review-unplaced", parent: null, title: "Unplaced articles", order: Number.MAX_SAFE_INTEGER, change: "new" });
    for (const [i, p] of unplaced.entries()) nodes.push({ key: `review-page-${p.id}`, parent: "review-unplaced", title: p.title, order: i, page: p.id, change: p.change }); }
  const pkgText = await optional(join(root, "package.json"));
  const pkg = pkgText ? JSON.parse(pkgText) as { name?: string } : {};
  const project = await optional(join(root, "src/index.ts")) === undefined ? undefined : await loadContextProjectModule(root);
  const siteTitle = project?.project.packages.flatMap(p => p.kind === "package.kb" && p.site?.title ? [p.site.title] : [])[0];
  return { title: siteTitle ?? pkg.name ?? "Knowledge review", baselineHash: await reviewSiteBaselineHash(root, candidates.map(c => c.record.approved_revision?.previous_path ?? c.record.path)), nodes, pages, navigationBaseline };
}
export const reviewHtmlJson = (value: unknown) => JSON.stringify(value).replace(/</gu, "\\u003c").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
export { escapeReviewHtml };
