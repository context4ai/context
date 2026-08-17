import type { AlignDiagnostic } from "./proseAlignTypes.js";
import type { StructureSummary } from "./proseAlignStructureSummary.js";
import { machineAppendix } from "./proseAlignStructureSummaryAppendix.js";
import { attentionSection, splitRequiredViews } from "./proseAlignStructureSummaryAttention.js";
import { escapeHtml, label } from "./proseAlignStructureSummaryMarkup.js";
import { structureSummaryStyles } from "./proseAlignStructureSummaryStyles.js";

type SummaryView = StructureSummary["views"][number];

type EndpointLookup = {
  endpointTitle: (endpoint: string) => string;
  viewForEndpoint: (endpoint: string | undefined) => SummaryView | undefined;
};

type TreeNode = {
  view: SummaryView;
  children: TreeNode[];
};

function preferredLanguage(): "en" | "zh" {
  const locale = [
    process.env.CONTEXT_REPORT_LANG,
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
  ].filter((item): item is string => item !== undefined).join(" ").toLowerCase();
  return locale.includes("zh") ? "zh" : "en";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function sourceDocument(sourceRef: string): string {
  const head = sourceRef.split("#span:")[0] ?? sourceRef;
  const slashIndex = head.indexOf("/");
  return slashIndex < 0 ? head : head.slice(slashIndex + 1);
}

function sourceDocumentsForView(view: SummaryView): string[] {
  return unique(view.sections.flatMap((section) => section.source_refs.map((ref) => sourceDocument(ref))));
}


function flagLabel(code: string): string {
  switch (code) {
    case "node.term_expanded_beyond_definition":
      return label("term expanded", "术语超范围");
    case "node.description_dominates":
      return label("description-heavy", "描述型偏多");
    case "node.thin_concrete_entity":
      return label("thin entity", "内容单薄");
    case "node.children_should_be_sections":
      return label("over-split children", "子页面过碎");
    case "tags.child_inherits_system":
      return label("scope tag inherited", "继承范围标签");
    default:
      return escapeHtml(code);
  }
}

function badge(value: string, tone = ""): string {
  return `<span class="badge ${tone}">${escapeHtml(value)}</span>`;
}

function nodeTags(summary: StructureSummary, view: SummaryView): string[] {
  return summary.nodes.find((node) => node.node_ref === view.node_ref)?.tags ?? view.tags;
}

function nodeIdentityBadges(summary: StructureSummary, view: SummaryView): string {
  return [view.node_type, ...nodeTags(summary, view)].map((value, index) => badge(value, index === 0 ? "kind" : "")).join("");
}

function sectionKindBadges(view: SummaryView): string {
  const kinds = unique(view.sections.map((section) => section.kind));
  const visibleKinds = kinds.slice(0, 3).map((kind) => badge(kind, "kind"));
  const hiddenCount = kinds.length - visibleKinds.length;
  return hiddenCount > 0
    ? `${visibleKinds.join("")}${badge(`+${hiddenCount}`, "more")}`
    : visibleKinds.join("");
}

function buildEndpointLookup(summary: StructureSummary): EndpointLookup {
  const titles = new Map<string, string>();
  const views = new Map<string, SummaryView>();
  for (const node of summary.nodes) {
    titles.set(node.node_ref, node.title);
  }
  for (const view of summary.views) {
    titles.set(view.node_ref, view.title);
    titles.set(view.view_ref, view.title);
    views.set(view.node_ref, view);
    views.set(view.view_ref, view);
    for (const section of view.sections) {
      titles.set(section.section_ref, `${view.title} / ${section.id}`);
      views.set(section.section_ref, view);
    }
  }
  return {
    endpointTitle(endpoint: string): string {
      return titles.get(endpoint) ?? endpoint;
    },
    viewForEndpoint(endpoint: string | undefined): SummaryView | undefined {
      if (endpoint === undefined) return undefined;
      if (views.has(endpoint)) return views.get(endpoint);
      const sectionPrefix = endpoint.includes("#") ? endpoint.slice(0, endpoint.indexOf("#")) : endpoint;
      return views.get(sectionPrefix);
    },
  };
}

function diagnosticsForView(view: SummaryView, diagnostics: readonly AlignDiagnostic[]): AlignDiagnostic[] {
  const aliases = new Set([
    view.node_ref,
    view.view_ref,
    ...view.sections.map((section) => section.section_ref),
  ]);
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.candidate_id !== undefined && aliases.has(diagnostic.candidate_id)) return true;
    if (diagnostic.source_ref !== undefined && view.sections.some((section) => section.source_refs.includes(diagnostic.source_ref ?? ""))) return true;
    if (diagnostic.field === undefined) return false;
    return view.sections.some((section) => diagnostic.field?.includes(section.id) === true);
  });
}

