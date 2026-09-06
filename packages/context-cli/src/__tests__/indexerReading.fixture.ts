/** Test consumer for the ordinary fenced data in Agent-visible Markdown. */
export function readingObjects(markdown: string): Record<string, unknown>[] {
  return [...markdown.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gmu)]
    .map((match) => JSON.parse(match[2]!) as Record<string, unknown>);
}

export function readingItems(markdown: string, category: string): { ref: string; value: unknown }[] {
  const chunks = markdown.split(`### ${category}\n\n`).slice(1);
  return chunks.map((chunk) => {
    const item = readingObjects(chunk)[0]!;
    const { ref, ...fields } = item;
    return { ref: String(ref), value: item.value ?? fields };
  });
}
