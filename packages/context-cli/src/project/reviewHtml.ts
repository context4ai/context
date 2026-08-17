import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KnowledgeCollection } from "@c4a/context";
import type {
  DocumentResourceMaterializationItem,
  DocumentSnapshotAssetEntry,
  DocumentSnapshotManifest,
} from "@c4a/extract";
import { captureReportMaterialization } from "../lib/larkCaptureReport.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readDocumentSnapshotCaptureReport } from "./documentSnapshotFidelity.js";
import {
  candidateIdsHash,
  candidateSetHash,
  currentProseCandidateEvidence,
  readReviewCandidateSnapshot,
  REVIEW_PAYLOAD_SCHEMA,
  type ReviewCandidateView,
} from "./reviewShared.js";
import { collectReviewSourceExcerpts, type ReviewSourceExcerptMap } from "./reviewSourceExcerpts.js";
import {
  candidateGroupKey,
  candidateGroupLabel,
  candidatePreview,
  edgeForReview,
  endpointLabels,
  filterEdgePreviewForCandidate,
  filterEdgePreviewForCandidates,
  readEdgePreview,
  renderEdgePreview,
  type EdgePreview,
} from "./reviewHtmlPresentation.js";
import { REVIEW_HTML_STYLES } from "./reviewHtmlStyles.js";
import { markdownInlineLinks } from "./markdownLinks.js";

const REVIEW_HTML_ROOT = join(".tmp", "context-runtime", "review");

export interface ReviewResourcePreview {
  label: string;
  kind: string;
  status: "materialized" | "reference-only" | "failed";
  url?: string;
  media_type: string;
  image: boolean;
  reason?: string;
}

function decodedLinkTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function linkedResourcePreviews(input: {
  projectRoot: string;
  materializedAt: string;
  documentPath: string;
  markdown: string;
  assetsByPath: ReadonlyMap<string, DocumentSnapshotAssetEntry>;
}): Map<string, ReviewResourcePreview> {
  const previews = new Map<string, ReviewResourcePreview>();
  for (const link of markdownInlineLinks(input.markdown)) {
    const target = link.target;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("/")) continue;
    const assetPath = join(dirname(input.documentPath), decodedLinkTarget(target)).split("\\").join("/");
    const asset = input.assetsByPath.get(assetPath);
    if (asset?.content_hash === undefined || asset.role === "audit") continue;
    previews.set(asset.path, {
      label: link.label || "Resource",
      kind: asset.source?.kind ?? "resource",
      status: "materialized",
      url: pathToFileURL(join(input.projectRoot, input.materializedAt, asset.path)).href,
      media_type: asset.media_type ?? "application/octet-stream",
      image: asset.media_type?.startsWith("image/") === true,
    });
  }
  return previews;
}

function materializationPreview(input: {
  projectRoot: string;
  materializedAt: string;
  item: DocumentResourceMaterializationItem;
  assetsByPath: ReadonlyMap<string, DocumentSnapshotAssetEntry>;
  existing?: ReviewResourcePreview;
}): { key: string; preview: ReviewResourcePreview } {
  const linkedAsset = input.item.asset_paths
    .flatMap((path) => [path, path.startsWith("assets/") ? path : `assets/${path}`])
    .map((path) => input.assetsByPath.get(path))
    .find((asset) => asset !== undefined && asset.role !== "audit");
  const url = input.existing?.url ?? (linkedAsset?.content_hash === undefined
    ? undefined
    : pathToFileURL(join(input.projectRoot, input.materializedAt, linkedAsset.path)).href);
  return {
    key: linkedAsset?.path ?? input.item.locator,
    preview: {
      label: input.existing?.label ?? linkedAsset?.source?.title ?? input.item.kind,
      kind: input.item.kind,
      status: input.item.status,
      ...(url === undefined ? {} : { url }),
      media_type: input.existing?.media_type ?? linkedAsset?.media_type ?? "application/octet-stream",
      image: input.existing?.image ?? linkedAsset?.media_type?.startsWith("image/") === true,
      ...(input.item.reason === undefined ? {} : { reason: input.item.reason }),
    },
  };
}

