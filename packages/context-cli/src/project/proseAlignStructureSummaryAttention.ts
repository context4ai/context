import type { AlignDiagnostic } from "./proseAlignTypes.js";
import type { StructureSummary } from "./proseAlignStructureSummary.js";
import { escapeHtml, label } from "./proseAlignStructureSummaryMarkup.js";

type SummaryView = StructureSummary["views"][number];

type EndpointLookup = {
  endpointTitle: (endpoint: string) => string;
  viewForEndpoint: (endpoint: string | undefined) => SummaryView | undefined;
};

function sourceDocument(sourceRef: string): string {
  const head = sourceRef.split("#span:")[0] ?? sourceRef;
  const slashIndex = head.indexOf("/");
  return slashIndex < 0 ? head : head.slice(slashIndex + 1);
}
function diagnosticClass(severity: string): string {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warn";
  return "info";
}

type Explanation = {
  title: string;
  problem: string;
  impact: string;
  action: string;
};

function diagnosticExplanation(diagnostic: AlignDiagnostic): Explanation {
  switch (diagnostic.code) {
    case "node.term_expanded_beyond_definition":
      return {
        title: label("This term page carries too much", "这个术语页装了太多内容"),
        problem: label(
          "This page is meant to explain a term in a sentence or two, but it now holds rules, designs, or step-by-step procedures.",
          "这个页面本来只该用一两句话解释一个术语，现在却塞进了规则、设计或操作步骤。",
        ),
        impact: label(
          "As a standalone page it has little search value and can overlap with the real page that owns those details.",
          "作为独立页面检索价值不高，还容易和真正拥有这些内容的页面重复。",
        ),
        action: label(
          "Confirm it really needs its own page; if it is just a definition, merge it and move the rules/designs/steps back to the page that owns them.",
          "确认它是否真的要单独成页；如果只是名词解释，就并入所属页面，把规则/设计/步骤放回真正拥有它的页面。",
        ),
      };
    case "node.description_dominates":
      return {
        title: label("This page is mostly loose description", "这个页面几乎全是泛泛描述"),
        problem: label(
          "More than half of this page is generic 'description' text, with few concrete section types such as steps, rules, or interfaces.",
          "这个页面一多半是泛泛的“描述”内容，缺少步骤、规则、接口这类更具体的章节类型。",
        ),
        impact: label(
          "The page reads as a vague overview, so both people and AI have trouble finding anything actionable.",
          "页面读起来很笼统，人和 AI 都不好从里面找到可直接用的信息。",
        ),
        action: label(
          "Confirm it is meant to be an overview; otherwise split the text into clearer section types.",
          "确认它就是一个概览型页面；否则把这些描述拆成更明确的章节类型。",
        ),
      };
    case "node.thin_concrete_entity":
      return {
        title: label("This page is too thin to stand alone", "这个页面太单薄，撑不起独立成页"),
        problem: label(
          "This is a concrete thing, but right now it holds too little content to justify its own page.",
          "这是一个具体的东西，但目前内容太少，撑不起一个独立页面。",
        ),
        impact: label(
          "A thin standalone page mostly adds noise and is rarely worth surfacing on its own.",
          "单薄的独立页面基本只是增加噪音，很难有单独出现的价值。",
        ),
        action: label(
          "Keep it only if it truly has standalone value; otherwise fold it into its parent page.",
          "只有它确实有单独查阅价值时才保留，否则并进上级页面。",
        ),
      };
    case "node.children_should_be_sections":
      return {
        title: label("Child pages look over-split", "子页面可能被拆得太碎"),
        problem: label(
          "Several same-source child pages are thin and have no obvious standalone shape tag.",
          "多个同源子页面都比较薄，并且没有明显的独立形态标签。",
        ),
        impact: label(
          "The approved knowledge may become a scattered index instead of one useful page with sections.",
          "正式知识可能变成零散索引，而不是一个有用的章节化页面。",
        ),
        action: label(
          "Merge them back as sections unless you really need each child as a separately searchable page.",
          "除非确实需要每个子项都能独立检索，否则并回父页面作为章节。",
        ),
      };
    case "tags.child_inherits_system":
      return {
        title: label("Child page repeats parent scope tag", "子页面重复了父级范围标签"),
        problem: label(
          "A child entity carries the same system/application scope tag as its parent.",
          "子实体带了和父实体相同的 system/application 范围标签。",
        ),
        impact: label(
          "A local aspect can be mistaken for an independent system or application.",
          "局部切面可能会被误认为独立系统或应用。",
        ),
        action: label(
          "Retag it by its own shape/scope, or keep it as a section under the parent.",
          "按它自身的形态/范围重新打标签，或并回父页面作为章节。",
        ),
      };
    default:
      return {
        title: escapeHtml(diagnostic.message),
        problem: escapeHtml(diagnostic.message),
        impact: label(
          "This item is flagged for a quick review before you confirm.",
          "这一项在你确认前需要快速复核一下。",
        ),
        action: diagnostic.severity === "error"
          ? label("Fix it before confirming.", "确认前必须先修复。")
          : label("Accept the warning, or ask the agent to revise the structure.", "可以接受这个提醒，或让 Agent 调整结构。"),
      };
  }
}

