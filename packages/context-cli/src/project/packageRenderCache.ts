import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { projectPackageKnowledgeMarkdown } from "./packageKnowledgeProjection.js";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** One replaceable cache entry per page/projection. A later batch reuses reader
 * Markdown when its exact input has not changed; nothing is added to the page. */
export async function cachedPackageKnowledgeMarkdown(input: {
  projectRoot: string;
  key: string;
  content: string;
  render?: (content: string) => string;
}): Promise<string> {
  const fingerprint = digest(`package-reader-markdown/v1\n${input.content}`);
  const path = join(input.projectRoot, ".tmp/context-runtime/package-render", `${digest(input.key)}.json`);
  try {
    const cached: unknown = JSON.parse(await readFile(path, "utf8"));
    if (cached !== null && typeof cached === "object" && "fingerprint" in cached &&
        cached.fingerprint === fingerprint && "markdown" in cached && typeof cached.markdown === "string") {
      return cached.markdown;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const markdown = (input.render ?? projectPackageKnowledgeMarkdown)(input.content);
  await atomicWriteFile(path, JSON.stringify({ fingerprint, markdown }));
  return markdown;
}
