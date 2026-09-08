import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

/** Ship SDK-owned manuals and their local Markdown links with the assistant. */
export async function syncIndexerAuthoringReferences(repositoryRoot: string): Promise<void> {
  const docs = resolve(repositoryRoot, "packages/context/docs");
  const target = resolve(repositoryRoot, "plugins/context/skills/context-indexer-create/references");
  await rm(target, { recursive: true, force: true });
  const queue = ["guides/indexer-skill-creation.md", "reference/indexer-provider-protocol.md",
    "guides/code-indexer-skill-authoring.md", "guides/markdown-indexer-skill-authoring.md",
    "guides/note.md", "guides/sessions.md", "guides/indexer-provider-and-customization.md"];
  const seen = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = resolve(docs, path);
    if (!source.startsWith(docs + "/")) throw new Error(`SDK reference leaves docs: ${path}`);
    const text = await readFile(source, "utf8");
    for (const match of text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/gu)) {
      const link = match[1]!;
      if (/^[a-z]+:/iu.test(link)) continue;
      const dependency = relative(docs, resolve(dirname(source), link));
      if (!dependency.startsWith("..")) queue.push(dependency);
    }
    const output = resolve(target, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, text, "utf8");
  }
}