function humanizeIssue(issue: string): string {
  const words = issue.replace(/[_-]+/g, " ").trim();
  return words.length === 0 ? issue : words.charAt(0).toUpperCase() + words.slice(1);
}

// `unresolved[].issue` is free-form text authored by the align agent, so match by
// keyword rather than exact codes and always fall back to a friendly, generic message.
function unresolvedExplanation(issue: string): Explanation {
  const key = issue.toLowerCase();
  const isRelationTarget = /out[_-]?of[_-]?(batch|scope)|external[_-]?relation|relation[_-]?target|out[_-]?of[_-]?batch/.test(key);
  const isPlaceholder = /placeholder|tbd|incomplete|unfinished|no[_-]?content|empty[_-]?source/.test(key);
  if (isRelationTarget) {
    return {
      title: label("Links point outside this batch", "关联指向了本批之外"),
      problem: label(
        "The document links to other systems/documents whose targets are outside this batch or have no confirmed page yet.",
        "文档提到和其他系统/文档有关联，但那些目标不在本批范围内，或还没有已确认的对应页面。",
      ),
      impact: label(
        "Those cross-document links are not created for now, so nothing points at something that does not exist yet.",
        "这些跨文档关联暂时不会建立，避免连到还不存在的东西。",
      ),
      action: label(
        "Only if you need these links: expand the scope to include those targets. Otherwise leave them parked.",
        "只有当你需要这些关联时，才把处理范围扩大到包含那些目标；否则保持挂起即可。",
      ),
    };
  }
  if (isPlaceholder) {
    return {
      title: label("Source is still a placeholder", "来源还只是占位/未完成"),
      problem: label(
        "The source here is a placeholder or unfinished (like 'no detailed content yet' or 'TBD'), with no real text to cite.",
        "来源这部分只是占位或没写完（比如“暂无详细内容”“TBD”），没有可以引用的正文。",
      ),
      impact: label(
        "Nothing is made up — it stays parked until real source content exists.",
        "系统不会凭空编内容，先挂起，等以后有真实来源再处理。",
      ),
      action: label(
        "Only if you need this content: complete the source then include it. Otherwise leave it parked.",
        "只有当你需要这部分内容时，才把来源补齐后再纳入；否则保持挂起即可。",
      ),
    };
  }
  return {
    title: humanizeIssue(issue),
    problem: label(
      "This item was parked and not turned into an approved node or relationship this round.",
      "这一项被挂起，本轮没有落成正式节点或关系。",
    ),
    impact: label(
      "It does not block confirmation; it simply stays out of approved relationships for now.",
      "它不影响确认，只是暂时不进入正式关系。",
    ),
    action: label(
      "Handle it only if you need it: defer, remove, or correct it.",
      "只有当你需要它时才处理：先挂起、删除，或修正它。",
    ),
  };
}

function diagnosticTarget(diagnostic: AlignDiagnostic, lookup: EndpointLookup): string {
  const view = lookup.viewForEndpoint(diagnostic.candidate_id);
  if (view !== undefined) return view.title;
  if (diagnostic.source_ref !== undefined) return sourceDocument(diagnostic.source_ref);
  return diagnostic.candidate_id ?? diagnostic.field ?? "Structure";
}

type DiagnosticGroup = {
  severity: string;
  representative: AlignDiagnostic;
  targets: string[];
};

