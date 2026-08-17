const SEARCH_PREFIX_RE = /^\[c4a:search [^\]\n]+\]\n\n/;

/**
 * 构造 "检索增强" 前缀。api 在写入 Fact 时会把这段前缀拼到 content 开头，
 * 目的是让 BM25 / 向量 embedding 能召回到这些关键词（如组件名、包名、业务术语）。
 *
 * Fact 是通用实体，关键词列表本身不绑定任何业务概念——caller 放什么，api 原样拼。
 * 读取 Fact 时通过 stripSearchPrefix 剥离，消费端看到干净原文。
 */
export function buildSearchPrefix(keywords: readonly string[] | null | undefined): string {
  if (!keywords || keywords.length === 0) return "";
  const cleaned = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
  if (cleaned.length === 0) return "";
  return `[c4a:search ${cleaned.join(" ")}]\n\n`;
}

/** 剥离 content 开头的 [c4a:search ...] 前缀（写入时加的检索增强头） */
export function stripSearchPrefix(content: string | null | undefined): string {
  if (!content) return content ?? "";
  return content.replace(SEARCH_PREFIX_RE, "");
}
