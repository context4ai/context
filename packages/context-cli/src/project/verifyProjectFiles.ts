import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

export function isKnowledgeAssetPath(relPath: string): boolean {
  return relPath === "assets" || relPath.startsWith("assets/");
}

export async function walkMarkdown(root: string): Promise<Array<{ relPath: string; absPath: string }>> {
  if (!existsSync(root)) return [];
  const files: Array<{ relPath: string; absPath: string }> = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      files.push({ relPath: toPosixPath(relative(root, absPath)), absPath });
    }
  };
  await visit(root);
  files.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return files;
}
