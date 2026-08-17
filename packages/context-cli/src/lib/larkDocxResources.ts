import { createHash } from "node:crypto";

export interface LarkExternalResource {
  kind: "bookmark" | "synced-reference" | "document" | "poll" | "cite" | "image" | "video" | "whiteboard" | "diagram" | "base" | "sheet" | "file" | "chat" | "embed";
  locator: string;
  title?: string;
  attributes: Record<string, string>;
  inline_content?: boolean;
}

export interface LarkResourceXmlNode {
  "#text"?: string;
  ":@"?: Record<string, string>;
  [key: string]: unknown;
}

export interface LarkResourceRenderContext {
  sourceUrl: string;
  tracker: {
    flag(blockType: string, reason: string, severity: "warning" | "error", code?: string): void;
  };
  resources: LarkExternalResource[];
}

function elementName(node: LarkResourceXmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text");
}

function elementChildren(node: LarkResourceXmlNode, name: string): LarkResourceXmlNode[] {
  const value = node[name];
  return Array.isArray(value) ? value as LarkResourceXmlNode[] : [];
}

function textContent(nodes: readonly LarkResourceXmlNode[]): string {
  return nodes.map((node) => {
    if (typeof node["#text"] === "string") return node["#text"];
    const name = elementName(node);
    return name === undefined ? "" : textContent(elementChildren(node, name));
  }).join("");
}

function normalizeInline(value: string): string {
  return value.replace(/[ \t\r\n]+/gu, " ").trim();
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/gu, "\\$1");
}

