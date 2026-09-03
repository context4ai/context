function normalizedTitle(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function firstVisibleMarkdownLine(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/u);
  let insideComment = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (insideComment) {
      if (line.includes("-->")) insideComment = false;
      continue;
    }
    if (line.length === 0) continue;
    if (line.startsWith("<!--")) {
      if (!line.includes("-->")) insideComment = true;
      continue;
    }
    return line;
  }
  return undefined;
}

export function ensureMarkdownPageTitle(markdown: string, title: string): string {
  const pageTitle = normalizedTitle(title);
  const body = markdown.trimStart();
  const firstLine = firstVisibleMarkdownLine(body);
  const heading = firstLine === undefined ? undefined : /^#\s+(.+)$/u.exec(firstLine)?.[1];
  if (heading !== undefined && normalizedTitle(heading) === pageTitle) return body;
  return `# ${pageTitle}\n\n${body}`;
}
