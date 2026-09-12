import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { rememberArticleRegion } from "./articleRegionBaselines.js";
import {
  articleFragmentReferences, articleSourceLocatorSchema, createArticleSourceReference,
  type ArticleSourceReference, type IndexerAuthorizedWorksetView, type IndexerSourceIdentityInventory,
} from "@c4a/context";

type ReferenceInput = Omit<ArticleSourceReference, "content_digest">;

function inside(root: string, path: string): void {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TypeError("Article source path escapes its authorized root");
  }
}

/** The view is loaded by the Host from the accepted request, never taken from
 * the submitted Author JSON. Cache only within this submission, not across
 * source refreshes. No parser facts are copied into the article. */
export function articleReferenceResolver(input: {
  projectRoot: string;
  view: IndexerAuthorizedWorksetView;
  sourceIdentity?: IndexerSourceIdentityInventory | undefined;
}) {
  const cache = new Map<string, string>();
  const items = input.view.items.map(item => ({
    category: item.category,
    value: item.value as Record<string, unknown>,
  }));
  return (references: readonly ReferenceInput[]): ArticleSourceReference[] => {
    if (references.length > 3) throw new TypeError("A fragment can cite at most three source positions");
    return articleFragmentReferences(references.map(reference => {
      const locator = articleSourceLocatorSchema.parse(reference.locator);
      const key = JSON.stringify([reference.source_ref, locator.path]);
      let text = cache.get(key);
      if (text === undefined) {
        const document = items.find(item => item.category === "document" &&
          item.value.source_ref === reference.source_ref && item.value.path === locator.path)?.value;
        const access = items.find(item => item.category === "source-access" &&
          item.value.source_ref === reference.source_ref && Array.isArray(item.value.paths) &&
          item.value.paths.includes(locator.path))?.value;
        if (!document && !access) {
          throw new TypeError(`Source region is outside this task's read scope: ${reference.source_ref}/${locator.path}`);
        }
        const root = realpathSync(document ? input.projectRoot : String(access!.captured_root));
        if (!document) inside(realpathSync(input.projectRoot), root);
        const lexical = document
          ? resolve(root, String(document.content_path))
          : resolve(root, locator.path);
        inside(root, lexical);
        const path = realpathSync(lexical);
        inside(root, path);
        const status = statSync(path);
        if (!status.isFile()) throw new TypeError("Article source must be a regular file");
        const bytes = readFileSync(path);
        const expected = document?.content_hash ?? (input.sourceIdentity?.source_ref === reference.source_ref
          ? input.sourceIdentity.files.find(file => file.normalized_path === locator.path)?.content_digest
          : undefined);
        if (typeof expected === "string" &&
            `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== expected) {
          throw new TypeError("Captured source changed; refresh the current task before submitting");
        }
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        if (text.includes("\0")) throw new TypeError("Article source is not text");
        cache.set(key, text);
      }
      const resolved = createArticleSourceReference(reference.source_ref, locator, text);
      rememberArticleRegion(input.projectRoot, resolved, text);
      return resolved;
    }));
  };
}