export function reviewResourcePreviewsFor(input: {
  projectRoot: string;
  materializedAt: string;
  documentPath: string;
  markdown: string;
  manifest: DocumentSnapshotManifest;
}): ReviewResourcePreview[] {
  const byPath = new Map((input.manifest.assets ?? []).map((asset) => [asset.path, asset]));
  const previews = linkedResourcePreviews({ ...input, assetsByPath: byPath });
  const captureReport = readDocumentSnapshotCaptureReport({
    projectRoot: input.projectRoot,
    materializedAt: input.materializedAt,
    manifest: input.manifest,
  });
  const resourceMaterialization = captureReport === undefined
    ? input.manifest.metadata?.capture?.resourceMaterialization
    : captureReportMaterialization(captureReport);
  for (const item of resourceMaterialization?.items ?? []) {
    if (!input.markdown.includes(item.locator)) continue;
    const existing = [...previews.entries()]
      .find(([key]) => item.asset_paths.some((path) => key === path || key === `assets/${path}`))?.[1];
    const result = materializationPreview({
      projectRoot: input.projectRoot,
      materializedAt: input.materializedAt,
      item,
      assetsByPath: byPath,
      ...(existing === undefined ? {} : { existing }),
    });
    previews.set(result.key, result.preview);
  }
  return [...previews.values()];
}

