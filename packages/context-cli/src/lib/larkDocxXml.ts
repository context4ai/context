import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import {
  FidelityTracker,
  LARK_EMPTY_SUB_PAGE_LIST_CODE,
  type LarkCaptureFidelityReport,
} from "./larkCaptureFidelity.js";
import {
  isTransientLarkMediaUrl,
  registerLarkResource,
  renderLarkBookmark,
  renderLarkResource,
  renderLarkSubPage,
  renderLarkSyncedReference,
  type LarkExternalResource,
  type LarkResourceRenderContext,
  type LarkResourceXmlNode,
} from "./larkDocxResources.js";

export type { LarkExternalResource } from "./larkDocxResources.js";

export {
  LARK_EMPTY_SUB_PAGE_LIST_CODE,
  type LarkCaptureFidelityIssue,
  type LarkCaptureFidelityReport,
  type LarkCaptureFidelitySeverity,
} from "./larkCaptureFidelity.js";

export interface LarkDocxProjection {
  markdown: string;
  title?: string;
  auditXml: string;
  rawContentHash: string;
  resources: LarkExternalResource[];
  fidelity: LarkCaptureFidelityReport;
}

type OrderedXmlNode = LarkResourceXmlNode;

interface RenderContext extends LarkResourceRenderContext {
  tracker: FidelityTracker;
  mode: "block" | "inline" | "code";
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  allowBooleanAttributes: true,
});

const PRESENTATION_ONLY_ATTRIBUTES = new Set([
  "id",
  "style",
  "background-color",
  "border-color",
  "text-color",
  "width",
  "height",
  "origin-width",
  "origin-height",
  "scale",
  "view-type",
]);

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function elementName(node: OrderedXmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text");
}

function elementChildren(node: OrderedXmlNode, name: string): OrderedXmlNode[] {
  const value = node[name];
  return Array.isArray(value) ? value as OrderedXmlNode[] : [];
}

function attributes(node: OrderedXmlNode): Record<string, string> {
  const attrs = node[":@"];
  if (attrs === undefined || attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) return {};
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, String(value)]));
}

function textContent(nodes: readonly OrderedXmlNode[]): string {
  return nodes.map((node) => {
    if (typeof node["#text"] === "string") return node["#text"];
    const name = elementName(node);
    return name === undefined ? "" : textContent(elementChildren(node, name));
  }).join("");
}

function normalizeInline(value: string): string {
  return value.replace(/[ \t\r\n]+/gu, " ").trim();
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/gu, "\\$1");
}