function diagnosticsByViewCode(summary: StructureSummary, diagnostics: readonly AlignDiagnostic[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const view of summary.views) {
    const codes = unique(diagnosticsForView(view, diagnostics).map((diagnostic) => diagnostic.code));
    if (codes.length > 0) result.set(view.view_ref, codes);
  }
  return result;
}

function nonContainmentEdges<T extends { type: string }>(edges: readonly T[]): T[] {
  return edges.filter((edge) => edge.type !== "contains");
}

function hasBlockers(summary: StructureSummary, diagnostics: readonly AlignDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error") || splitRequiredViews(summary).length > 0;
}

function softAttention(summary: StructureSummary, diagnostics: readonly AlignDiagnostic[]): boolean {
  if (hasBlockers(summary, diagnostics)) return false;
  return summary.counts.diagnostics.warnings > 0 || summary.counts.unresolved > 0;
}

function judgementLine(summary: StructureSummary, diagnostics: readonly AlignDiagnostic[]): string {
  const blocked = hasBlockers(summary, diagnostics);
  return blocked
    ? label("Not ready to confirm — resolve the blocking issues above first.", "暂不能确认：上面有阻塞问题，需先处理。")
    : softAttention(summary, diagnostics)
      ? label("Ready to confirm — take a quick look at the flagged items above first.", "可以确认；建议先看一眼上面的待办项。")
      : label("Ready to confirm — nothing needs handling.", "可以确认，没有需要处理的问题。");
}


function parentNodeRef(nodeRef: string, knownRefs: ReadonlySet<string>): string | undefined {
  const parts = nodeRef.split("/");
  while (parts.length > 1) {
    parts.pop();
    const candidate = parts.join("/");
    if (knownRefs.has(candidate)) return candidate;
  }
  return undefined;
}

function endpointViewRefs(view: SummaryView): string[] {
  return [
    view.view_ref,
    view.node_ref,
    ...view.sections.map((section) => section.section_ref),
  ];
}

function containsParentByViewRef(
  views: readonly SummaryView[],
  edges: readonly StructureSummary["edges"][number][],
): Map<string, string> {
  const endpointToViewRef = new Map<string, string>();
  for (const view of views) {
    for (const endpoint of endpointViewRefs(view)) endpointToViewRef.set(endpoint, view.view_ref);
  }
  const parentByChild = new Map<string, string>();
  for (const edge of edges) {
    if (edge.type !== "contains") continue;
    const parentViewRef = endpointToViewRef.get(edge.from);
    const childViewRef = endpointToViewRef.get(edge.to);
    if (parentViewRef === undefined || childViewRef === undefined || parentViewRef === childViewRef) continue;
    parentByChild.set(childViewRef, parentViewRef);
  }
  return parentByChild;
}