function groupDiagnostics(diagnostics: readonly AlignDiagnostic[], lookup: EndpointLookup): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}|${diagnostic.code}|${diagnostic.message}`;
    const target = diagnosticTarget(diagnostic, lookup);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { severity: diagnostic.severity, representative: diagnostic, targets: [target] });
    } else if (!existing.targets.includes(target)) {
      existing.targets.push(target);
    }
  }
  return [...groups.values()];
}

type UnresolvedGroup = { issue: string; count: number; notes: string[] };

function groupUnresolved(items: readonly StructureSummary["unresolved"][number][]): UnresolvedGroup[] {
  const groups = new Map<string, UnresolvedGroup>();
  for (const item of items) {
    const existing = groups.get(item.issue) ?? { issue: item.issue, count: 0, notes: [] };
    existing.count += 1;
    if (item.note !== undefined && item.note.length > 0) existing.notes.push(item.note);
    groups.set(item.issue, existing);
  }
  return [...groups.values()];
}

export function splitRecommendedViews(summary: StructureSummary): SummaryView[] {
  return summary.views.filter((view) => view.split_recommendation.status === "split_recommended");
}

function explainBody(exp: Explanation): string {
  return `
    <div class="explain">
      <div class="explain-row"><span class="k">${label("Problem", "问题")}</span><span class="v">${exp.problem}</span></div>
      <div class="explain-row"><span class="k">${label("Impact", "影响")}</span><span class="v">${exp.impact}</span></div>
      <div class="explain-row"><span class="k">${label("To do", "怎么做")}</span><span class="v">${exp.action}</span></div>
    </div>
  `;
}

export function attentionSection(
  summary: StructureSummary,
  diagnostics: readonly AlignDiagnostic[],
  lookup: EndpointLookup,
): string {
  const visibleDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning");
  const splits = splitRecommendedViews(summary);
  const hasAttention = visibleDiagnostics.length > 0 || summary.unresolved.length > 0 || splits.length > 0;
  if (!hasAttention) {
    return `
      <section class="panel attention ok">
        <h2>${label("Attention", "需要关注")}</h2>
        <p>${label("✓ No errors, warnings, deferred items, or split recommendations.", "✓ 没有错误、警告、保留项或拆分建议。")}</p>
      </section>
    `;
  }
  const diagnosticGroups = groupDiagnostics(visibleDiagnostics, lookup);
  const diagnosticsHtml = diagnosticGroups.length === 0 ? "" : `
    <div class="attention-group">
      <h3>${label("Diagnostics", "诊断")}</h3>
      <div class="attention-group-body">
        ${diagnosticGroups.map((group) => {
          const exp = diagnosticExplanation(group.representative);
          const pages = group.targets.length > 1
            ? `${label(`Pages involved (${group.targets.length})`, `涉及页面（${group.targets.length} 个）`)}：${escapeHtml(group.targets.join("、"))}`
            : `${label("Page", "页面")}：${escapeHtml(group.targets[0] ?? "")}`;
          return `
            <article class="attention-item ${diagnosticClass(group.severity)}">
              <strong>${exp.title}</strong>
              ${explainBody(exp)}
              <p class="attention-detail">${pages}</p>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
  const unresolvedHtml = summary.unresolved.length === 0 ? "" : `
    <div class="attention-group">
      <h3>${label("Deferred Items", "保留项")}</h3>
      <p class="attention-note">${label(
        "These were intentionally parked and do not block confirmation — handle them only if you need those relations or content.",
        "以下项目是本轮有意挂起的，不影响你确认；只有当你确实需要这些关联或内容时才处理。",
      )}</p>
      <div class="attention-group-body">
        ${groupUnresolved(summary.unresolved).map((group) => {
          const exp = unresolvedExplanation(group.issue);
          const heading = group.count > 1 ? `${exp.title}${label(` (${group.count})`, `（${group.count} 项）`)}` : exp.title;
          const notesHtml = group.notes.length === 0 ? "" : `
              <ul class="attention-notes">
                ${group.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
              </ul>
          `;
          return `
            <article class="attention-item warn">
              <strong>${heading}</strong>
              ${explainBody(exp)}
              ${notesHtml}
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
  const splitHtml = splits.length === 0 ? "" : `
    <div class="attention-group">
      <h3>${label("Split Recommended", "建议拆分")}</h3>
      <div class="attention-group-body">
        ${splits.map((view) => {
          const exp: Explanation = {
            title: escapeHtml(view.title),
            problem: escapeHtml(view.split_recommendation.reason),
            impact: label("A smaller page set may be easier to navigate, but the current View remains valid.", "拆成更小的页面可能更易导航，但当前 View 仍然有效。"),
            action: label("Split only when the evidence supports separate pages.", "仅在证据适合独立成页时拆分。"),
          };
          return `
            <article class="attention-item warn">
              <strong>${exp.title}</strong>
              ${explainBody(exp)}
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
  return `
    <section class="panel attention" id="attention">
      <h2>${label("Attention", "需要关注")}</h2>
      ${diagnosticsHtml}
      ${unresolvedHtml}
      ${splitHtml}
    </section>
  `;
}