function safeFence(value: string, language = ""): string {
  const longest = Math.max(3, ...[...value.matchAll(/`+/gu)].map((match) => match[0].length + 1));
  const fence = "`".repeat(longest);
  return `${fence}${language}\n${value.trim()}\n${fence}`;
}

function renderChildren(nodes: readonly OrderedXmlNode[], ctx: RenderContext): string {
  return nodes.map((node) => renderNode(node, ctx)).join("");
}

function renderList(nodes: readonly OrderedXmlNode[], ctx: RenderContext, ordered: boolean): string {
  const items = nodes.filter((node) => elementName(node) === "li");
  return items.map((item, index) => {
    const name = elementName(item)!;
    ctx.tracker.discover(name);
    ctx.tracker.convert(name);
    const body = normalizeMarkdown(renderChildren(elementChildren(item, name), { ...ctx, mode: "inline" }));
    const marker = ordered ? `${index + 1}.` : "-";
    return body.split("\n").map((line, lineIndex) => lineIndex === 0 ? `${marker} ${line}` : `  ${line}`).join("\n");
  }).join("\n");
}

function renderTable(nodes: readonly OrderedXmlNode[], ctx: RenderContext): string {
  const rows: string[][] = [];
  const visit = (children: readonly OrderedXmlNode[]): void => {
    for (const node of children) {
      const name = elementName(node);
      if (name === undefined) continue;
      const childNodes = elementChildren(node, name);
      if (name === "tr" || name === "table_row" || name === "table-row") {
        ctx.tracker.discover(name);
        ctx.tracker.convert(name);
        const cells: string[] = [];
        for (const cell of childNodes) {
          const cellName = elementName(cell);
          if (cellName === undefined) continue;
          if (cellName !== "th" && cellName !== "td" && cellName !== "table_cell" && cellName !== "table-cell") {
            renderNode(cell, ctx);
            continue;
          }
          ctx.tracker.discover(cellName);
          ctx.tracker.convert(cellName);
          const content = normalizeMarkdown(renderChildren(elementChildren(cell, cellName), { ...ctx, mode: "inline" }));
          cells.push(content.replace(/\n/gu, "<br>").replace(/\|/gu, "\\|"));
        }
        rows.push(cells);
      } else if (["thead", "tbody", "tfoot"].includes(name)) {
        ctx.tracker.discover(name);
        ctx.tracker.convert(name);
        visit(childNodes);
      } else {
        renderNode(node, ctx);
      }
    }
  };
  visit(nodes);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
  const header = normalized[0] ?? [];
  return [header, header.map(() => "---"), ...normalized.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function renderSubPageList(nodes: readonly OrderedXmlNode[], ctx: RenderContext): string {
  if (!nodes.some((node) => elementName(node) === "sub-page")) {
    ctx.tracker.flag(
      "sub-page-list",
      "sub-page-list returned no sub-page entries; child navigation completeness cannot be verified",
      "error",
      LARK_EMPTY_SUB_PAGE_LIST_CODE,
    );
  }
  const lines: string[] = [];
  for (const node of nodes) {
    const name = elementName(node);
    if (name === undefined) continue;
    const rendered = normalizeMarkdown(renderNode(node, { ...ctx, mode: "inline" }));
    if (rendered.length === 0) continue;
    lines.push(name === "sub-page" ? `- ${rendered}` : rendered);
  }
  return lines.length === 0 ? "" : `\n\n${lines.join("\n")}\n\n`;
}

function renderChecklistItem(
  blockType: "checkbox" | "todo",
  nodes: readonly OrderedXmlNode[],
  attrs: Record<string, string>,
  ctx: RenderContext,
): string {
  const done = attrs.done;
  const checked = attrs.checked;
  const state = done ?? checked;
  const stateIsValid = (state === "true" || state === "false") &&
    (done === undefined || checked === undefined || done === checked);
  const body = normalizeInline(renderChildren(nodes, { ...ctx, mode: "inline" }));
  if (!stateIsValid) {
    ctx.tracker.flag(
      blockType,
      `${blockType} requires one unambiguous boolean done or checked attribute`,
      "warning",
      "lark.capture.checkbox-state-invalid",
      "projection",
    );
    return `\n- [?] ${body}\n`;
  }
  return `\n- [${state === "true" ? "x" : " "}] ${body}\n`;
}

function meaningfulAttributes(
  attrs: Record<string, string>,
  excluded: ReadonlySet<string>,
): Array<[string, string]> {
  return Object.entries(attrs)
    .filter(([key, value]) => value.length > 0 && !PRESENTATION_ONLY_ATTRIBUTES.has(key) && !excluded.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
}

function auditableAttributes(attrs: Record<string, string>): Array<[string, string]> {
  return Object.entries(attrs)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => [key, isTransientLarkMediaUrl(value) ? "[redacted-transient-url]" : value] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
}

function renderPollOption(
  blockType: string,
  nodes: readonly OrderedXmlNode[],
  attrs: Record<string, string>,
  ctx: RenderContext,
): string {
  const body = normalizeInline(renderChildren(nodes, { ...ctx, mode: "inline" }));
  const label = body || attrs.name || attrs.title || attrs.label || attrs.value;
  const details = meaningfulAttributes(attrs, new Set(["name", "title", "label", "value"]))
    .map(([key, value]) => `${key}=${value}`);
  if (label === undefined && details.length === 0) {
    ctx.tracker.flag(
      blockType,
      `${blockType} has no visible label or metadata`,
      "warning",
      "lark.capture.poll-option-empty",
      "projection",
    );
  }
  const rendered = [label ?? "Unnamed option", ...(details.length > 0 ? [`(${details.join(", ")})`] : [])].join(" ");
  return `\n- ${rendered}\n`;
}

function renderPoll(nodes: readonly OrderedXmlNode[], attrs: Record<string, string>, ctx: RenderContext): string {
  const title = attrs.name ?? attrs.title ?? "Untitled poll";
  const resource = registerLarkResource(ctx, "poll", "poll", attrs, title);
  const href = attrs.href ?? attrs.url;
  const label = href !== undefined && !isTransientLarkMediaUrl(href)
    ? `[${escapeMarkdownLabel(title)}](${href})`
    : escapeMarkdownLabel(title);
  const details = meaningfulAttributes(attrs, new Set(["name", "title", "href", "url"]))
    .map(([key, value]) => `${key}=${value}`);
  const children = normalizeMarkdown(renderChildren(nodes, { ...ctx, mode: "block" }));
  resource.inline_content = children.length > 0;
  const lines = [
    `> Lark poll (non-interactive): ${label} <!-- ${resource.locator} -->`,
    ...(details.length > 0 ? [`> Exported attributes: ${details.join(", ")}`] : []),
    ...(children.length === 0
      ? ["> Options and results are not present in the exported XML."]
      : [children]),
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}

function renderUnknown(name: string, nodes: readonly OrderedXmlNode[], attrs: Record<string, string>, ctx: RenderContext): string {
  const body = normalizeMarkdown(renderChildren(nodes, ctx));
  const exportedAttrs = auditableAttributes(attrs);
  if (body.length === 0 && exportedAttrs.length === 0) {
    ctx.tracker.skip(name, "unknown empty block omitted", "warning");
    return "";
  }
  ctx.tracker.convert(name);
  ctx.tracker.flag(
    name,
    "block was preserved through the generic non-interactive projection; inspect source.xml for the original structure",
    "warning",
    "lark.capture.generic-projection",
    "projection",
  );
  const digest = createHash("sha256")
    .update(JSON.stringify({ name, attributes: exportedAttrs, text: normalizeInline(textContent(nodes)) }), "utf8")
    .digest("hex")
    .slice(0, 12);
  const locator = `lark:block:${name}:${digest}`;
  ctx.resources.push({
    kind: "embed",
    locator,
    title: name,
    attributes: Object.fromEntries(exportedAttrs),
  });
  const lines = [
    `> Lark block (generic projection): \`${name}\` <!-- ${locator} -->`,
    ...(exportedAttrs.length > 0
      ? [`> Exported attributes: ${JSON.stringify(Object.fromEntries(exportedAttrs))}`]
      : []),
    ...(body.length > 0 ? [body] : []),
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}

function renderNode(node: OrderedXmlNode, ctx: RenderContext): string {
  if (typeof node["#text"] === "string") return node["#text"];
  const name = elementName(node);
  if (name === undefined) return "";
  const nodes = elementChildren(node, name);
  const attrs = attributes(node);
  ctx.tracker.discover(name);

  if (["cite", "img", "image", "source", "file", "attachment", "whiteboard", "diagram", "base_refer", "bitable", "sheet", "chat_card", "readonly-block"].includes(name)) {
    ctx.tracker.convert(name);
    return renderLarkResource(name, nodes, attrs, ctx);
  }
  if (name === "sub-page") {
    ctx.tracker.convert(name);
    return renderLarkSubPage(nodes, attrs, ctx);
  }
  if (name === "sub-page-list") {
    ctx.tracker.convert(name);
    return renderSubPageList(nodes, ctx);
  }
  if (name === "bookmark") {
    ctx.tracker.convert(name);
    return renderLarkBookmark(nodes, attrs, ctx);
  }
  if (name === "synced_reference") {
    ctx.tracker.convert(name);
    return renderLarkSyncedReference(attrs, ctx);
  }
  if (name === "title" || /^h[1-9]$/u.test(name) || name === "heading") {
    ctx.tracker.convert(name);
    const level = name === "title" ? 1 : name === "heading" ? Number(attrs.level ?? 2) : Number(name.slice(1));
    return `\n\n${"#".repeat(Math.min(Math.max(level, 1), 6))} ${normalizeInline(renderChildren(nodes, { ...ctx, mode: "inline" }))}\n\n`;
  }
  if (["p", "paragraph", "div", "section"].includes(name)) {
    ctx.tracker.convert(name);
    const body = renderChildren(nodes, { ...ctx, mode: "inline" });
    return ctx.mode === "inline" ? body : `\n\n${body}\n\n`;
  }
  if (["span", "mark", "u", "sub", "sup", "label"].includes(name)) {
    ctx.tracker.convert(name);
    return renderChildren(nodes, { ...ctx, mode: "inline" });
  }
  if (name === "b" || name === "strong") {
    ctx.tracker.convert(name);
    return `**${renderChildren(nodes, { ...ctx, mode: "inline" })}**`;
  }
  if (name === "i" || name === "em") {
    ctx.tracker.convert(name);
    return `*${renderChildren(nodes, { ...ctx, mode: "inline" })}*`;
  }
  if (name === "s" || name === "del" || name === "strike") {
    ctx.tracker.convert(name);
    return `~~${renderChildren(nodes, { ...ctx, mode: "inline" })}~~`;
  }
  if (name === "a") {
    ctx.tracker.convert(name);
    const label = normalizeInline(renderChildren(nodes, { ...ctx, mode: "inline" })) || attrs.href || "Link";
    return attrs.href === undefined || isTransientLarkMediaUrl(attrs.href)
      ? label
      : `[${escapeMarkdownLabel(label)}](${attrs.href})`;
  }
  if (name === "br") {
    ctx.tracker.convert(name);
    return "\n";
  }
  if (name === "hr") {
    ctx.tracker.convert(name);
    return "\n\n---\n\n";
  }
  if (name === "code") {
    ctx.tracker.convert(name);
    const body = renderChildren(nodes, { ...ctx, mode: "code" });
    return ctx.mode === "code" ? body : `\`${body.replace(/`/gu, "\\`")}\``;
  }
  if (name === "pre") {
    ctx.tracker.convert(name);
    return `\n\n${safeFence(renderChildren(nodes, { ...ctx, mode: "code" }), attrs.lang ?? attrs.language ?? "")}\n\n`;
  }
  if (["latex", "math", "equation"].includes(name)) {
    const expression = normalizeInline(textContent(nodes)) || attrs.value || attrs.latex || attrs.expression;
    if (expression === undefined || expression.trim().length === 0) {
      ctx.tracker.skip(name, `${name} has no formula payload`, "error");
      return "";
    }
    ctx.tracker.convert(name);
    return ctx.mode === "inline" ? `$${expression.trim()}$` : `\n\n$$\n${expression.trim()}\n$$\n\n`;
  }
  if (name === "ul" || name === "ol") {
    ctx.tracker.convert(name);
    return `\n\n${renderList(nodes, ctx, name === "ol")}\n\n`;
  }
  if (name === "li") {
    ctx.tracker.convert(name);
    return renderChildren(nodes, { ...ctx, mode: "inline" });
  }
  if (name === "table") {
    ctx.tracker.convert(name);
    return `\n\n${renderTable(nodes, ctx)}\n\n`;
  }
  if (["thead", "tbody", "tfoot", "tr", "th", "td", "table_row", "table-row", "table_cell", "table-cell"].includes(name)) {
    ctx.tracker.convert(name);
    return renderChildren(nodes, ctx);
  }
  if (name === "callout" || name === "blockquote" || name === "quote") {
    ctx.tracker.convert(name);
    const prefix = attrs.emoji === undefined ? "" : `${attrs.emoji} `;
    const body = normalizeMarkdown(renderChildren(nodes, { ...ctx, mode: "block" }));
    return `\n\n${body.split("\n").map((line, index) => `> ${index === 0 ? prefix : ""}${line}`).join("\n")}\n\n`;
  }
  if (["figure", "grid", "column", "columns", "container", "synced-source", "colgroup"].includes(name)) {
    ctx.tracker.convert(name);
    return renderChildren(nodes, { ...ctx, mode: "block" });
  }
  if (name === "col") {
    ctx.tracker.convert(name);
    return "";
  }
  if (name === "checkbox" || name === "todo") {
    ctx.tracker.convert(name);
    return renderChecklistItem(name, nodes, attrs, ctx);
  }
  if (name === "poll") {
    if (nodes.length === 0 && Object.keys(attrs).length === 0) {
      ctx.tracker.skip(name, "empty poll omitted because the export contains no identity or content", "warning");
      return "";
    }
    ctx.tracker.convert(name);
    return renderPoll(nodes, attrs, ctx);
  }
  if (["option", "poll-option", "poll_option", "choice"].includes(name)) {
    ctx.tracker.convert(name);
    return renderPollOption(name, nodes, attrs, ctx);
  }
  if (["mention", "person", "emoji"].includes(name)) {
    ctx.tracker.convert(name);
    return normalizeInline(renderChildren(nodes, { ...ctx, mode: "inline" })) || attrs.name || attrs.text || "";
  }
  return renderUnknown(name, nodes, attrs, ctx);
}

function sanitizeAuditXml(xml: string): string {
  return xml.replace(/\b(href|url)=(['"])(.*?)\2/giu, (match, key: string, quote: string, value: string) =>
    isTransientLarkMediaUrl(value) ? `${key}=${quote}[redacted-transient-url]${quote}` : match
  );
}

export function projectLarkDocxXml(input: { xml: string; sourceUrl: string }): LarkDocxProjection {
  const rawContentHash = sha256(input.xml);
  const withoutDeclaration = input.xml.replace(/^\s*<\?xml[\s\S]*?\?>\s*/u, "");
  const parsed = parser.parse(`<context-root>${withoutDeclaration}</context-root>`) as OrderedXmlNode[];
  const root = parsed.find((node) => elementName(node) === "context-root");
  if (root === undefined) throw new TypeError("Lark Docx XML has no parseable document root");
  const rootChildren = elementChildren(root, "context-root");
  const tracker = new FidelityTracker();
  const resources: LarkExternalResource[] = [];
  const markdown = normalizeMarkdown(renderChildren(rootChildren, {
    sourceUrl: input.sourceUrl,
    tracker,
    resources,
    mode: "block",
  }));
  const titleNode = rootChildren.find((node) => elementName(node) === "title");
  const title = titleNode === undefined ? undefined : normalizeInline(textContent(elementChildren(titleNode, "title")));
  return {
    markdown,
    ...(title !== undefined && title.length > 0 ? { title } : {}),
    auditXml: sanitizeAuditXml(input.xml),
    rawContentHash,
    resources,
    fidelity: tracker.report(),
  };
}

function findBlockById(nodes: readonly OrderedXmlNode[], blockId: string): OrderedXmlNode | undefined {
  for (const node of nodes) {
    const name = elementName(node);
    if (name === undefined) continue;
    const attrs = attributes(node);
    if (attrs.id === blockId || attrs["block-id"] === blockId) return node;
    const nested = findBlockById(elementChildren(node, name), blockId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function projectLarkDocxXmlBlock(input: {
  xml: string;
  sourceUrl: string;
  blockId: string;
}): Pick<LarkDocxProjection, "markdown" | "resources" | "fidelity"> {
  const withoutDeclaration = input.xml.replace(/^\s*<\?xml[\s\S]*?\?>\s*/u, "");
  const parsed = parser.parse(`<context-root>${withoutDeclaration}</context-root>`) as OrderedXmlNode[];
  const root = parsed.find((node) => elementName(node) === "context-root");
  if (root === undefined) throw new TypeError("Lark Docx XML has no parseable document root");
  const block = findBlockById(elementChildren(root, "context-root"), input.blockId);
  if (block === undefined) throw new TypeError(`Lark synced block is missing: ${input.blockId}`);
  const tracker = new FidelityTracker();
  const resources: LarkExternalResource[] = [];
  return {
    markdown: normalizeMarkdown(renderChildren([block], {
      sourceUrl: input.sourceUrl,
      tracker,
      resources,
      mode: "block",
    })),
    resources,
    fidelity: tracker.report(),
  };
}
