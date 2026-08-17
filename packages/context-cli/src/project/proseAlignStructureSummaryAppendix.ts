import type { StructureSummary } from "./proseAlignStructureSummary.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function label(en: string, zh: string): string {
  return `<span class="i18n en">${escapeHtml(en)}</span><span class="i18n zh">${escapeHtml(zh)}</span>`;
}

const ROW_CAP = 200;

function moreRow(total: number, colspan: number): string {
  if (total <= ROW_CAP) return "";
  return `<tr><td class="muted" colspan="${colspan}">${label(
    `… ${total - ROW_CAP} more rows hidden (of ${total})`,
    `… 另有 ${total - ROW_CAP} 行未展示（共 ${total} 行）`,
  )}</td></tr>`;
}

function refList(refs: readonly string[]): string {
  if (refs.length === 0) return label("None", "无");
  const shown = refs.slice(0, ROW_CAP).map((ref) => copyableCode(ref)).join("<br>");
  if (refs.length <= ROW_CAP) return shown;
  return `${shown}<br><span class="muted">${label(`… ${refs.length - ROW_CAP} more`, `… 另有 ${refs.length - ROW_CAP} 个`)}</span>`;
}

function shorten(value: string, head = 36, tail = 18): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function copyableCode(value: string): string {
  return `<code class="copy-code" role="button" tabindex="0" title="${escapeHtml(value)}" data-copy="${escapeHtml(value)}">${escapeHtml(shorten(value))}</code>`;
}

