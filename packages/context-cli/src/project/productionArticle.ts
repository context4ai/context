import YAML from "yaml";
import { z } from "zod";
import { articleFragmentReferences, createArticleSourceReference,
  indexerKnowledgeCollectionSchema, indexerProtocolDigest } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { indexerCandidateId, isReservedKnowledgeIndexPath, isSafeKnowledgeTargetPath,
  parseCandidateRecord, type CandidateRecord } from "./candidateLedger.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { rememberArticleRegion } from "./articleRegionBaselines.js";
import { applyProductionArticleEdits, productionReferenceInputSchema, type ProductionArticleBase } from "./productionArticleEdits.js";
import type { ProductionTask } from "./productionStage.js";
import type { FixedProductionTask } from "./productionSubmissionFiles.js";
import { okfTypeForKnowledgePath } from "./okfTypes.js";

export const productionReferencesSchema = z.object({
  sections: z.array(z.object({
    id: z.string().min(1),
    references: z.array(productionReferenceInputSchema),
  }).strict()),
}).strict();

export type ProductionSourceReader = (source: string, path: string, captured?: boolean) => Promise<string>;

/** Warm this submission's existing reader, not a persistent evidence cache.
 * Only declared, authorized references are read; normal compilation remains
 * the authority for all errors and acceptance. Fragment edits need their base
 * to resolve references and deliberately stay on the ordinary path. */
export async function prefetchProductionArticleSources(
  inputs: readonly { task: ProductionTask; files: FixedProductionTask }[],
  read: ProductionSourceReader,
): Promise<void> {
  const locations = new Map<string, { source: string; path: string }>();
  for (const { task, files } of inputs) {
    if (files.edits || !files.content || !files.references) continue;
    try {
      const declared = productionReferencesSchema.parse(YAML.parse(files.references.text));
      const allowed = new Set(task.sources.map(source => source.scope));
      for (const section of declared.sections) for (const ref of section.references) {
        if (!allowed.has(ref.source_ref)) continue;
        const location = { source: ref.source_ref, path: ref.locator.path };
        locations.set(JSON.stringify(location), location);
      }
    } catch { /* Invalid declarations are diagnosed by normal compilation. */ }
  }
  const selected = [...locations.values()];
  for (let offset = 0; offset < selected.length; offset += 8) {
    // Drain every read, including failures, before the submission can return.
    // The same reader retains its result/error for the subsequent compilation.
    await Promise.allSettled(selected.slice(offset, offset + 8).map(location =>
      read(location.source, location.path, true)));
  }
}

function articleError(task: ProductionTask, file: string, message: string, section?: string): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid, reason_code: "invalid-production-article",
    task: task.id, file, ...(section ? { section } : {}),
    next_action: { command: "context action complete-current --help" },
    next: "Fix this task's indicated file or fragment, then resubmit only failed tasks using the existing input handles.",
  });
}

/** Compile one fixed complete article into the existing Candidate model. Source
 * references are computed from authorized text, never accepted as Agent hashes.
 * This function does not persist, approve, publish or load Provider metadata. */
