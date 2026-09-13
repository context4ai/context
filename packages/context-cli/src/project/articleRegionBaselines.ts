import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { articleSourceRegion, type ArticleSourceReference } from "@c4a/context";

const DIGEST = /^sha256:([a-f0-9]{64})$/u;

function baselinePath(root: string, digest: string, create: boolean): string | undefined {
  const hash = DIGEST.exec(digest)?.[1];
  if (!hash) throw new TypeError("Invalid source region digest");
  let path = realpathSync(root);
  for (const part of [".tmp", "context-runtime", "source-regions"]) {
    path = join(path, part);
    if (create) {
      try { mkdirSync(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    try {
      const status = lstatSync(path);
      if (status.isSymbolicLink() || !status.isDirectory()) throw new TypeError("Source region cache must stay inside the workspace");
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  return join(path, `${hash}.txt`);
}

function digestOf(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** One immutable copy of the actually cited text per digest, not a per-article
 * source-version ledger. Missing cache is recoverable uncertainty, never proof
 * that an old line number still identifies the same source region. */
export function readArticleRegionBaseline(root: string, digest: string): string | undefined {
  const path = baselinePath(root, digest, false);
  if (!path) return undefined;
  try {
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink()) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
    return digestOf(text) === digest ? text : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof TypeError) return undefined;
    throw error;
  }
}

export function rememberArticleRegion(root: string, reference: ArticleSourceReference, capturedText: string): void {
  const region = articleSourceRegion(capturedText, reference.locator);
  if (digestOf(region) !== reference.content_digest) throw new TypeError("Source region does not match its recorded digest");
  const path = baselinePath(root, reference.content_digest, true)!;
  try { writeFileSync(path, region, { encoding: "utf8", flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (readArticleRegionBaseline(root, reference.content_digest) !== region) {
      throw new TypeError("Source region cache is corrupt; approved references are unchanged");
    }
  }
}