async function collectReviewResourcePreviews(
  projectRoot: string,
  candidates: readonly ReviewCandidateView[],
): Promise<Map<string, ReviewResourcePreview[]>> {
  const result = new Map<string, ReviewResourcePreview[]>();
  for (const candidate of candidates) {
    if (candidate.record.candidate_type !== "prose-align") continue;
    const evidence = await currentProseCandidateEvidence(projectRoot, candidate.record);
    if (evidence === undefined) continue;
    const markdown = (candidate.record.sections ?? []).map((section) => section.body ?? "").join("\n\n");
    const previews = reviewResourcePreviewsFor({
      projectRoot,
      materializedAt: evidence.indexResult.index.materialized_at,
      documentPath: evidence.parsed.documentPath,
      markdown,
      manifest: evidence.indexResult.manifest,
    });
    if (previews.length > 0) result.set(candidate.record.candidate_id, previews);
  }
  return result;
}

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function renderReviewHtml(
  candidates: readonly ReviewCandidateView[],
  reviewScope: KnowledgeCollection | "all",
  edgePreview: readonly EdgePreview[],
  sourceExcerpts: ReviewSourceExcerptMap,
  resourcePreviews: ReadonlyMap<string, ReviewResourcePreview[]>,
): string {
  const labels = endpointLabels(candidates);
  const candidateIds = candidates.map(({ record }) => record.candidate_id);
  const visibleCandidateIds = [...candidateIds].sort();
  const scope = {
    kind: reviewScope === "all" ? "all" : "collection",
    ...(reviewScope !== "all" ? { collection: reviewScope } : {}),
    count: visibleCandidateIds.length,
    ids_sha256: candidateIdsHash(visibleCandidateIds),
    candidates_sha256: candidateSetHash(candidates.map(({ record }) => record)),
    ...(reviewScope === "all" ? { visible_candidate_ids: visibleCandidateIds } : {}),
  };
  const candidateData = candidates.map(({ record, snapshot }) => {
    const excerptsByRef = sourceExcerpts.get(record.candidate_id);
    return {
    candidate_id: record.candidate_id,
    collection: record.collection,
    node_ref: record.node_ref,
    view_ref: record.view_ref,
    module: record.module,
    status: record.status,
    kind: record.kind,
    entity_type: record.source_refs.some((ref) => ref.includes("#symbol:")) || record.node_ref.includes("/symbol/") ? "symbol" : "entity",
    symbol_kind: snapshot?.symbol?.kind ?? record.kind,
    visibility: record.visibility,
    source_refs: record.source_refs,
    shared_source_refs: record.shared_source_refs ?? [],
    related_edges: filterEdgePreviewForCandidate(record, edgePreview).map((edge) => edgeForReview(edge, labels)),
    sections: (record.sections ?? []).map((section) => ({
      id: section.id,
      kind: section.kind,
      summary: section.summary,
      body: section.body,
      source_refs: section.source_refs ?? [section.source_ref],
      source_excerpts: (section.source_refs ?? [section.source_ref])
        .map((sourceRef) => excerptsByRef?.get(sourceRef))
        .filter((excerpt) => excerpt !== undefined),
      content_mode: section.content_mode ?? "verbatim",
    })),
    group_key: reviewScope === "all"
      ? `${record.collection} / ${candidateGroupKey({ record, snapshot })}`
      : candidateGroupKey({ record, snapshot }),
    group_label: reviewScope === "all"
      ? `${record.collection} · ${candidateGroupLabel({ record, snapshot })}`
      : candidateGroupLabel({ record, snapshot }),
    review: record.review,
    display_summary: record.review.behavior_summary ?? record.review.summary,
    preview: candidatePreview({ record, snapshot }),
    resource_previews: resourcePreviews.get(record.candidate_id) ?? [],
    snapshot_ready: snapshot !== undefined,
    };
  });

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Context Review - ${escapeHtml(reviewScope)}</title>
  <style>${REVIEW_HTML_STYLES}</style>
</head>
<body>
  <main class="shell">
    <header class="header">
      <div class="titleline">
        <h1>Context Review</h1>
        <div class="subtle" id="count-state">${candidates.length} draft candidate(s) in ${escapeHtml(reviewScope)} · ${candidates.length} pending 0 approved 0 rejected</div>
      </div>
      <div class="toolbar">
        <span class="subtle payload-hint">After review, open Payload and paste it into agent chat -></span>
        <span class="bulk-actions">
          <button class="btn" id="all-approved">All approved</button>
          <button class="btn" id="all-rejected">All rejected</button>
        </span>
        <button class="btn brand" id="payload-open">Payload</button>
        <span class="subtle" id="copy-state"></span>
        <button class="btn icon-btn" id="theme" title="Toggle theme" aria-label="Toggle theme">🌙</button>
      </div>
    </header>
    ${renderEdgePreview(edgePreview, labels)}
    <section class="layout">
      <aside class="panel candidate-panel">
        <div class="panel-head candidate-head">
          <span>Candidates</span>
          <div class="filters" aria-label="candidate filters">
            <label class="filter"><input id="filter-approved" type="checkbox" checked> approved</label>
            <label class="filter"><input id="filter-rejected" type="checkbox" checked> rejected</label>
            <label class="filter"><input id="filter-pending" type="checkbox" checked> pending</label>
          </div>
        </div>
        <div id="list"></div>
      </aside>
      <section class="panel detail-panel">
        <div class="panel-head">Decision</div>
        <div class="detail" id="detail"></div>
      </section>
    </section>
    <div class="modal hidden" id="payload-modal" role="dialog" aria-modal="true" aria-labelledby="payload-title">
      <section class="modal-card">
        <div>
          <h2 id="payload-title">Review decision Payload</h2>
          <div class="subtle">Copy this compact decision Payload into the agent chat. Uniform decisions use one line; exceptions add JSONL lines. The agent will write a temporary file and continue review apply.</div>
        </div>
        <div class="modal-body">
          <textarea id="payload" aria-label="review payload" readonly></textarea>
        </div>
        <div class="modal-actions">
          <span class="subtle" id="modal-copy-state"></span>
          <button class="btn" id="payload-close">Close</button>
          <button class="btn primary" id="payload-copy">Copy</button>
        </div>
      </section>
    </div>
  </main>
  <script>
    const candidates = ${jsonForScript(candidateData)};
    const payloadScope = ${jsonForScript(scope)};
    const payloadSchema = ${jsonForScript(REVIEW_PAYLOAD_SCHEMA)};
    const payloadScopeLabel = ${jsonForScript(reviewScope)};
    const decisions = new Map(candidates.map((item) => [item.candidate_id, "pending"]));
    const list = document.getElementById("list");
    const detail = document.getElementById("detail");
    const countState = document.getElementById("count-state");
    const filterApproved = document.getElementById("filter-approved");
    const filterRejected = document.getElementById("filter-rejected");
    const filterPending = document.getElementById("filter-pending");
    const theme = document.getElementById("theme");
    const allApproved = document.getElementById("all-approved");
    const allRejected = document.getElementById("all-rejected");
    const payloadOpen = document.getElementById("payload-open");
    const payloadModal = document.getElementById("payload-modal");
    const payloadClose = document.getElementById("payload-close");
    const payloadCopy = document.getElementById("payload-copy");
    const payloadBox = document.getElementById("payload");
    const copyState = document.getElementById("copy-state");
    const modalCopyState = document.getElementById("modal-copy-state");
    let selected = candidates[0]?.candidate_id;
    const collapsedGroups = new Set();

    function html(value) {
      return String(value).replace(/[&<>"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[char]));
    }
    function decisionCounts() {
      const counts = { pending: 0, approved: 0, rejected: 0 };
      for (const status of decisions.values()) counts[status] += 1;
      return counts;
    }
    function updateCountState() {
      const counts = decisionCounts();
      countState.textContent = candidates.length + " draft candidate(s) in " + payloadScopeLabel +
        " · " + counts.pending + " pending " + counts.approved + " approved " + counts.rejected + " rejected";
    }
    function visibleCandidates() {
      const showApproved = filterApproved.checked;
      const showRejected = filterRejected.checked;
      const showPending = filterPending.checked;
      return candidates.filter((item) => {
        const status = decisions.get(item.candidate_id);
        return (status === "pending" && showPending) ||
          (status === "approved" && showApproved) ||
          (status === "rejected" && showRejected);
      });
    }
    function groupCandidates(items) {
      const groups = [];
      const byGroup = new Map();
      for (const item of items) {
        const key = item.group_key || item.module || "ungrouped";
        let group = byGroup.get(key);
        if (!group) {
          group = { key, label: item.group_label || key, items: [] };
          byGroup.set(key, group);
          groups.push(group);
        }
        group.items.push(item);
      }
      return groups;
    }
    function statusBadge(status) {
      return '<span class="badge ' + html(status) + '">' + html(status) + '</span>';
    }
    function typeBadge(item) {
      return item.entity_type === "symbol"
        ? '<span class="badge">' + html(item.symbol_kind || "symbol") + '</span>'
        : "";
    }
    function toggleGroup(groupKey) {
      if (collapsedGroups.has(groupKey)) collapsedGroups.delete(groupKey);
      else collapsedGroups.add(groupKey);
      render();
    }
    function setGroupDecision(groupKey, status) {
      const items = candidates.filter((item) => (item.group_key || item.module || "ungrouped") === groupKey);
      if (items.length === 0) return;
      if (!window.confirm("Set all " + items.length + " candidate(s) in " + groupKey + " to " + status + "?")) return;
      for (const item of items) {
        if (status === "approved" && !item.snapshot_ready) continue;
        decisions.set(item.candidate_id, status);
      }
      render();
      updatePayloadBox();
    }
    function setAllDecision(status) {
      if (candidates.length === 0) return;
      if (!window.confirm("Set all " + candidates.length + " candidate(s) to " + status + "?")) return;
      for (const item of candidates) {
        if (status === "approved" && !item.snapshot_ready) continue;
        decisions.set(item.candidate_id, status);
      }
      render();
      updatePayloadBox();
    }
    function payloadText() {
      const counts = decisionCounts();
      if (counts.pending > 0) {
        return [
          "# Review payload is not ready",
          "# " + counts.pending + " pending candidate(s) remain.",
          "# Approve or reject every candidate before copying.",
        ].join("\\n");
      }
      const defaultStatus = counts.rejected > counts.approved ? "rejected" : "approved";
      const header = {
        schema: payloadSchema,
        default: defaultStatus,
        total: candidates.length,
        counts,
        scope: payloadScope,
        note: "Apply these review decisions and continue"
      };
      if (payloadScope.kind === "collection") header.collection = payloadScope.collection;
      const exceptions = candidates
        .map((item) => ({ candidate_id: item.candidate_id, status: decisions.get(item.candidate_id) }))
        .filter((item) => item.status !== defaultStatus);
      return [JSON.stringify(header), ...exceptions.map((item) => JSON.stringify(item))].join("\\n");
    }
    function setDecision(id, status) {
      const item = candidates.find((candidate) => candidate.candidate_id === id);
      if (status === "approved" && item && !item.snapshot_ready) return;
      decisions.set(id, status);
      render();
      updatePayloadBox();
    }
    function updatePayloadBox() {
      payloadBox.value = payloadText();
      const counts = decisionCounts();
      const ready = counts.pending === 0;
      payloadCopy.disabled = !ready;
      payloadOpen.classList.toggle("ready", ready);
      payloadOpen.title = ready
        ? "Open review payload"
        : counts.pending + " pending candidate(s) remain";
    }
    function openPayloadModal() {
      updatePayloadBox();
      payloadModal.classList.remove("hidden");
      payloadBox.focus();
      payloadBox.select();
      copyState.textContent = "";
      modalCopyState.textContent = "";
    }
    function closePayloadModal() {
      payloadModal.classList.add("hidden");
    }
    async function copyPayload() {
      const counts = decisionCounts();
      if (counts.pending > 0) {
        updatePayloadBox();
        const message = "Resolve all pending candidates before copying";
        copyState.textContent = message;
        modalCopyState.textContent = message;
        return;
      }
      const text = payloadText();
      payloadBox.value = text;
      try {
        if (!navigator.clipboard) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(text);
        copyState.textContent = "Copied";
        modalCopyState.textContent = "Copied";
      } catch {
        payloadBox.focus();
        payloadBox.select();
        copyState.textContent = "Copy manually from the modal";
        modalCopyState.textContent = "Copy manually from the textarea";
      }
    }
    function render() {
      updateCountState();
      if (candidates.length === 0) {
        list.innerHTML = '<div class="empty">No draft candidates.</div>';
        detail.innerHTML = '<div class="empty">Nothing to review.</div>';
        return;
      }
      const visible = visibleCandidates();
      if (visible.length === 0) {
        list.innerHTML = '<div class="empty">No candidates match the current filters.</div>';
        detail.innerHTML = '<div class="empty">Adjust the candidate filters to continue reviewing.</div>';
        return;
      }
      if (!visible.some((item) => item.candidate_id === selected)) selected = visible[0].candidate_id;
      list.innerHTML = groupCandidates(visible).map((group) =>
        {
          const collapsed = collapsedGroups.has(group.key);
          return '<section class="candidate-group">' +
          '<div class="candidate-group-title" data-group-toggle="' + html(group.key) + '">' +
            '<span class="group-label"><span>' + (collapsed ? "▸" : "▾") + '</span><span class="group-key">' + html(group.label) + '</span><span class="group-count">' + group.items.length + ' items</span></span>' +
            '<span class="group-actions">' +
              '<button class="group-btn" data-group-status="approved" data-group="' + html(group.key) + '">All approved</button>' +
              '<button class="group-btn" data-group-status="rejected" data-group="' + html(group.key) + '">All rejected</button>' +
            '</span>' +
          '</div>' +
          (collapsed ? "" : group.items.map((item) => {
            const active = item.candidate_id === selected ? " active" : "";
            const status = decisions.get(item.candidate_id);
            return '<button class="candidate' + active + '" data-id="' + html(item.candidate_id) + '">' +
              '<div class="candidate-title">' +
                '<span class="candidate-title-text">' + html(item.review.title) + '</span>' +
                '<span class="candidate-tags"><span class="badge">' + html(item.collection || "unknown") + '</span>' + (!item.snapshot_ready ? '<span class="badge warning">evidence unavailable</span>' : '') + statusBadge(status) + '</span>' +
              '</div>' +
              '<div class="candidate-summary">' + html(item.display_summary || item.review.summary) + '</div>' +
            '</button>';
          }).join("")) +
        '</section>';
        }
      ).join("");
      const item = visible.find((candidate) => candidate.candidate_id === selected) ?? visible[0];
      selected = item.candidate_id;
      const status = decisions.get(item.candidate_id);
      const evidenceWarning = item.snapshot_ready ? "" :
        '<div class="notice warning">Evidence unavailable. Restore the committed snapshot before approving this candidate, or reject it.</div>';
      const sharedRefs = new Set(item.shared_source_refs || []);
      const sharedSourceBlock = sharedRefs.size === 0 ? "" :
        '<div class="notice">' + sharedRefs.size + ' 个证据片段也被其他候选使用，请结合上下文确认内容边界。</div>';
      const sectionDetails = (item.sections || []).length === 0 ? "" :
        '<div class="section-list">' + item.sections.map((section) => {
          const mode = section.content_mode || "verbatim";
          const refs = section.source_refs || [];
          const excerpts = section.source_excerpts || [];
          const body = section.body || "(section body unavailable)";
          const evidenceBlock = refs.length === 0 ? "" :
            '<details class="evidence-details">' +
              '<summary>Evidence（' + refs.length + ' 个来源片段）</summary>' +
              '<div class="section-excerpts">' + excerpts.map((excerpt, index) =>
                '<details class="source-excerpt ' + html(excerpt.status || "unavailable") + '">' +
                  '<summary>来源片段 ' + (index + 1) + (excerpt.line_range ? ' · ' + html(excerpt.line_range) : '') + '</summary>' +
                  (excerpt.text ? '<pre>' + html(excerpt.text) + '</pre>' : '<div class="notice warning">' + html(excerpt.message || "Source excerpt unavailable") + '</div>') +
                '</details>'
              ).join('') + '</div>' +
              '<div class="section-source-refs">' + refs.map((ref) => '<code>' + html(ref) + '</code>').join('') + '</div>' +
            '</details>';
          return '<section class="section-card ' + html(mode) + '">' +
            '<div class="section-header">' +
              '<div class="section-title"><code>' + html(section.id) + '</code><span class="badge">' + html(section.kind || "section") + '</span><span class="badge">' + html(mode) + '</span>' +
                (refs.some((ref) => sharedRefs.has(ref)) ? '<span class="badge warning">shared source</span>' : '') +
              '</div>' +
            '</div>' +
            (section.summary ? '<div class="section-summary">' + html(section.summary) + '</div>' : '') +
            '<pre class="section-body">' + html(body) + '</pre>' +
            evidenceBlock +
          '</section>';
        }).join('') + '</div>';
      const previewBlock = (item.sections || []).length === 0
        ? '<pre>' + html(item.preview) + '</pre>'
        : '<details><summary class="subtle">Candidate preview</summary><pre>' + html(item.preview) + '</pre></details>';
      const resourcePreviewBlock = (item.resource_previews || []).length === 0 ? "" :
        '<details class="resource-preview" open><summary>Resources（' + item.resource_previews.length + '）</summary>' +
          '<div class="resource-preview-grid">' + item.resource_previews.map((resource) =>
            '<section class="resource-preview-item">' +
              '<div class="resource-preview-meta"><span class="badge">' + html(resource.kind) + '</span><span class="badge ' + (resource.status === "failed" ? "rejected" : resource.status === "reference-only" ? "warning" : "approved") + '">' + html(resource.status) + '</span></div>' +
              (resource.image && resource.url
                ? '<figure><img src="' + html(resource.url) + '" alt="' + html(resource.label) + '"><figcaption>' + html(resource.label) + '</figcaption></figure>'
                : resource.url
                  ? '<a href="' + html(resource.url) + '" target="_blank" rel="noreferrer">' + html(resource.label) + ' · ' + html(resource.media_type) + '</a>'
                  : '<div class="resource-preview-label">' + html(resource.label) + '</div>') +
              (resource.reason ? '<div class="resource-preview-reason">' + html(resource.reason) + '</div>' : '') +
            '</section>'
          ).join('') + '</div></details>';
      const identityBlock = '<div class="meta identity-meta">' +
        '<span class="badge">' + html(item.collection || "unknown") + '</span>' +
        '<code>candidate_id=' + html(item.candidate_id) + '</code>' +
        '<code>node_ref=' + html(item.node_ref) + '</code>' +
        '<code>view_ref=' + html(item.view_ref) + '</code>' +
      '</div>';
      const technicalDetailsBlock = '<details class="technical-details">' +
        '<summary>Technical details（ID 与 ' + item.source_refs.length + ' 个来源引用）</summary>' +
        '<div class="technical-content">' +
          identityBlock +
          '<div class="section-source-refs">' + item.source_refs.map((ref) => '<code>' + html(ref) + '</code>').join('') + '</div>' +
          (sharedRefs.size === 0 ? "" : '<div class="section-source-refs"><span>Shared source refs</span>' + Array.from(sharedRefs).map((ref) => '<code>' + html(ref) + '</code>').join('') + '</div>') +
        '</div>' +
      '</details>';
      const relatedEdges = item.related_edges || [];
      const relatedEdgesBlock = relatedEdges.length === 0 ? "" :
        '<details class="edge-preview candidate-related-edges" aria-label="candidate related edges">' +
          '<summary class="edge-summary">Related edges（' + relatedEdges.length + ' 个关系）</summary>' +
          '<div class="edge-list">' + relatedEdges.map((edge) =>
            '<div class="edge-row">' +
              '<span class="badge">' + html(edge.type || "unknown") + '</span>' +
              (edge.confidence ? '<span class="badge warning">' + html(edge.confidence) + '</span>' : '') +
              '<span class="edge-endpoint">' + html(edge.fromLabel || "unknown") + '</span>' +
              '<span class="subtle">→</span>' +
              '<span class="edge-endpoint">' + html(edge.toLabel || "unknown") + '</span>' +
              '<span class="subtle">' + String((edge.sourceRefs || []).length) + ' 条证据</span>' +
              (edge.note ? '<span class="edge-note">' + html(edge.note) + '</span>' : '') +
              '<details class="edge-technical"><summary>技术详情</summary>' +
                '<div><code>' + html(edge.from || "unknown") + '</code> → <code>' + html(edge.to || "unknown") + '</code></div>' +
                (edge.sourceRefs || []).map((ref) => '<code>' + html(ref) + '</code>').join('') +
              '</details>' +
            '</div>'
          ).join('') + '</div>' +
        '</details>';
      detail.innerHTML = '<div class="detail-titlebar">' +
          '<div><div class="detail-heading"><h2>' + html(item.review.title) + '</h2>' + typeBadge(item) + '</div><div class="subtle">' + html(item.display_summary || item.review.summary) + '</div></div>' +
          '<div class="actions">' +
            '<button class="btn approve ' + (status === "approved" ? "active" : "") + '" data-action="approved" ' + (!item.snapshot_ready ? "disabled" : "") + '>Approve</button>' +
            '<button class="btn reject ' + (status === "rejected" ? "active" : "") + '" data-action="rejected">Reject</button>' +
          '</div>' +
        '</div>' +
        evidenceWarning +
        relatedEdgesBlock +
        sharedSourceBlock +
        resourcePreviewBlock +
        sectionDetails +
        previewBlock +
        technicalDetailsBlock;
      document.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => { selected = button.dataset.id; render(); }));
      document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => setDecision(item.candidate_id, button.dataset.action)));
      document.querySelectorAll("[data-group-toggle]").forEach((header) => header.addEventListener("click", () => toggleGroup(header.dataset.groupToggle)));
      document.querySelectorAll("[data-group-status]").forEach((button) => button.addEventListener("click", (event) => {
        event.stopPropagation();
        setGroupDecision(button.dataset.group, button.dataset.groupStatus);
      }));
    }
    function effectiveTheme() {
      return document.documentElement.dataset.theme || "light";
    }
    function updateThemeIcon() {
      theme.textContent = effectiveTheme() === "dark" ? "☀️" : "🌙";
    }
    theme.addEventListener("click", () => {
      document.documentElement.dataset.theme = effectiveTheme() === "dark" ? "light" : "dark";
      updateThemeIcon();
    });
    updateThemeIcon();
    allApproved.addEventListener("click", () => setAllDecision("approved"));
    allRejected.addEventListener("click", () => setAllDecision("rejected"));
    filterApproved.addEventListener("change", render);
    filterRejected.addEventListener("change", render);
    filterPending.addEventListener("change", render);
    payloadOpen.addEventListener("click", openPayloadModal);
    payloadClose.addEventListener("click", closePayloadModal);
    payloadCopy.addEventListener("click", copyPayload);
    payloadModal.addEventListener("click", (event) => {
      if (event.target === payloadModal) closePayloadModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !payloadModal.classList.contains("hidden")) closePayloadModal();
    });
    render();
    updatePayloadBox();
  </script>
</body>
</html>
`;
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
  const edgePreview = filterEdgePreviewForCandidates(candidates, await readEdgePreview(input.projectRoot));
  const sourceExcerpts = await collectReviewSourceExcerpts(input.projectRoot, candidates);
  const resourcePreviews = await collectReviewResourcePreviews(input.projectRoot, candidates);
  const outPath = resolveOutputPath(input.projectRoot, input.out, reviewScope);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderReviewHtml(candidates, reviewScope, edgePreview, sourceExcerpts, resourcePreviews), "utf8");
  return {
    path: outPath,
    candidates: candidates.length,
    candidate_set_digest: candidateSetHash(candidates.map(({ record }) => record)),
    structure_digests: [...new Set(candidates
      .map(({ record }) => record.structure_digest)
      .filter((digest): digest is string => digest !== undefined))].sort(),
  };
}
