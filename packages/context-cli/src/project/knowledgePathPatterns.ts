/** Knowledge path patterns used by package `select` and `rules`: exact paths, `*`
 * within one folder, `**` across folders, and `dir/**` for a whole folder. */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.split("\\").join("/");
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3).replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`^${prefix}(?:/.*)?$`, "u");
  }
  let out = "^";
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      index++;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char?.replace(/[.+^${}()|[\]\\]/gu, "\\$&") ?? "";
    }
  }
  return new RegExp(`${out}$`, "u");
}

export function matchingKnowledgePatterns(path: string, patterns: readonly string[] | undefined): string[] {
  return patterns?.filter((pattern) => pattern === path || globToRegExp(pattern).test(path)) ?? [];
}

export function matchesKnowledgePattern(path: string, patterns: readonly string[] | undefined): boolean {
  return matchingKnowledgePatterns(path, patterns).length > 0;
}
