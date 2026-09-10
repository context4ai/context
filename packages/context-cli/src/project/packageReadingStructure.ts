import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectReadingStructure, readingTargetKey, type PackageDefinition, type ReadingStructure } from "@c4a/context";
import { packageKnowledgeOutputPath } from "./packageDistribution.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";

export function readingSectionAnchor(key: string): string {
  return `section-${encodeURIComponent(key)}`;
}
export function packageReadingTargets(pkg: PackageDefinition, files: readonly ApprovedKnowledgeFile[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const file of files) {
    const artifact = parseKnowledgeFrontmatter(file.content).artifact_ref;
    if (typeof artifact !== "string") continue;
    const href = `./${packageKnowledgeOutputPath(pkg, file.relPath).split("/").map(encodeURIComponent).join("/")}`;
    targets.set(artifact, href);
    for (const match of file.content.matchAll(/<!--\s*context:section\b[^>]*\bid="([a-zA-Z0-9_-]+)"[^>]*-->/gu)) {
      const section = match[1]!;
      targets.set(readingTargetKey({ artifact_ref: artifact, section_key: section }), `${href}#${readingSectionAnchor(section)}`);
    }
  }
  return targets;
}

/** Reader navigation is generated from approved identities after selection.
 * Missing targets remain shared pending entries, never links to guessed paths. */
export async function writePackageReadingStructure(input: {
  projectRoot: string; pkg: PackageDefinition; selected: readonly ApprovedKnowledgeFile[];
  structure: ReadingStructure | undefined;
}) {
  if (input.structure === undefined || input.pkg.kind !== "package.kb") return [];
  const projected = projectReadingStructure(input.structure, packageReadingTargets(input.pkg, input.selected));
  const root = join(input.projectRoot, input.pkg.outDir);
  const mapPath = join(root, "context-reading-structure.json");
  // A custom template must not silently overwrite the identity projection.
  try { await readFile(mapPath); throw new TypeError("package template uses reserved context-reading-structure.json; rename that template output"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(mapPath, JSON.stringify({ protocol: "context.reading-output/v1", reading_revision: input.structure.revision, ...projected }, null, 2) + "\n");
  const lines: string[] = [];
  const escape = (value: string) => value.replace(/[\\[\]<>]/gu, char => `\\${char}`).replace(/[\r\n]/gu, " ");
  function render(entries: typeof projected.entries, depth: number) {
    for (const entry of entries) {
      const title = escape(entry.title);
      lines.push(`${"  ".repeat(depth)}- ${entry.href === undefined ? title : `[${title}](<${entry.href}>)`}`);
      render(entry.children, depth + 1);
    }
  }
  render(projected.entries, 0);
  if (lines.length) {
    const indexPath = join(root, "index.md");
    let existing = "";
    try { existing = await readFile(indexPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await writeFile(indexPath, `${existing.trimEnd()}\n\n## Reading navigation\n\n${lines.join("\n")}\n`);
  }
  return projected.warnings;
}
