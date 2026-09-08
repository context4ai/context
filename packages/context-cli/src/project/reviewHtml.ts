import { REVIEW_UI_ZH } from "./reviewHtmlTranslations.js";
import { createReviewCodeCodec } from "./reviewCode.js";
import { renderReviewMarkdown } from "./reviewMarkdown.js";
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
import {
  candidateGroupKey,
  candidateGroupLabel,
  candidatePreview,
} from "./reviewHtmlPresentation.js";
import { REVIEW_HTML_STYLES } from "./reviewHtmlStyles.js";

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
): string {
  const candidateIds = candidates.map(({ record }) => record.candidate_id);
  const visibleCandidateIds = [...candidateIds].sort();
  const scope = {
    kind: reviewScope === "all" ? "all" : "collection",
    ...(reviewScope !== "all" ? { collection: reviewScope } : {}),
    count: visibleCandidateIds.length,
    ids_sha256: candidateIdsHash(visibleCandidateIds),
    candidates_sha256: candidateSetHash(candidates.map(({ record }) => record)),
  };
  const candidateData = candidates.map(({ record, snapshot }) => {
    const sourceByEvidenceRef = new Map(record.indexer_candidate.evidence_bindings.map((binding) => [
      binding.evidence_ref,
      binding.source_ref,
    ]));
    return {
    candidate_id: record.candidate_id,
    collection: record.collection,
    path: record.path,
    node_ref: record.node_ref,
    view_ref: record.view_ref,
    module: record.module,
    status: record.status,
    kind: record.kind,
    visibility: record.visibility,
    source_refs: record.source_refs,
    source_paths: record.indexer_candidate === undefined
      ? []
      : [...new Set(record.indexer_candidate.evidence_bindings.map((binding) =>
          binding.locator.path
        ))].sort(),
    sections: record.indexer_candidate.sections.map((section) => ({
      id: section.section_key,
      kind: record.kind,
      summary: section.section_key,
      body: section.markdown,
      source_refs: [...new Set(section.evidence_refs.flatMap((evidenceRef) => {
        const sourceRef = sourceByEvidenceRef.get(evidenceRef);
        return sourceRef === undefined ? [] : [sourceRef];
      }))].sort(),
      content_mode: "authored",
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
    rendered_markdown: renderReviewMarkdown(record.indexer_candidate.sections.map((section) => section.markdown).join("\n\n"), record.review.title),
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
        <h1 id="review-heading">Context Review</h1>
        <div class="subtle" id="count-state">${candidates.length} draft candidate(s) in ${escapeHtml(reviewScope)} · ${candidates.length} pending 0 approved 0 omitted</div>
      </div>
      <div class="toolbar">
        <span class="bulk-actions">
          <button class="btn" id="all-approved">All approved</button>
          <button class="btn" id="all-rejected">Omit all</button>
        </span>
        <button class="btn brand" id="payload-open">Copy review results</button>
        <button class="btn language-btn" id="language" type="button" aria-label="Switch to Chinese">中文</button>
        <button class="btn icon-btn" id="theme" title="Toggle theme" aria-label="Toggle theme">🌙</button>
      </div>
    </header>
    <section class="layout">
      <aside class="panel candidate-panel">
        <div class="panel-head candidate-head">
          <span id="pages-label">Pages to review</span>
          <div class="filters" id="filters" aria-label="candidate filters">
            <label class="filter"><input id="filter-approved" type="checkbox" checked> <span id="label-approved">approved</span></label>
            <label class="filter"><input id="filter-rejected" type="checkbox" checked> <span id="label-rejected">omitted</span></label>
            <label class="filter"><input id="filter-pending" type="checkbox" checked> <span id="label-pending">pending</span></label>
          </div>
        </div>
        <input id="search" type="search" placeholder="Search pages or modules" aria-label="Search pages or modules">
        <div id="list"></div>
      </aside>
      <section class="panel detail-panel">
        <div class="panel-head reader-navigation"><span id="content-label">Page content</span><div><button class="btn" id="previous-page">Previous</button> <button class="btn" id="next-page">Next</button> <button class="btn" id="next-pending">Next pending</button></div></div>
        <div class="detail" id="detail"></div>
      </section>
    </section>
    <div class="modal hidden" id="payload-modal" role="dialog" aria-modal="true" aria-labelledby="payload-title">
      <section class="modal-card">
        <div>
          <h2 id="payload-title">Review results</h2>
          <div class="subtle" id="code-help">These choices take effect only after you send the review code back to the conversation. Each segment is at most 980 characters. Send every segment before applying.</div>
        </div>
        <div class="modal-body">
          <div id="decision-summary"></div>
          <div class="code-navigation" id="code-navigation" hidden><button class="btn" id="code-previous">Previous segment</button><span id="code-length"></span><button class="btn" id="code-next">Next segment</button></div>
          <textarea id="payload" aria-label="review code" readonly></textarea>
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
    const translations = ${jsonForScript(REVIEW_UI_ZH)};
    let language = /^zh(?:-|$)/i.test(navigator.languages?.[0] || navigator.language || "en") ? "zh-CN" : "en";
    function t(message, values = {}) {
      const text = language === "zh-CN" ? translations[message] || message : message;
      return text.replace(/\\{(\\w+)\\}/g, (_, key) => String(values[key] ?? ""));
    }
    const candidates = ${jsonForScript(candidateData)};
    const payloadScope = ${jsonForScript(scope)};
    const reviewCode = (${createReviewCodeCodec.toString()})();
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
    const modalCopyState = document.getElementById("modal-copy-state");
    const search = document.getElementById("search");
    const decisionSummary = document.getElementById("decision-summary");
    const codeLength = document.getElementById("code-length");
    let codePart = 0;
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
      countState.textContent = t("{count} pages · {scope} · {pending} pending · {approved} approved · {rejected} omitted",
        { count: candidates.length, scope: payloadScopeLabel === "all" ? t("All collections") : payloadScopeLabel, ...counts });
    }
    function visibleCandidates() {
      const showApproved = filterApproved.checked;
      const showRejected = filterRejected.checked;
      const showPending = filterPending.checked;
      const query = search.value.trim().toLowerCase();
      return candidates.filter((item) => {
        if (query && !(item.review.title + " " + item.module + " " + item.source_paths.join(" ")).toLowerCase().includes(query)) return false;
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
      const label = t(status === "rejected" ? "omitted" : status);
      return '<span class="badge ' + html(status) + '">' + html(label) + '</span>';
    }
    function toggleGroup(groupKey) {
      if (collapsedGroups.has(groupKey)) collapsedGroups.delete(groupKey);
      else collapsedGroups.add(groupKey);
      render();
    }
    function setGroupDecision(groupKey, status) {
      const items = candidates.filter((item) => (item.group_key || item.module || "ungrouped") === groupKey);
      if (items.length === 0) return;
      const label = t(status === "rejected" ? "omitted" : status);
      if (!window.confirm(t("Set all {count} pages in {group} to {status}?", { count: items.length, group: groupKey, status: label }))) return;
      for (const item of items) {
        if (status === "approved" && !item.snapshot_ready) continue;
        decisions.set(item.candidate_id, status);
      }
      codePart = 0;
      modalCopyState.textContent = t("Choices changed. Copy the updated code before applying.");
      render();
      updatePayloadBox();
    }
    function setAllDecision(status) {
      if (candidates.length === 0) return;
      const label = t(status === "rejected" ? "omitted" : status);
      if (!window.confirm(t("Set all {count} pages to {status}?", { count: candidates.length, status: label }))) return;
      for (const item of candidates) {
        if (status === "approved" && !item.snapshot_ready) continue;
        decisions.set(item.candidate_id, status);
      }
      codePart = 0;
      modalCopyState.textContent = t("Choices changed. Copy the updated code before applying.");
      render();
      updatePayloadBox();
    }
    function payloadParts() {
      if (decisionCounts().pending || candidates.length === 0) return [];
      const ordered = [...candidates].sort((a, b) => a.candidate_id < b.candidate_id ? -1 : a.candidate_id > b.candidate_id ? 1 : 0);
      return reviewCode.encode(payloadScopeLabel, payloadScope.ids_sha256, payloadScope.candidates_sha256,
        ordered.map((item) => decisions.get(item.candidate_id)));
    }
    function payloadText() { return payloadParts()[codePart] || t("Resolve all pending pages before copying."); }
    function setDecision(id, status) {
      const item = candidates.find((candidate) => candidate.candidate_id === id);
      if (status === "approved" && item && !item.snapshot_ready) return;
      decisions.set(id, status);
      codePart = 0;
      modalCopyState.textContent = t("Choices changed. Copy the updated code before applying.");
      render();
      updatePayloadBox();
    }
    function updatePayloadBox() {
      const parts = payloadParts();
      codePart = Math.min(codePart, Math.max(0, parts.length - 1));
      payloadBox.value = payloadText();
      document.getElementById("code-navigation").hidden = parts.length <= 1;
      codeLength.textContent = parts.length ? t("Segment {part}/{total} · {length}/980 characters", { part: codePart + 1, total: parts.length, length: payloadBox.value.length }) : t("No review code yet");
      document.getElementById("code-previous").disabled = codePart === 0;
      document.getElementById("code-next").disabled = codePart + 1 >= parts.length;
      const counts = decisionCounts();
      const ready = counts.pending === 0 && candidates.length > 0;
      decisionSummary.innerHTML = '<p>' + html(t('{approved} approved · {rejected} not included · {pending} pending', counts)) + '</p>' +
        (counts.rejected ? '<details><summary>' + html(t('Pages not included')) + '</summary><ul>' + candidates.filter((item) => decisions.get(item.candidate_id) === "rejected").map((item) => '<li>' + html(item.review.title) + '</li>').join('') + '</ul></details>' : '');
      payloadCopy.disabled = !ready;
      payloadOpen.classList.toggle("ready", ready);
      payloadOpen.title = ready
        ? t("Open review results")
        : t("{count} pending pages remain", { count: counts.pending });
    }
    function openPayloadModal() {
      updatePayloadBox();
      payloadModal.classList.remove("hidden");
      payloadBox.focus();
      payloadBox.select();
      modalCopyState.textContent = "";
    }
    function closePayloadModal() {
      payloadModal.classList.add("hidden");
    }
    async function copyPayload() {
      const counts = decisionCounts();
      if (counts.pending > 0) {
        updatePayloadBox();
        const message = t("Resolve all pending pages before copying.");
        modalCopyState.textContent = message;
        return;
      }
      const text = payloadText();
      payloadBox.value = text;
      try {
        if (!navigator.clipboard) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(text);
        modalCopyState.textContent = t("Copied");
      } catch {
        payloadBox.focus();
        payloadBox.select();
        modalCopyState.textContent = t("Copy manually from the textarea");
      }
    }
    function render() {
      updateCountState();
      if (candidates.length === 0) {
        list.innerHTML = '<div class="empty">' + html(t('No draft candidates.')) + '</div>';
        detail.innerHTML = '<div class="empty">' + html(t('Nothing to review.')) + '</div>';
        return;
      }
      const visible = visibleCandidates();
      if (visible.length === 0) {
        list.innerHTML = '<div class="empty">' + html(t('No candidates match the current filters.')) + '</div>';
        detail.innerHTML = '<div class="empty">' + html(t('Adjust the candidate filters to continue reviewing.')) + '</div>';
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
              '<button class="group-btn" data-group-status="approved" data-group="' + html(group.key) + '">' + html(t('All approved')) + '</button>' +
              '<button class="group-btn" data-group-status="rejected" data-group="' + html(group.key) + '">' + html(t('Omit all')) + '</button>' +
            '</span>' +
          '</div>' +
          (collapsed ? "" : group.items.map((item) => {
            const active = item.candidate_id === selected ? " active" : "";
            const status = decisions.get(item.candidate_id);
            return '<button class="candidate' + active + '" data-id="' + html(item.candidate_id) + '">' +
              '<div class="candidate-title">' +
                '<span class="candidate-title-text">' + html(item.review.title) + '</span>' +
                '<span class="candidate-tags"><span class="badge">' + html(item.collection || "unknown") + '</span>' + (!item.snapshot_ready ? '<span class="badge warning">' + html(t('evidence unavailable')) + '</span>' : '') + statusBadge(status) + '</span>' +
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
        '<div class="notice warning">' + html(t('Source snapshot unavailable. Restore it before approving this candidate, or omit the page.')) + '</div>';
      const sectionDetails = '<article class="reader-body">' + item.rendered_markdown + '</article>';
      const previewBlock = '<details class="technical-details"><summary>' + html(t('Source Markdown')) + '</summary><pre>' +
        html(item.sections.map((section) => section.body).join("\\n\\n")) + '</pre></details>';
      const displayedSources = [...new Set([...item.source_paths, ...item.source_refs, ...item.sections.flatMap((section) => section.source_refs)])];
      const sourceLocationsBlock = displayedSources.length === 0 ? "" :
        '<details class="technical-details">' +
          '<summary>' + html(t('Source locations')) + '（' + displayedSources.length + '）</summary>' +
          '<div class="technical-content"><div class="section-source-refs">' +
            displayedSources.map((ref) => '<code>' + html(ref) + '</code>').join('') +
          '</div></div>' +
        '</details>';
      detail.innerHTML = '<div class="detail-titlebar">' +
          '<div class="page-location">' + html(item.path) + '</div>' +
          '<div class="actions">' +
            '<button class="btn approve ' + (status === "approved" ? "active" : "") + '" data-action="approved" ' + (!item.snapshot_ready ? "disabled" : "") + '>' + html(t('Approve')) + '</button>' +
            '<button class="btn reject ' + (status === "rejected" ? "active" : "") + '" data-action="rejected">' + html(t('Omit')) + '</button>' +
          '</div>' +
        '</div>' +
        evidenceWarning +
        sectionDetails +
        previewBlock +
        '<p class="repair-hint">' + html(t('Need changes? Leave this batch unapplied and ask the agent to repair this page.')) + '</p>' +
        sourceLocationsBlock;
      document.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => { selected = button.dataset.id; render(); }));
      document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => setDecision(item.candidate_id, button.dataset.action)));
      document.querySelectorAll("[data-group-toggle]").forEach((header) => header.addEventListener("click", () => toggleGroup(header.dataset.groupToggle)));
      document.querySelectorAll("[data-group-status]").forEach((button) => button.addEventListener("click", (event) => {
        event.stopPropagation();
        setGroupDecision(button.dataset.group, button.dataset.groupStatus);
      }));
    }
    function navigatePage(direction, pendingOnly = false) {
      const items = visibleCandidates();
      const current = items.findIndex((item) => item.candidate_id === selected);
      for (let step = 1; step <= items.length; step++) {
        const item = items[(current + direction * step + items.length * 2) % items.length];
        if (!pendingOnly || decisions.get(item.candidate_id) === "pending") { selected = item.candidate_id; render(); detail.scrollTop = 0; return; }
      }
    }
    search.addEventListener("input", render);
    document.getElementById("previous-page").addEventListener("click", () => navigatePage(-1));
    document.getElementById("next-page").addEventListener("click", () => navigatePage(1));
    document.getElementById("next-pending").addEventListener("click", () => navigatePage(1, true));
    document.getElementById("code-previous").addEventListener("click", () => { codePart = Math.max(0, codePart - 1); updatePayloadBox(); });
    document.getElementById("code-next").addEventListener("click", () => { codePart++; updatePayloadBox(); });
    function applyLanguage() {
      document.documentElement.lang = language;
      document.title = t("Context Review") + " - " + payloadScopeLabel;
      const labels = {
        "review-heading": "Context Review", "all-approved": "All approved", "all-rejected": "Omit all",
        "payload-open": "Copy review results", "pages-label": "Pages to review", "label-approved": "approved",
        "label-rejected": "omitted", "label-pending": "pending", "content-label": "Page content",
        "previous-page": "Previous", "next-page": "Next", "next-pending": "Next pending",
        "payload-title": "Review results", "code-previous": "Previous segment", "code-next": "Next segment",
        "payload-close": "Close", "payload-copy": "Copy",
        "code-help": "These choices take effect only after you send the review code back to the conversation. Each segment is at most 980 characters. Send every segment before applying.",
      };
      for (const [id, message] of Object.entries(labels)) document.getElementById(id).textContent = t(message);
      search.placeholder = t("Search pages or modules");
      search.setAttribute("aria-label", t("Search pages or modules"));
      document.getElementById("filters").setAttribute("aria-label", t("candidate filters"));
      payloadBox.setAttribute("aria-label", t("review code"));
      theme.title = t("Toggle theme");
      theme.setAttribute("aria-label", t("Toggle theme"));
      const button = document.getElementById("language");
      button.textContent = language === "zh-CN" ? "English" : "中文";
      button.setAttribute("aria-label", language === "zh-CN" ? "Switch to English" : "切换为中文");
      modalCopyState.textContent = "";
      const scrollTop = detail.scrollTop;
      render();
      detail.scrollTop = scrollTop;
      updatePayloadBox();
    }
    function toggleLanguage() {
      language = language === "zh-CN" ? "en" : "zh-CN";
      applyLanguage();
    }
    document.getElementById("language").addEventListener("click", toggleLanguage);
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
    applyLanguage();
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
  const outPath = resolveOutputPath(input.projectRoot, input.out, reviewScope);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderReviewHtml(candidates, reviewScope), "utf8");
  return {
    path: outPath,
    candidates: candidates.length,
    candidate_set_digest: candidateSetHash(candidates.map(({ record }) => record)),
    structure_digests: [...new Set(candidates
      .map(({ record }) => record.structure_digest)
      .filter((digest): digest is string => digest !== undefined))].sort(),
  };
}
