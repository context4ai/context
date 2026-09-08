import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  title?: string;
  alt?: string;
  identifier?: string;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  children?: MarkdownNode[];
}
export function escapeReviewHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}
function safeLink(value: string): string | undefined {
  const trimmed = value.trim();
  if (/[\u0000-\u0020\u007f\\]/u.test(trimmed) || trimmed.startsWith("//")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) && !/^https?:|^mailto:/iu.test(trimmed)) return undefined;
  return trimmed;
}
/** Render an allowlist from parsed Markdown; source HTML never becomes executable. */
export function renderReviewMarkdown(markdown: string, pageTitle?: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  const definitions = new Map<string, MarkdownNode>();
  function collect(node: MarkdownNode) {
    if (node.type === "definition" && node.identifier) definitions.set(node.identifier.toUpperCase(), node);
    node.children?.forEach(collect);
  }
  collect(tree);
  function renderLink(node: MarkdownNode, children: string): string {
    const target = node.type.endsWith("Reference") ? definitions.get((node.identifier ?? "").toUpperCase()) : node;
    const label = node.type.startsWith("image") ? escapeReviewHtml(node.alt || "Image") : children;
    const url = target?.url === undefined ? undefined : safeLink(target.url);
    // Relative destinations belong to knowledge pages, not this temporary report directory.
    return url && /^(https?:|mailto:)/iu.test(url)
      ? `<a href="${escapeReviewHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : `${label}${url ? ` <code>${escapeReviewHtml(url)}</code>` : ""}`;
  }
  function render(node: MarkdownNode): string {
    const children = () => (node.children ?? []).map(render).join("");
    const value = escapeReviewHtml(node.value ?? "");
    switch (node.type) {
      case "root": return children();
      case "text": return value;
      case "paragraph": return `<p>${children()}</p>`;
      case "heading": return `<h${node.depth}>${children()}</h${node.depth}>`;
      case "strong": return `<strong>${children()}</strong>`;
      case "emphasis": return `<em>${children()}</em>`;
      case "delete": return `<del>${children()}</del>`;
      case "inlineCode": return `<code>${value}</code>`;
      case "code": return `<pre><code>${value}</code></pre>`;
      case "blockquote": return `<blockquote>${children()}</blockquote>`;
      case "list": return node.ordered ? `<ol start="${node.start ?? 1}">${children()}</ol>` : `<ul>${children()}</ul>`;
      case "listItem": return `<li>${node.checked == null ? "" : node.checked ? "☑ " : "☐ "}${children()}</li>`;
      case "table": return `<div class="table-scroll"><table>${(node.children ?? []).map((row, index) =>
        `<${index ? "tbody" : "thead"}><tr>${(row.children ?? []).map((cell) =>
          `<${index ? "td" : "th"}>${render(cell)}</${index ? "td" : "th"}>`).join("")}</tr></${index ? "tbody" : "thead"}>`).join("")}</table></div>`;
      case "tableCell": return children();
      case "link": case "linkReference": case "image": case "imageReference":
        return renderLink(node, children());
      case "html":
        if (/^<!--[^]*-->$/u.test((node.value ?? "").trim())) return "";
        return (node.value ?? "").split(/(<details(?: open)?>|<\/details>|<summary>|<\/summary>)/u)
          .map((part) => /^<(?:details(?: open)?|\/details|summary|\/summary)>$/u.test(part) ? part : escapeReviewHtml(part)).join("");
      case "break": return "<br>";
      case "thematicBreak": return "<hr>";
      case "definition": return "";
      default: return children() || value;
    }
  }
  const hasPageHeading = tree.children?.some((node) => node.type === "heading" && node.depth === 1);
  return (pageTitle && !hasPageHeading ? `<h1>${escapeReviewHtml(pageTitle)}</h1>` : "") + render(tree);
}
