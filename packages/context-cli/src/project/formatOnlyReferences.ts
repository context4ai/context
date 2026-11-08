import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { articleSourceRegion, articleSourceRegionDigest, indexerProtocolDigest, validateArticleStructureEntries,
  type ArticleStructureEntry, type ProcessedScope } from "@c4a/context";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { articleReferenceHistoryReader, createArticleReferenceObserver } from "./articleReferenceObservation.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { approveFormatOnlyUpdate, type FormatReferenceChange } from "./formatOnlyUpdate.js";
import { hunks, mapReferenceRange, type Hunk } from "./referenceRangeMap.js";
import { markSubmissionState } from "./submissionState.js";

export interface FormatOnlyProposal {
  source_ref: string;
  changes: Array<FormatReferenceChange & { before_text: string; after_text: string; file_digest: string }>;
}
export async function proposeFormatOnlyReferences(root: string, articles: readonly ArticleStructureEntry[], scopes: readonly ProcessedScope[], previous: readonly ProcessedScope[]): Promise<FormatOnlyProposal[]> {
  const read = await registeredArticleSourceReader(root);
  const observe = createArticleReferenceObserver(read), history = articleReferenceHistoryReader(root, previous);
  const diffs = new Map<string, Promise<Hunk[]>>();
  const proposals: FormatOnlyProposal[] = [];
  for (const source of [...new Set(scopes.map(scope => scope.source_ref).filter(source => source.startsWith("lark:")))]) {
    const proposal: FormatOnlyProposal = { source_ref: source, changes: [] };
    let available = true;
    for (const article of articles) for (const section of article.sections) for (const reference of section.references) {
      if (reference.source_ref !== source) continue;
      const observed = await observe(reference);
      if (observed.state === "current" || observed.state === "moved") continue;
      if (observed.state !== "not-found") { available = false; continue; }
      const old = await history(reference);
      if (!old?.text) { available = false; continue; }
      const current = await read(source, reference.locator.path, true);
      const key = indexerProtocolDigest([old.text, current]);
      if (!diffs.has(key)) diffs.set(key, hunks(root, old.text, current));
      const locator = mapReferenceRange(reference.locator, await diffs.get(key)!);
      if (!locator) { available = false; continue; }
      try {
        const after = { ...reference, locator, content_digest: articleSourceRegionDigest(current, locator) };
        proposal.changes.push({ article: article.path, section: section.id, before: reference, after,
          before_text: old.region, after_text: articleSourceRegion(current, locator), file_digest: indexerProtocolDigest(current) });
      } catch { available = false; }
    }
    if (available && proposal.changes.length) proposals.push(proposal);
  }
  return proposals;
}

export async function applyFormatOnlyReferences(root: string, proposals: readonly FormatOnlyProposal[], decisions: readonly { source_ref: string; reason: string }[], scopes: readonly ProcessedScope[]) {
  if (!decisions.length) return;
  if (new Set(decisions.map(item => item.source_ref)).size !== decisions.length) throw new TypeError("A document may have only one format-only decision.");
  const path = join(root, "knowledge/structure.yaml");
  const before = await readFile(path, "utf8"), parsed = YAML.parse(before);
  const articles = validateArticleStructureEntries(parsed.articles ?? []);
  const original = structuredClone(articles);
  const read = await registeredArticleSourceReader(root);
  for (const decision of decisions) {
    const proposal = proposals.find(item => item.source_ref === decision.source_ref);
    if (!proposal || !decision.reason.trim()) throw new TypeError("Use a current format-only proposal and provide a semantic reason, or choose normal revision.");
    for (const change of proposal.changes) {
      const text = await read(change.before.source_ref, change.before.locator.path, true);
      if (indexerProtocolDigest(text) !== change.file_digest || articleSourceRegionDigest(text, change.after.locator) !== change.after.content_digest) throw new TypeError("The proposed source changed; refresh the update before applying a format-only decision.");
      const section = articles.find(article => article.path === change.article)?.sections.find(section => section.id === change.section);
      const index = section?.references.findIndex(reference => indexerProtocolDigest(reference) === indexerProtocolDigest(change.before));
      if (index !== undefined && index >= 0) section!.references[index] = change.after;
      // A previous attempt may have atomically saved the references before its
      // disposable approval or task cleanup failed. Only this exact validated
      // after-state permits retrying the same proposal.
      else if (!section?.references.some(reference => indexerProtocolDigest(reference) === indexerProtocolDigest(change.after))) {
        throw new TypeError("The proposed citation changed; refresh the update before applying a format-only decision.");
      }
    }
  }
  const { approvedStructureInputHashFor } = await import("./close.js");
  if (parsed.input_hash === await approvedStructureInputHashFor(root, original)) parsed.input_hash = await approvedStructureInputHashFor(root, articles);
  // A second read rejects external edits even if they do not use Context's lock.
  if (await readFile(path, "utf8") !== before) throw new TypeError("Knowledge structure changed while evaluating format-only decisions.");
  const content = YAML.stringify({ ...parsed, articles });
  if (content !== before) await atomicWriteFile(path, content);
  markSubmissionState("committed");
  for (const decision of decisions) await approveFormatOnlyUpdate(root, { source: decision.source_ref, reason: decision.reason,
    references: proposals.find(item => item.source_ref === decision.source_ref)!.changes, scopes });
}
