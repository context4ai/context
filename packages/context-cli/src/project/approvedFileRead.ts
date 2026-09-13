import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { reuseCommandFileRead } from "./commandReadCache.js";
import { isKnowledgeAssetPath, walkApprovedMarkdown } from "./verifyProjectFiles.js";

/** Share bytes, not validation verdicts. Enumerate again so additions/removals
 * participate in the key; file stamps invalidate edits within this command. */
export async function readApprovedMarkdownFiles(projectRoot: string) {
  const files = (await walkApprovedMarkdown(join(projectRoot, "knowledge")))
    .filter(file => !isKnowledgeAssetPath(file.relPath));
  const snapshot = await reuseCommandFileRead({ key: "approved-markdown-files",
    paths: files.map(file => file.absPath),
    read: () => Promise.all(files.map(async file => ({ ...file, content: await readFile(file.absPath, "utf8") }))),
  });
  return snapshot.map(file => ({ ...file }));
}

/** Each consumer owns its parsed object, so speculative Review edits cannot
 * contaminate another consumer. Parse once per unchanged command input. */
export async function readApprovedStructureDocument(projectRoot: string): Promise<{ content: string; parsed: unknown }> {
  const path = join(projectRoot, "knowledge/structure.yaml");
  const document = await reuseCommandFileRead({ key: "approved-structure-yaml", paths: [path],
    read: async () => {
      const content = await readFile(path, "utf8");
      return { content, parsed: parse(content) as unknown };
    } });
  return { content: document.content, parsed: structuredClone(document.parsed) };
}

export async function readApprovedStructureValue(projectRoot: string): Promise<unknown> {
  return (await readApprovedStructureDocument(projectRoot)).parsed;
}