function safeFence(value: string, language = ""): string {
  const longest = Math.max(3, ...[...value.matchAll(/`+/gu)].map((match) => match[0].length + 1));
  const fence = "`".repeat(longest);
  return `${fence}${language}\n${value.trim()}\n${fence}`;
}

function stableDocumentUrl(sourceUrl: string, fileType: string | undefined, docId: string): string {
  try {
    const url = new URL(sourceUrl);
    const pathType = fileType === "wiki" ? "wiki" : fileType === "docx" || fileType === "doc" ? "docx" : undefined;
    if (pathType !== undefined) return `${url.origin}/${pathType}/${encodeURIComponent(docId)}`;
  } catch {
    // Fall back to an opaque stable locator below.
  }
  return `lark:${fileType ?? "document"}:${docId}`;
}

function resourceIdentity(kind: LarkExternalResource["kind"], attrs: Record<string, string>): string | undefined {
  if (kind === "bookmark") return undefined;
  if (kind === "poll") return attrs.id;
  if (kind === "synced-reference") {
    const sourceToken = attrs["src-token"];
    const sourceBlockId = attrs["src-block-id"];
    return sourceToken !== undefined && sourceBlockId !== undefined
      ? `${sourceToken}#${sourceBlockId}`
      : undefined;
  }
  if (kind === "sheet") {
    const token = attrs.token ?? attrs["obj-token"] ?? attrs["spreadsheet-token"];
    const sheetId = attrs["sheet-id"];
    return token !== undefined && sheetId !== undefined ? `${token}#${sheetId}` : undefined;
  }
  if (kind === "base") {
    const token = attrs.token ?? attrs["obj-token"] ?? attrs["base-token"];
    const tableId = attrs["table-id"];
    const viewId = attrs["view-id"];
    return token !== undefined && tableId !== undefined
      ? `${token}#${tableId}${viewId === undefined ? "" : `#${viewId}`}`
      : undefined;
  }
  if (kind === "diagram" && attrs["content-hash"] !== undefined) return `inline-${attrs["content-hash"]}`;
  const kindCandidates = kind === "cite" || kind === "document" ? [attrs["doc-id"]] : [];
  const candidates = [
    attrs.token,
    attrs["file-token"],
    attrs["image-token"],
    attrs["board-token"],
    attrs["obj-token"],
    attrs["source-id"],
    attrs["chat-id"],
    ...(kind === "document" ? [] : [attrs.id]),
    ...kindCandidates,
    attrs.src,
  ];
  return candidates.find((value) => value !== undefined && value.length > 0 && !isTransientLarkMediaUrl(value));
}

export function registerLarkResource(
  ctx: LarkResourceRenderContext,
  blockType: string,
  kind: LarkExternalResource["kind"],
  attrs: Record<string, string>,
  title?: string,
): LarkExternalResource {
  const identity = resourceIdentity(kind, attrs);
  const href = attrs.href ?? attrs.url;
  const locator = identity !== undefined
    ? `lark:${kind}:${identity}`
    : href !== undefined && !isTransientLarkMediaUrl(href)
      ? href
      : undefined;
  const resolvedLocator = locator ?? `lark:${kind}:unresolved:${createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(Object.entries(attrs).sort(([left], [right]) => left.localeCompare(right)))))
    .digest("hex")
    .slice(0, 12)}`;
  if (locator === undefined) {
    ctx.tracker.flag(blockType, "resource has no stable token, source id, or non-transient URL", "error");
  }
  const resource: LarkExternalResource = {
    kind,
    locator: resolvedLocator,
    ...(title !== undefined && title.length > 0 ? { title } : {}),
    attributes: Object.fromEntries(Object.entries(attrs).filter(([, value]) => value.length > 0 && !isTransientLarkMediaUrl(value))),
  };
  ctx.resources.push(resource);
  return resource;
}

export function isTransientLarkMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.searchParams.has("authcode") || /drive-stream|box\/stream\/download/iu.test(url.hostname + url.pathname);
  } catch {
    return false;
  }
}

export function renderLarkResource(
  name: string,
  nodes: readonly LarkResourceXmlNode[],
  attrs: Record<string, string>,
  ctx: LarkResourceRenderContext,
): string {
  if (name === "cite") {
    if (attrs.type === "user") return `@${attrs["user-name"] ?? (normalizeInline(textContent(nodes)) || "user")}`;
    const title = attrs.title ?? (normalizeInline(textContent(nodes)) || "Referenced document");
    const docId = attrs["doc-id"] ?? attrs.token;
    const resource = registerLarkResource(ctx, name, "cite", attrs, title);
    if (docId === undefined) {
      ctx.tracker.flag(name, "cite has no doc-id or token", "error");
      return `${escapeMarkdownLabel(title)} <!-- ${resource.locator} -->`;
    }
    return `[${escapeMarkdownLabel(title)}](${stableDocumentUrl(ctx.sourceUrl, attrs["file-type"], docId)}) <!-- ${resource.locator} -->`;
  }
  if (name === "img" || name === "image") {
    const title = attrs.alt ?? attrs.name ?? "Image";
    const resource = registerLarkResource(ctx, name, "image", attrs, title);
    return `\n\n> Image: ${title} (${resource.locator})\n\n`;
  }
  if (name === "source" || name === "file" || name === "attachment") {
    const isVideo = attrs.mime?.startsWith("video/") === true || attrs.type === "video";
    const kind = isVideo ? "video" : "file";
    const title = attrs.name ?? (isVideo ? "Video" : "File");
    const resource = registerLarkResource(ctx, name, kind, attrs, title);
    return `\n\n> ${isVideo ? "Video" : "File"}: ${title} (${resource.locator})\n\n`;
  }
  if (name === "whiteboard") {
    const resource = registerLarkResource(ctx, name, "whiteboard", attrs, attrs.title ?? "Whiteboard");
    const source = textContent(nodes).trim();
    const diagram = source.length > 0
      ? `\n\n${safeFence(source, attrs.type === "mermaid" ? "mermaid" : "text")}\n\n`
      : "\n\n";
    return `${diagram}> Whiteboard: ${resource.locator}\n\n`;
  }
  if (name === "diagram") {
    const source = textContent(nodes).trim();
    const resourceAttrs = source.length > 0
      ? { ...attrs, "content-hash": createHash("sha256").update(source, "utf8").digest("hex") }
      : attrs;
    const resource = registerLarkResource(ctx, name, "diagram", resourceAttrs, attrs.title ?? "Diagram");
    if (source.length > 0) {
      resource.inline_content = true;
      return `\n\n${safeFence(source, attrs.type ?? "text")}\n\n> Diagram: ${resource.locator}\n\n`;
    }
    return `\n\n> Diagram: ${resource.locator}\n\n`;
  }
  if (name === "chat_card") {
    const title = attrs.name ?? "Chat";
    const resource = registerLarkResource(ctx, name, "chat", attrs, title);
    return `\n\n> Chat: ${title} (${resource.locator})\n\n`;
  }
  if (name === "readonly-block") {
    const title = attrs.type ?? "Read-only embedded block";
    const kind = attrs.type === "diagram" ? "diagram" : "embed";
    const resource = registerLarkResource(ctx, name, kind, attrs, title);
    return kind === "diagram"
      ? `\n\n> Diagram: ${resource.locator}\n\n`
      : `\n\n> Embedded block: ${title} (${resource.locator})\n\n`;
  }
  const kind = name === "sheet" ? "sheet" : "base";
  const title = attrs.title ?? (kind === "sheet" ? "Embedded Sheet" : "Embedded Base");
  const resource = registerLarkResource(ctx, name, kind, attrs, title);
  const details = [attrs["table-id"], attrs["sheet-id"], attrs["view-id"]].filter(Boolean).join(" / ");
  return `\n\n> ${title}${details.length > 0 ? ` — ${details}` : ""} (${resource.locator})\n\n`;
}

export function renderLarkSubPage(
  nodes: readonly LarkResourceXmlNode[],
  attrs: Record<string, string>,
  ctx: LarkResourceRenderContext,
): string {
  const title = attrs.title ?? (normalizeInline(textContent(nodes)) || "Untitled subpage");
  const docId = attrs["doc-id"] ?? attrs.token;
  const resource = registerLarkResource(ctx, "sub-page", "document", attrs, title);
  if (docId === undefined) {
    ctx.tracker.flag("sub-page", "sub-page has no doc-id or token", "error");
    return `${escapeMarkdownLabel(title)} <!-- ${resource.locator} -->`;
  }
  return `[${escapeMarkdownLabel(title)}](${stableDocumentUrl(ctx.sourceUrl, attrs["file-type"], docId)}) <!-- ${resource.locator} -->`;
}

export function renderLarkBookmark(
  nodes: readonly LarkResourceXmlNode[],
  attrs: Record<string, string>,
  ctx: LarkResourceRenderContext,
): string {
  const href = attrs.href ?? attrs.url;
  const title = attrs.name ?? attrs.title ?? (normalizeInline(textContent(nodes)) || href) ?? "Bookmark";
  const resource = registerLarkResource(ctx, "bookmark", "bookmark", attrs, title);
  if (href === undefined || isTransientLarkMediaUrl(href)) {
    ctx.tracker.flag("bookmark", "bookmark has no stable non-transient URL", "error");
    return `\n\n> Bookmark: ${escapeMarkdownLabel(title)} <!-- ${resource.locator} -->\n\n`;
  }
  return `\n\n> Bookmark: [${escapeMarkdownLabel(title)}](${href}) <!-- ${resource.locator} -->\n\n`;
}

export function renderLarkSyncedReference(
  attrs: Record<string, string>,
  ctx: LarkResourceRenderContext,
): string {
  const sourceToken = attrs["src-token"];
  const sourceBlockId = attrs["src-block-id"];
  const title = attrs.title ?? attrs.name ?? "Synced reference";
  const resource = registerLarkResource(ctx, "synced_reference", "synced-reference", attrs, title);
  if (sourceToken === undefined || sourceBlockId === undefined) {
    ctx.tracker.flag("synced_reference", "synced_reference requires both src-token and src-block-id", "error");
    return `\n\n> ${escapeMarkdownLabel(title)} <!-- ${resource.locator} -->\n\n`;
  }
  const target = `${stableDocumentUrl(ctx.sourceUrl, "docx", sourceToken)}#${encodeURIComponent(sourceBlockId)}`;
  return `\n\n> [${escapeMarkdownLabel(title)}](${target}) <!-- ${resource.locator} -->\n\n`;
}
