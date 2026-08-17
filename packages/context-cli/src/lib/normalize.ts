import { logicalRawHash } from "../incremental/hash.js";

const BOM = "\uFEFF";

export function normalizeMarkdown(input: string): string {
  let text = input;

  // § 5.3.1 char layer: Unicode NFC + strip BOM
  text = text.normalize("NFC");
  if (text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }

  // § 5.3.2 text layer
  // unify line endings to \n
  text = text.replace(/\r\n?/g, "\n");

  // strip trailing whitespace per line (preserve leading indentation)
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n");

  // collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");

  // unify list markers * / + to - (only when at line start, followed by space)
  text = text.replace(/^(\s*)[*+]([ \t])/gm, "$1-$2");

  // close unclosed fence blocks (if ``` count is odd, append a closing fence)
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 === 1) {
    if (!text.endsWith("\n")) text += "\n";
    text += "```\n";
  }

  return text;
}

export function computeContentHash(input: string): string {
  const normalized = normalizeMarkdown(input);
  return logicalRawHash(normalized);
}

export type SourceKind = "feishu" | "local" | "oncall" | "meeting" | "note";

/**
 * Hostnames recognized as "feishu-family" (Lark) docs, accepted by capture and
 * treated as the `feishu` source type.
 *
 * Public consumer surface includes:
 * - `*.feishu.cn`              — 飞书国内
 * - `*.feishu.com`             — 飞书国际（historical）
 * - `*.larksuite.com`          — Lark 国际
 * - `*.larkoffice.com`         — 飞书企业版（enterprise / partner 部署常见）
 *
 * Both `normalizeUrl` (for source-id derivation) and capture-command URL gating
 * key off this one regex — keep them in sync by importing this constant, not by
 * duplicating the pattern.
 */
export const FEISHU_HOST_RE = /(^|\.)(feishu\.(cn|com)|larksuite\.com|larkoffice\.com)$/i;

export interface NormalizedUrl {
  normalized: string;
  feishuToken?: { kind: "doc" | "wiki"; token: string };
}

export function normalizeUrl(rawUrl: string): NormalizedUrl {
  const url = new URL(rawUrl);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  const isFeishu = FEISHU_HOST_RE.test(url.hostname);
  if (isFeishu) {
    const match = url.pathname.match(/^\/(docx|wiki|docs)\/([A-Za-z0-9]+)/);
    if (match) {
      const rawKind = match[1]!;
      const token = match[2]!;
      const kind: "doc" | "wiki" = rawKind === "wiki" ? "wiki" : "doc";
      url.search = "";
      url.pathname = `/${rawKind}/${token}`;
      if (url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
      return { normalized: url.toString(), feishuToken: { kind, token } };
    }
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return { normalized: url.toString() };
}

export function computeSourceId(args: {
  type: SourceKind;
  normalizedUrl?: NormalizedUrl;
  slug?: string;
  id?: string;
}): string {
  const { type } = args;
  if (type === "feishu") {
    const t = args.normalizedUrl?.feishuToken;
    if (!t) throw new Error("feishu source requires a feishu doc/wiki URL");
    return `feishu:${t.kind}:${t.token}`;
  }
  if (type === "local") {
    if (!args.slug) throw new Error("local source requires a slug");
    return `local:${args.slug}`;
  }
  if (type === "oncall") {
    if (!args.id) throw new Error("oncall source requires an id");
    return `oncall:${args.id}`;
  }
  if (type === "meeting") {
    if (!args.id) throw new Error("meeting source requires an id");
    return `meeting:${args.id}`;
  }
  if (type === "note") {
    if (!args.slug) throw new Error("note source requires a slug");
    return `note:${args.slug}`;
  }
  throw new Error(`unknown source type: ${type as string}`);
}

export function slugify(input: string, maxLen = 60): string {
  let s = input.normalize("NFC").toLowerCase();
  s = s.replace(/[\s\u3000]+/g, "-");
  s = s.replace(/[^a-z0-9\-\u4e00-\u9fff]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/g, "");
  if (s.length === 0) s = "untitled";
  return s;
}
