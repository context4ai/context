import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { KnowledgeCollection } from "@c4a/context";
import { readCandidateRecords } from "./candidateLedger.js";
import {
  candidateSetHash,
  readReviewCandidateSnapshot,
  type ReviewCandidateView,
} from "./reviewShared.js";
import { collectReviewSiteModel, escapeReviewHtml, reviewHtmlJson, type ReviewSiteModel } from "./reviewSiteModel.js";
import { saveReviewReportScope } from "./reviewReportScope.js";
import { REVIEW_SITE_CLIENT } from "./reviewSiteClient.js";
import { REVIEW_SITE_STYLES } from "./reviewSiteStyles.js";

const REVIEW_HTML_ROOT = join(".tmp", "context-runtime", "review");

export async function collectReviewCandidates(projectRoot: string, collection: KnowledgeCollection): Promise<ReviewCandidateView[]> {
  const rows = await readCandidateRecords(projectRoot);
  const draftRows = rows.filter((row) => row.collection === collection && row.status === "draft");
  return Promise.all(draftRows.map(async (record) => ({
    record,
    snapshot: await readReviewCandidateSnapshot(projectRoot, record),
  })));
}

export async function collectAllReviewCandidates(projectRoot: string): Promise<ReviewCandidateView[]> {
  const rows = await readCandidateRecords(projectRoot);
  const draftRows = rows.filter((row) => row.status === "draft");
  return Promise.all(draftRows.map(async (record) => ({
    record,
    snapshot: await readReviewCandidateSnapshot(projectRoot, record),
  })));
}

function renderReviewHtml(model: ReviewSiteModel, diagramScript: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeReviewHtml(model.title)} · Reading report</title><style>${REVIEW_SITE_STYLES}${model.themeCss ?? ""}</style></head><body>
  <header>
    <button id="home" aria-label="返回本次内容">${escapeReviewHtml(model.title)}</button>
    <nav id="top" aria-label="知识分类"></nav>
    <div class="tools">
      <div class="reading-progress">
        <div id="counts" aria-label="阅读进度"></div>
        <div class="read-track" role="progressbar" aria-label="本轮阅读进度" aria-valuemin="0" aria-valuenow="0"><span id="read-fill"></span></div>
      </div>
      <button class="btn primary" id="copy-notes">复制修订意见</button>
    </div>
    <button class="btn" id="theme" aria-label="切换深色主题" title="切换深色主题">◐</button>
    <button class="btn" id="language" aria-label="Switch language">EN</button>
  </header>
  <div class="layout"><aside id="tree" aria-label="文章目录"></aside><main><article id="article"></article></main></div>
  <footer id="footer" hidden>
    <textarea id="revision-note" rows="1" placeholder="输入本篇修订意见……" aria-label="本篇修订意见"></textarea>
    <button class="btn" id="clear-note" disabled>清空本条修订</button>
  </footer>
  <dialog id="copy-dialog" aria-labelledby="copy-title">
    <div class="copy-heading"><h2 id="copy-title"></h2><span id="copy-countdown" hidden></span></div>
    <p id="copy-summary"></p>
    <div id="copy-preview" hidden><div id="copy-preview-text"></div><span class="copy-ellipsis" aria-hidden="true">...</span></div>
    <textarea id="copied-notes" readonly aria-label="修订意见文本"></textarea>
    <div class="dialog-actions"><button class="btn" id="copy-close">关闭</button></div>
  </dialog>
  <div id="toast" role="status" aria-live="polite" hidden></div>
${diagramScript ? `<script>${diagramScript}</script>` : ""}<script>const DATA=${reviewHtmlJson(model)};${REVIEW_SITE_CLIENT}</script></body></html>`;
}

function resolveOutputPath(projectRoot: string, outPath: string | undefined, reviewScope: KnowledgeCollection | "all"): string {
  if (outPath === undefined) return join(projectRoot, REVIEW_HTML_ROOT, `${reviewScope}.html`);
  return isAbsolute(outPath) ? outPath : resolve(projectRoot, outPath);
}

export async function writeReviewHtml(input: {
  projectRoot: string;
  collection?: KnowledgeCollection;
  all?: boolean;
  out?: string;
}): Promise<{
  path: string;
  candidates: number;
  candidate_set_digest: string;
  structure_digests: string[];
  navigation: { ready: boolean; unplaced_count: number; unplaced: { article_id: string; candidate_id: string; path: string; title: string }[] };
  next_action?: { command: string; message: string };
}> {
  const reviewScope = input.all === true ? "all" : input.collection;
  if (reviewScope === undefined) {
    throw new Error("writeReviewHtml requires collection or all scope");
  }
  const candidates = reviewScope === "all"
    ? await collectAllReviewCandidates(input.projectRoot)
    : await collectReviewCandidates(input.projectRoot, reviewScope);
  const outPath = resolveOutputPath(input.projectRoot, input.out, reviewScope);
  await mkdir(dirname(outPath), { recursive: true });
  const model = await collectReviewSiteModel(input.projectRoot, candidates);
  let diagramScript = "";
  if (model.pages.some(page => page.html.includes('class="language-mermaid"'))) {
    const here = dirname(fileURLToPath(import.meta.url));
    try { diagramScript = await readFile(join(here, "browser/diagrams.js"), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Source development uses the same prebuilt browser asset as the Node CLI.
      diagramScript = await readFile(resolve(here, "../../dist/browser/diagrams.js"), "utf8");
    }
  }
  await writeFile(outPath, renderReviewHtml(model, diagramScript), "utf8");
  await saveReviewReportScope(input.projectRoot, reviewScope, candidates, model.baselineHash);
  const unplaced = model.pages.filter(page => page.candidate_id &&
    !model.nodes.some(node => node.page === page.id && node.parent !== "review-unplaced" && !node.removed))
    .map(page => ({ article_id: page.id, candidate_id: page.candidate_id!, path: page.path, title: page.title }));
  return {
    navigation: { ready: unplaced.length === 0, unplaced_count: unplaced.length, unplaced },
    ...(unplaced.length ? { next_action: { command: "context task adjust --input - --format json",
      message: "Bind the listed drafts to suitable existing categories before requesting review, then regenerate this report. Content approval is not required for navigation." } } : {}),
    path: outPath,
    candidates: candidates.length,
    candidate_set_digest: candidateSetHash(candidates.map(({ record }) => record)),
    structure_digests: [...new Set(candidates
      .map(({ record }) => record.structure_digest)
      .filter((digest): digest is string => digest !== undefined))].sort(),
  };
}
