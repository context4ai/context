import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { KnowledgeCollection } from "@c4a/context";
import { readCandidateRecords } from "./candidateLedger.js";
import {
  candidateIdsHash,
  candidateSetHash,
  readReviewCandidateSnapshot,
  type ReviewCandidateView,
} from "./reviewShared.js";
import { collectReviewSiteModel, escapeReviewHtml, reviewHtmlJson, type ReviewSiteModel } from "./reviewSiteModel.js";
import { createReviewFeedbackCodec } from "./reviewFeedbackCode.js";
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

function renderReviewHtml(candidates: readonly ReviewCandidateView[], reviewScope: KnowledgeCollection | "all", model: ReviewSiteModel): string {
  const scope = { label: reviewScope, ids_sha256: candidateIdsHash(candidates.map(c => c.record.candidate_id).sort()),
    candidates_sha256: candidateSetHash(candidates.map(c => c.record)) };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeReviewHtml(model.title)} · Review</title><style>${REVIEW_SITE_STYLES}</style></head><body>
<header><button id="home">${escapeReviewHtml(model.title)}</button><nav id="top"></nav><div class="tools"><div class="counter" tabindex="0"><span id="counts"></span><div class="counter-pop" id="counter-pop"></div></div><button class="btn" id="all-approved"></button><button class="btn" id="all-rejected"></button><button class="btn primary" id="payload-open"></button><div class="guide" id="copy-guide"><span id="guide-countdown">10s</span><p id="guide-text"></p><button class="btn" id="guide-close"></button></div></div><button class="btn" id="theme" aria-label="Theme">◐</button><button class="btn" id="language"></button></header>
<div class="layout"><aside id="tree"></aside><main><article id="article"></article></main></div>
<footer id="footer" hidden><input id="revision-note" aria-label="Revision instructions"><button class="btn" id="revise-btn"></button><button class="btn" id="reject-btn"></button><button class="btn primary" id="approve-btn"></button></footer>
<dialog id="bulk-dialog"><h2 id="bulk-title"></h2><p id="bulk-message"></p><div id="bulk-roots" hidden><strong id="bulk-roots-title"></strong><ul id="bulk-roots-list"></ul><label class="bulk-ack"><input type="checkbox" id="bulk-ack"><span id="bulk-ack-label"></span></label></div><div class="dialog-actions"><button class="btn" id="bulk-cancel"></button><button class="btn primary" id="bulk-confirm"></button></div></dialog>
<dialog id="copy-dialog"><h2 id="copy-title"></h2><p id="copy-summary"></p><p id="copy-instructions"></p><textarea id="payload" readonly aria-label="Review code"></textarea><p id="copy-warning"></p><button class="btn" id="payload-close"></button></dialog>
<script>const DATA=${reviewHtmlJson(model)};const SCOPE=${reviewHtmlJson(scope)};const feedbackCodec=(${createReviewFeedbackCodec.toString()})();${REVIEW_SITE_CLIENT}</script></body></html>`;
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
  await writeFile(outPath, renderReviewHtml(candidates, reviewScope, await collectReviewSiteModel(input.projectRoot, candidates)), "utf8");
  return {
    path: outPath,
    candidates: candidates.length,
    candidate_set_digest: candidateSetHash(candidates.map(({ record }) => record)),
    structure_digests: [...new Set(candidates
      .map(({ record }) => record.structure_digest)
      .filter((digest): digest is string => digest !== undefined))].sort(),
  };
}
