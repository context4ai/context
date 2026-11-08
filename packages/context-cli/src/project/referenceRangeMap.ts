import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArticleSourceReference } from "@c4a/context";

const exec = promisify(execFile);
export interface Hunk { old: number; oldCount: number; next: number; nextCount: number }

export async function hunks(root: string, before: string, after: string): Promise<Hunk[]> {
  const parent = join(root, ".tmp/context-runtime/reference-diff");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "compare-"));
  try {
    const a = join(directory, "before"), b = join(directory, "after");
    await writeFile(a, before.replace(/\r\n/gu, "\n")); await writeFile(b, after.replace(/\r\n/gu, "\n"));
    let output: string;
    try { output = (await exec("git", ["diff", "--no-color", "--no-index", "--no-ext-diff", "--no-textconv", "--text", "--unified=0", "--inter-hunk-context=0", "--", a, b], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })).stdout; }
    catch (error) {
      const failed = error as { code?: number; stdout?: string };
      if (failed.code !== 1 || typeof failed.stdout !== "string") throw error;
      output = failed.stdout;
    }
    const matches = [...output.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu)].map(match => ({
      old: Number(match[1]), oldCount: Number(match[2] ?? 1), next: Number(match[3]), nextCount: Number(match[4] ?? 1),
    }));
    if (!matches.length && before.replace(/\r\n/gu, "\n") !== after.replace(/\r\n/gu, "\n")) {
      throw new TypeError("Source diff could not be mapped; refresh the update or use normal revision.");
    }
    return matches;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** A diff proposes a region, never semantic equivalence. A deleted region has
 * no candidate. Replacement hunks are shown in full for the Agent to judge. */
export function mapReferenceRange(locator: ArticleSourceReference["locator"], changes: readonly Hunk[]) {
  const map = (line: number, end: boolean): number | undefined => {
    let shift = 0;
    for (const hunk of changes) {
      if (hunk.oldCount === 0) { if (line > hunk.old) shift += hunk.nextCount; continue; }
      if (line < hunk.old) break;
      if (line < hunk.old + hunk.oldCount) return hunk.nextCount ? hunk.next + (end ? hunk.nextCount - 1 : 0) : undefined;
      shift += hunk.nextCount - hunk.oldCount;
    }
    return line + shift;
  };
  const start = map(locator.start_line, false), end = map(locator.end_line, true);
  return start !== undefined && end !== undefined && start > 0 && end >= start
    ? { ...locator, start_line: start, end_line: end } : undefined;
}