function buildTree(views: readonly SummaryView[], edges: readonly StructureSummary["edges"][number][]): TreeNode[] {
  const byViewRef = new Map<string, TreeNode>();
  const byNodeRef = new Map<string, TreeNode>();
  for (const view of views) {
    const node = { view, children: [] };
    byViewRef.set(view.view_ref, node);
    byNodeRef.set(view.node_ref, node);
  }
  const roots: TreeNode[] = [];
  const knownRefs = new Set(byNodeRef.keys());
  const containsParent = containsParentByViewRef(views, edges);
  for (const node of byViewRef.values()) {
    const containsParentRef = containsParent.get(node.view.view_ref);
    const pathParentRef = parentNodeRef(node.view.node_ref, knownRefs);
    const parent = containsParentRef === undefined
      ? (pathParentRef === undefined ? undefined : byNodeRef.get(pathParentRef))
      : byViewRef.get(containsParentRef);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  const sortNodes = (items: TreeNode[]): TreeNode[] => {
    items.sort((left, right) => left.view.title.localeCompare(right.view.title));
    for (const item of items) sortNodes(item.children);
    return items;
  };
  return sortNodes(roots);
}

const COLLECTION_FOLD_THRESHOLD = 100;
const TREE_RENDER_CAP = 300;

function renderTreeNodes(summary: StructureSummary, nodes: readonly TreeNode[], budget: { remaining: number }): string {
  const items: string[] = [];
  for (const node of nodes) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1;
    const children = node.children.length === 0 || budget.remaining <= 0
      ? ""
      : renderTreeNodes(summary, node.children, budget);
    items.push(`
        <li>
          <div class="tree-node">
            <span class="node-title">${escapeHtml(node.view.title)}</span>
            <span class="node-badges">${nodeIdentityBadges(summary, node.view)}</span>
          </div>
          ${children}
        </li>
      `);
  }
  return `<ul class="tree">${items.join("")}</ul>`;
}

function structureSection(summary: StructureSummary, lookup: EndpointLookup): string {
  const groups = summary.views_by_collection.map((group) => {
    const tree = buildTree(group.views, summary.edges);
    const isOpen = group.view_count <= COLLECTION_FOLD_THRESHOLD;
    const budget = { remaining: TREE_RENDER_CAP };
    const treeHtml = tree.length === 0
      ? `<p class="muted">${label("No pages.", "没有页面。")}</p>`
      : renderTreeNodes(summary, tree, budget);
    const hidden = group.view_count - TREE_RENDER_CAP;
    const moreNote = hidden > 0
      ? `<p class="muted tree-more">${label(`… ${hidden} more pages not expanded; see the machine appendix for full data.`, `… 另有 ${hidden} 个页面未展开；完整数据见机器附录。`)}</p>`
      : "";
    return `
      <details class="collection"${isOpen ? " open" : ""}>
        <summary>
          <span class="collection-name">${escapeHtml(group.collection)}</span>
          <span class="count-pill">${label(`${group.view_count} pages`, `${group.view_count} 个页面`)}</span>
        </summary>
        <div class="collection-body">
          ${treeHtml}
          ${moreNote}
        </div>
      </details>
    `;
  }).join("");
  const relations = nonContainmentEdges(summary.edges);
  const containmentCount = summary.edges.length - relations.length;
  const relationHtml = relations.length === 0
    ? `<p class="muted">${label("No depends_on, verified_by, supersedes, or other non-hierarchical relationships were planned.", "未规划 depends_on、verified_by、supersedes 等非层级关系。")}</p>`
    : `<div class="relation-list">${relations.map((edge) => `
        <article class="relation">
          <span>${escapeHtml(lookup.endpointTitle(edge.from))}</span>
          <strong>-${escapeHtml(edge.type)}-></strong>
          <span>${escapeHtml(lookup.endpointTitle(edge.to))}</span>
          ${edge.confidence === undefined ? "" : badge(edge.confidence)}
        </article>
      `).join("")}</div>`;
  return `
    <section class="panel" id="structure">
      <div class="section-title-row">
        <h2>${label("Structure", "结构")}</h2>
        <span class="count-pill">${label(`${containmentCount} containment / ${relations.length} typed`, `${containmentCount} 个包含 / ${relations.length} 条类型关系`)}</span>
      </div>
      <div class="structure-tree">
        <div class="subsection-title-row">
          <h3>${label("Containment Tree", "结构树")}</h3>
          <span class="count-pill">${label(`${containmentCount} containment`, `${containmentCount} 个包含`)}</span>
        </div>
        ${groups}
      </div>
      <div class="typed-relations${relations.length === 0 ? " empty" : ""}">
        <div class="subsection-title-row">
          <h3>${label("Other Relationships", "其他关系")}</h3>
          <span class="count-pill">${label(`${relations.length} typed`, `${relations.length} 条类型关系`)}</span>
        </div>
        ${relationHtml}
      </div>
    </section>
  `;
}