export async function prepareProductionArticle(input: {
  projectRoot: string;
  task: ProductionTask;
  files: FixedProductionTask;
  sourceReader?: ProductionSourceReader;
  visibility?: string;
  base?: ProductionArticleBase;
  approvedBaseDigest: string | null;
}): Promise<CandidateRecord> {
  const { task } = input;
  let files = input.files;
  let retained: ReturnType<typeof applyProductionArticleEdits>["retainedReferences"] | undefined;
  if (files.edits) {
    const editsPath = files.edits.path;
    try {
      if (!input.base) throw new TypeError("The revision base is unavailable. Read the current article or resubmit the complete draft.");
      const patched = applyProductionArticleEdits(input.base, files);
      files = patched.files;
      retained = patched.retainedReferences;
    } catch (error) {
      throw articleError(task, editsPath, error instanceof Error ? error.message : String(error));
    }
  }
  if (!files.content || !files.references) throw articleError(task, files.edits?.path ?? "submission.yaml", "A complete article requires content and references files.");
  const collection = indexerKnowledgeCollectionSchema.parse(task.path.split("/")[0]);
  if (!isSafeKnowledgeTargetPath(collection, task.path) || isReservedKnowledgeIndexPath(task.path)) {
    throw articleError(task, files.content.path, "The planned target is not a safe article path. Revise the plan before submitting.");
  }
  const markdown = files.content.text;
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  let metadata: { title: string; description: string; type?: string | undefined };
  try {
    metadata = z.object({ title: z.string().trim().min(1), description: z.string().trim().min(1),
      type: z.string().optional(), timestamp: z.string().optional(), tags: z.array(z.string()).optional(),
      resource: z.string().optional(), deprecated: z.boolean().optional() }).strict().parse(header ? YAML.parse(header[1]!) : null);
  } catch (error) {
    throw articleError(task, files.content.path, `Use reader-facing article frontmatter with title and description; no source, Indexer or process fields. ${error instanceof Error ? error.message : String(error)}`);
  }
  const expectedType = okfTypeForKnowledgePath(task.path);
  if (metadata.type !== undefined && metadata.type !== expectedType) {
    throw articleError(task, files.content.path, `Article type must be ${expectedType} for ${collection}; correct the frontmatter type or omit it to use the collection default.`);
  }
  let fragments: ReturnType<typeof approvedContextSectionsInMarkdown>;
  try { fragments = approvedContextSectionsInMarkdown(markdown); }
  catch (error) { throw articleError(task, files.content.path, error instanceof Error ? error.message : String(error)); }
  if (!fragments.length || new Set(fragments.map(fragment => fragment.id)).size !== fragments.length) {
    throw articleError(task, files.content.path, "Article requires unique stable fragment markers.");
  }
  let declared: z.infer<typeof productionReferencesSchema>;
  try { declared = productionReferencesSchema.parse(YAML.parse(files.references.text)); }
  catch (error) { throw articleError(task, files.references.path, `Invalid fragment references: ${error instanceof Error ? error.message : String(error)}`); }
  const byId = new Map(declared.sections.map(section => [section.id, section.references]));
  if (byId.size !== declared.sections.length || byId.size !== fragments.length || fragments.some(fragment => !byId.has(fragment.id))) {
    throw articleError(task, files.references.path, "Reference sections must match the article's fragment identities exactly, without duplicates.");
  }
  // Report all oversized fragments together before reading source bodies.
  // Duplicate declarations of the same region still count only once.
  const oversized = declared.sections.flatMap(section => {
    const count = new Set(section.references.map(ref => indexerProtocolDigest({
      source_ref: ref.source_ref, locator: ref.locator,
    }))).size;
    return count > 3 ? [`${section.id}: ${count} distinct source regions (maximum 3)`] : [];
  });
  if (oversized.length) throw articleError(task, files.references.path,
    `Split the claims or choose sufficient references for these fragments: ${oversized.join("; ")}.`);
  const read = input.sourceReader ?? await registeredArticleSourceReader(input.projectRoot);
  const allowed = new Set(task.sources.map(source => source.scope));
  const sections = [];
  for (const fragment of fragments) {
    const references = [];
    for (const ref of byId.get(fragment.id)!) {
      try {
        if (!allowed.has(ref.source_ref)) throw new TypeError(`Source is outside this task's authorized inputs: ${ref.source_ref}`);
        const text = await read(ref.source_ref, ref.locator.path, true);
        const reference = createArticleSourceReference(ref.source_ref, ref.locator, text);
        const previous = retained?.get(fragment.id)?.find(value => value.source_ref === ref.source_ref &&
          indexerProtocolDigest(value.locator) === indexerProtocolDigest(ref.locator));
        if (previous?.content_digest && previous.content_digest !== reference.content_digest) {
          throw new TypeError("Retained source text changed. Read it and explicitly revise this fragment's references; a body-only edit cannot confirm changed evidence.");
        }
        rememberArticleRegion(input.projectRoot, reference, text);
        references.push(reference);
      } catch (error) {
        throw articleError(task, files.references.path, error instanceof Error ? error.message : String(error), fragment.id);
      }
    }
    let unique;
    try { unique = articleFragmentReferences(references); }
    catch { throw articleError(task, files.references.path, "A fragment cites more than three distinct source regions; split the claim or choose sufficient references.", fragment.id); }
    sections.push({ section_ref: `${task.article_id}#${fragment.id}`, section_key: fragment.id,
      references: unique, markdown: fragment.readerVisibleBody, markdown_digest: indexerProtocolDigest(fragment.readerVisibleBody) });
  }
  const fingerprint = indexerProtocolDigest({ input: task.input, markdown, sections });
  return parseCandidateRecord({
    candidate_id: indexerCandidateId(fingerprint), article_id: task.article_id, collection,
    status: "draft", candidate_type: "indexer-artifact", kind: "content",
    visibility: input.visibility ?? "public", module: "production", path: task.path,
    structure_digest: task.input, source_refs: [...new Set(sections.flatMap(section => section.references.map(ref => ref.source_ref)))],
    body: markdown, fingerprint,
    indexer_candidate: { compile_digest: task.input, file_digest: fingerprint, artifact_ref: task.article_id,
      section_refs: sections.map(section => section.section_ref), sections },
    approved_revision: { request_digest: task.input, base_digest: input.approvedBaseDigest },
    review: { title: metadata.title, summary: metadata.description, signals: ["article-production"], reason: task.question },
    updated: new Date().toISOString(),
  }, 1);
}