function sourceDocument(sourceRef: string): string {
  const head = sourceRef.split("#span:")[0] ?? sourceRef;
  const slashIndex = head.indexOf("/");
  return slashIndex < 0 ? head : head.slice(slashIndex + 1);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function distributionRows(items: Record<string, number>): string {
  const entries = Object.entries(items).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return `<tr><td class="muted" colspan="2">${label("None", "无")}</td></tr>`;
  return entries.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td class="num">${value}</td></tr>`).join("");
}

function sourceCoverageRows(summary: StructureSummary): string {
  const coverage = new Map<string, { pages: Set<string>; sections: number; refs: number }>();
  for (const view of summary.views) {
    for (const section of view.sections) {
      const documents = unique(section.source_refs.map((ref) => sourceDocument(ref)));
      for (const ref of section.source_refs) {
        const document = sourceDocument(ref);
        const entry = coverage.get(document) ?? { pages: new Set<string>(), sections: 0, refs: 0 };
        entry.pages.add(view.title);
        entry.refs += 1;
        coverage.set(document, entry);
      }
      for (const document of documents) {
        const entry = coverage.get(document) ?? { pages: new Set<string>(), sections: 0, refs: 0 };
        entry.sections += 1;
        coverage.set(document, entry);
      }
    }
  }
  const documents = Object.keys(summary.distributions.source_documents).sort();
  if (documents.length === 0) return "";
  return `
    <table>
      <thead><tr><th>${label("Source document", "来源文档")}</th><th>${label("Pages", "页面")}</th><th>${label("Sections", "章节")}</th><th>${label("Refs", "引用")}</th></tr></thead>
      <tbody>${documents.slice(0, ROW_CAP).map((document) => {
        const entry = coverage.get(document) ?? { pages: new Set<string>(), sections: 0, refs: 0 };
        return `<tr><td>${escapeHtml(document)}</td><td class="num">${entry.pages.size}</td><td class="num">${entry.sections}</td><td class="num">${entry.refs}</td></tr>`;
      }).join("")}${moreRow(documents.length, 4)}</tbody>
    </table>
  `;
}

function refMappingTable(summary: StructureSummary): string {
  return `
    <table>
      <thead><tr><th>${label("Title", "标题")}</th><th>ViewRef</th><th>NodeRef</th><th>${label("Approved path", "批准路径")}</th></tr></thead>
      <tbody>${summary.views.slice(0, ROW_CAP).map((view) => `
        <tr>
          <td>${escapeHtml(view.title)}</td>
          <td>${copyableCode(view.view_ref)}</td>
          <td>${copyableCode(view.node_ref)}</td>
          <td>${copyableCode(view.path)}</td>
        </tr>
      `).join("")}${moreRow(summary.views.length, 4)}</tbody>
    </table>
  `;
}

function sectionDetails(summary: StructureSummary): string {
  const views = summary.views.slice(0, ROW_CAP);
  const more = summary.views.length > ROW_CAP
    ? `<p class="muted">${label(`… ${summary.views.length - ROW_CAP} more pages hidden (of ${summary.views.length})`, `… 另有 ${summary.views.length - ROW_CAP} 个页面未展示（共 ${summary.views.length} 个）`)}</p>`
    : "";
  return `${views.map((view) => `
    <details class="sub-detail">
      <summary>${escapeHtml(view.title)} · ${label(`${view.sections.length} sections`, `${view.sections.length} 个章节`)}</summary>
      <table>
        <thead><tr><th>SectionRef</th><th>${label("Kind", "类型")}</th><th>${label("Summary", "摘要")}</th><th>${label("Refs", "引用")}</th></tr></thead>
        <tbody>${view.sections.length === 0
          ? `<tr><td class="muted" colspan="4">${label("No source-bound sections.", "没有绑定来源的章节。")}</td></tr>`
          : view.sections.slice(0, ROW_CAP).map((section) => `
            <tr>
              <td>${copyableCode(section.section_ref)}</td>
              <td>${escapeHtml(section.kind)}</td>
              <td>${escapeHtml(section.summary ?? section.ownership ?? "")}</td>
              <td class="num">${section.source_ref_count}</td>
            </tr>
          `).join("") + moreRow(view.sections.length, 4)}
        </tbody>
      </table>
    </details>
  `).join("")}${more}`;
}

function rawEdges(summary: StructureSummary): string {
  if (summary.edges.length === 0) return "";
  return `
    <table>
      <thead><tr><th>${label("Type", "类型")}</th><th>${label("From", "从")}</th><th>${label("To", "到")}</th><th>${label("Source refs", "来源引用")}</th></tr></thead>
      <tbody>${summary.edges.slice(0, ROW_CAP).map((edge) => `
        <tr>
          <td>${escapeHtml(edge.type)}</td>
          <td>${copyableCode(edge.from)}</td>
          <td>${copyableCode(edge.to)}</td>
          <td>${refList(edge.source_refs)}</td>
        </tr>
      `).join("")}${moreRow(summary.edges.length, 4)}</tbody>
    </table>
  `;
}

function sharedRefs(summary: StructureSummary): string {
  if (summary.shared_source_refs.length === 0) return "";
  return `
    <table>
      <thead><tr><th>${label("Source ref", "来源引用")}</th><th>${label("Owners", "使用位置")}</th></tr></thead>
      <tbody>${summary.shared_source_refs.slice(0, ROW_CAP).map((item) => `
        <tr>
          <td>${copyableCode(item.source_ref)}</td>
          <td>${refList(item.owners)}</td>
        </tr>
      `).join("")}${moreRow(summary.shared_source_refs.length, 2)}</tbody>
    </table>
  `;
}

function existingApproved(summary: StructureSummary): string {
  const existing = summary.existing_approved_structure;
  if (!existing.present) return "";
  return `
    <div class="mini-stats">
      <span>${label("Nodes", "节点")} ${existing.counts.nodes}</span>
      <span>${label("Views", "视图")} ${existing.counts.views}</span>
      <span>${label("Sections", "章节")} ${existing.counts.sections}</span>
      <span>${label("Edges", "关系")} ${existing.counts.edges}</span>
    </div>
    <table>
      <thead><tr><th>${label("Category", "类别")}</th><th>${label("Refs", "引用")}</th></tr></thead>
      <tbody>
        <tr><td>NodeRefs</td><td>${refList(existing.reusable.node_refs)}</td></tr>
        <tr><td>ViewRefs</td><td>${refList(existing.reusable.view_refs)}</td></tr>
        <tr><td>SectionRefs</td><td>${refList(existing.reusable.section_refs)}</td></tr>
      </tbody>
    </table>
    ${existing.duplicate_or_unresolved.length === 0 ? "" : `
      <h4>${label("Duplicate or unresolved prompts", "重复或未解决提示")}</h4>
      <table>
        <thead><tr><th>${label("Kind", "类别")}</th><th>${label("Planned", "计划")}</th><th>${label("Approved", "已批准")}</th><th>${label("Reason", "原因")}</th></tr></thead>
        <tbody>${existing.duplicate_or_unresolved.slice(0, ROW_CAP).map((item) => `
          <tr>
            <td>${escapeHtml(item.kind)}</td>
            <td>${copyableCode(item.planned_ref)}</td>
            <td>${item.approved_ref === undefined ? label("None", "无") : copyableCode(item.approved_ref)}</td>
            <td>${escapeHtml(item.reason)}</td>
          </tr>
        `).join("")}${moreRow(existing.duplicate_or_unresolved.length, 4)}</tbody>
      </table>
    `}
  `;
}

function detailBlock(title: string, body: string): string {
  if (body.trim().length === 0) return "";
  return `<details class="detail-block"><summary>${title}</summary>${body}</details>`;
}

export function machineAppendix(summary: StructureSummary): string {
  const distributions = `
    <div class="appendix-grid">
      <table><caption>${label("Node types", "节点类型")}</caption><tbody>${distributionRows(summary.distributions.node_types)}</tbody></table>
      <table><caption>${label("Collections", "集合")}</caption><tbody>${distributionRows(summary.distributions.collections)}</tbody></table>
      <table><caption>${label("Section kinds", "章节类型")}</caption><tbody>${distributionRows(summary.distributions.section_kinds)}</tbody></table>
      <table><caption>${label("Edge types", "关系类型")}</caption><tbody>${distributionRows(summary.distributions.edge_types)}</tbody></table>
    </div>
  `;
  return `
    <details class="panel appendix" id="machine-appendix">
      <summary>${label("Machine Appendix", "机器附录")}</summary>
      <p class="muted">${label("Raw refs and audit details are folded here for troubleshooting.", "原始引用和排查信息默认折叠在这里。")}</p>
      ${detailBlock(label("Ref mapping", "引用映射"), refMappingTable(summary))}
      ${detailBlock(label("Section details", "章节明细"), sectionDetails(summary))}
      ${detailBlock(label("Raw edge refs", "原始关系引用"), rawEdges(summary))}
      ${detailBlock(label("Distributions", "分布统计"), distributions)}
      ${detailBlock(label("Source coverage", "来源覆盖"), sourceCoverageRows(summary))}
      ${detailBlock(label("Shared source refs", "共用来源引用"), sharedRefs(summary))}
      ${detailBlock(label("Existing approved structure", "已有批准结构"), existingApproved(summary))}
      ${detailBlock(label("Structure digest", "结构摘要"), `<p>${copyableCode(summary.structure_digest)}</p>`)}
    </details>
  `;
}