function pagePlanSection(summary: StructureSummary, diagnostics: readonly AlignDiagnostic[]): string {
  const diagnosticCodes = diagnosticsByViewCode(summary, diagnostics);
  const views = [...summary.views].sort((left, right) => left.path.localeCompare(right.path));
  return `
    <section class="panel" id="page-plan">
      <div class="section-title-row">
        <h2>${label("Page Plan", "页面计划")}</h2>
        <span class="count-pill">${label(`${views.length} pages`, `${views.length} 个页面`)}</span>
      </div>
      <div class="page-grid">
        ${views.map((view) => {
          const sourceDocs = sourceDocumentsForView(view);
          const pathFile = view.path.split("/").pop() ?? view.path;
          const distinctiveSources = sourceDocs.filter((doc) => (doc.split("/").pop() ?? doc) !== pathFile);
          const relationCount = nonContainmentEdges(view.connected_edges).length;
          const flags = [
            view.split_requirement.status === "split_required" ? label("split required", "需要拆分") : undefined,
            view.unresolved.length > 0 ? label(`${view.unresolved.length} deferred`, `${view.unresolved.length} 个保留项`) : undefined,
            ...(diagnosticCodes.get(view.view_ref) ?? []).map(flagLabel),
          ].filter((item): item is string => item !== undefined);
          const sourceHtml = sourceDocs.length === 0
            ? `<p class="page-status">${view.section_count === 0
                ? label("No source-bound sections", "无来源章节")
                : label("No source document", "无正文来源")}</p>`
            : distinctiveSources.length === 0
              ? ""
              : `<p class="sources"><span class="src-label">${label("From", "来源")}</span>${distinctiveSources.map((doc) => `<span>${escapeHtml(doc)}</span>`).join("")}</p>`;
          return `
            <article class="page-card">
              <div class="page-main">
                <h3>${escapeHtml(view.title)} <span class="node-badges">${sectionKindBadges(view)}</span></h3>
                <p class="path-line">${escapeHtml(view.path)}</p>
                ${sourceHtml}
              </div>
              <div class="page-side">
                <span><strong>${view.section_count}</strong>${label("sections", "章节")}</span>
                ${relationCount > 0 ? `<span><strong>${relationCount}</strong>${label("relations", "关系")}</span>` : ""}
                ${view.unresolved.length > 0 ? `<span><strong>${view.unresolved.length}</strong>${label("deferred", "保留")}</span>` : ""}
              </div>
              ${flags.length === 0 ? "" : `<div class="page-flags">${flags.map((flag) => `<a class="flag" href="#attention">${flag}</a>`).join("")}</div>`}
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function headerStats(summary: StructureSummary): string {
  const typedEdges = nonContainmentEdges(summary.edges);
  const containmentEdges = summary.edges.length - typedEdges.length;
  return `
    <div class="stats">
      <span><strong>${summary.counts.nodes}</strong>${label("nodes", "节点")}</span>
      <span><strong>${summary.counts.views}</strong>${label("pages", "页面")}</span>
      <span><strong>${summary.counts.sections}</strong>${label("sections", "章节")}</span>
      <span><strong>${containmentEdges}</strong>${label("containment", "包含")}</span>
      <span><strong>${typedEdges.length}</strong>${label("typed edges", "类型关系")}</span>
      <span><strong>${summary.counts.unresolved}</strong>${label("deferred", "保留")}</span>
      <span><strong>${summary.counts.diagnostics.warnings}</strong>${label("warnings", "警告")}</span>
      <span><strong>${summary.counts.diagnostics.errors}</strong>${label("errors", "错误")}</span>
    </div>
  `;
}

export function renderStructureSummaryHtml(input: {
  summary: StructureSummary;
  diagnostics: readonly AlignDiagnostic[];
}): string {
  const { summary } = input;
  const title = `Structure Summary - ${summary.source.type}:${summary.source.name}`;
  const language = preferredLanguage();
  const lookup = buildEndpointLookup(summary);
  const blocked = hasBlockers(summary, input.diagnostics);
  const attention = softAttention(summary, input.diagnostics);
  const judgementBorder = blocked ? "rgba(220,38,38,.32)" : attention ? "rgba(217,119,6,.32)" : "rgba(5,150,105,.32)";
  const judgementBg = blocked ? "var(--danger-bg)" : attention ? "var(--warn-bg)" : "var(--ok-bg)";
  const judgementColor = blocked ? "var(--danger)" : attention ? "var(--warn)" : "var(--ok)";
  return `<!doctype html>
<html lang="${language}" data-lang="${language}" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${structureSummaryStyles({
    judgementBorder,
    judgementBg,
    judgementColor,
  })}</style>
</head>
<body>
<main>
  <header class="hero">
    <div class="hero-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="judgement">${judgementLine(summary, input.diagnostics)}</p>
      </div>
      <button class="theme-toggle" id="theme" type="button" title="${label("Toggle theme", "切换主题")}" aria-label="${label("Toggle theme", "切换主题")}">🌙</button>
    </div>
    ${headerStats(summary)}
  </header>
  ${attentionSection(summary, input.diagnostics, lookup)}
  ${structureSection(summary, lookup)}
  ${pagePlanSection(summary, input.diagnostics)}
  <section class="panel">
    <h2>${label("After Confirmation", "确认后会发生什么")}</h2>
    <div class="explain">
      <div class="explain-row"><span class="k">${label("Confirm", "满意就确认")}</span><span class="v">${label("Reply \u201cconfirm\u201d in the chat and the agent creates review drafts for these pages \u2014 you can still review the real content before anything is approved.", "在对话窗口回复\u201c确认\u201d，Agent 会为这些页面生成待审草稿；正式入库前你还能先审阅真实内容。")}</span></div>
      <div class="explain-row"><span class="k">${label("Adjust", "想调整")}</span><span class="v">${label("Not ready? Don't confirm yet \u2014 copy this summary to the agent, tell it what to change, discuss until you're happy, then reply \u201cconfirm\u201d.", "还没想好就先别确认——把这份说明复制给 Agent，告诉它要改什么，一起调整到满意，再回复\u201c确认\u201d。")}</span></div>
      <div class="explain-row"><span class="k">${label("Deferred", "保留项")}</span><span class="v">${label("Deferred items stay out of approved relationships until you ask for a revised structure.", "保留项不会进入正式关系，除非你要求修改结构。")}</span></div>
    </div>
  </section>
  ${machineAppendix(summary)}
</main>
<script>
  (() => {
    const browserLanguage = navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
    document.documentElement.dataset.lang = browserLanguage;
    const theme = document.getElementById("theme");
    const effectiveTheme = () => document.documentElement.dataset.theme || "light";
    const updateThemeIcon = () => {
      theme.textContent = effectiveTheme() === "dark" ? "☀️" : "🌙";
    };
    theme.addEventListener("click", () => {
      document.documentElement.dataset.theme = effectiveTheme() === "dark" ? "light" : "dark";
      updateThemeIcon();
    });
    updateThemeIcon();
    const copy = async (target) => {
      const value = target.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(value);
        target.setAttribute("data-copied", "true");
        setTimeout(() => target.removeAttribute("data-copied"), 1200);
      } catch {
        target.setAttribute("data-copy-failed", "true");
        setTimeout(() => target.removeAttribute("data-copy-failed"), 1200);
      }
    };
    for (const target of document.querySelectorAll("[data-copy]")) {
      target.addEventListener("click", () => copy(target));
      target.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        copy(target);
      });
    }
  })();
</script>
</body>
</html>
`;
}
