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

/** Assemble semantic input without duplicating an already authored opening. */
export function renderMarkdownSection(input: {
  markdown: string;
  heading: string;
  pageTitle?: string;
  summary?: string;
}): string {
  const body = input.markdown.trimStart();
  const firstLine = firstVisibleMarkdownLine(body);
  const pageHeading = firstLine === undefined ? undefined : /^#\s+(.+)$/u.exec(firstLine)?.[1];
  // Providers can return a complete opening Section. Keep its introduction and
  // nested headings intact rather than inserting another title/summary above it.
  if (input.pageTitle !== undefined && pageHeading !== undefined &&
    normalizedTitle(pageHeading) === normalizedTitle(input.pageTitle)) return body;
  const sectionHeading = firstLine === undefined ? undefined : /^##\s+(.+)$/u.exec(firstLine)?.[1];
  const section = sectionHeading !== undefined &&
    normalizedTitle(sectionHeading) === normalizedTitle(input.heading)
    ? body
    : `## ${normalizedTitle(input.heading)}\n\n${body}`;
  const content = [
    ...(input.summary === undefined ? [] : [input.summary]),
    section,
  ].join("\n\n");
  return input.pageTitle === undefined ? content : ensureMarkdownPageTitle(content, input.pageTitle);
}
