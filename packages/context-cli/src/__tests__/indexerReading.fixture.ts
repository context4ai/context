/** Test consumer for the ordinary fenced data in Agent-visible Markdown. */
export function readingObjects(markdown: string): Record<string, unknown>[] {
  return [...markdown.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gmu)]
    .map((match) => JSON.parse(match[2]!) as Record<string, unknown>);
}

export function readingItems(markdown: string, category: string, taskKey?: string): { ref: string; value: unknown }[] {
  if (taskKey && markdown.startsWith("# Indexer batch")) {
    const marker = `## ${taskKey} — task-specific material\n`;
    const specific = markdown.split(marker)[1]?.split(/^## task-[^\n]+ — task-specific material$/mu)[0] ?? "";
    const shared = markdown.split("## Shared material — read once\n")[1]?.split(/^## task-[^\n]+ — task-specific material$/mu)[0] ?? "";
    const authorized = shared.split(/^Applies to: /mu).slice(1).filter((block) =>
      block.split(" — ")[0]!.split(", ").includes(taskKey));
    markdown = [...authorized, specific].join("\n");
  }
  const normalized = markdown.replaceAll(`### ${category} overview\n\n`, `### ${category}\n\n`);
  const chunks = normalized.split(`### ${category}\n\n`).slice(1);
  return chunks.map((chunk) => {
    const item = readingObjects(chunk)[0]!;
    const { ref, ...fields } = item;
    return { ref: String(ref), value: item.value ?? fields };
  });
}
