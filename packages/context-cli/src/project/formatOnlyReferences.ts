import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { articleSourceRegion, articleSourceRegionDigest, indexerProtocolDigest, validateArticleStructureEntries,
  type ArticleSourceReference, type ArticleStructureEntry, type ProcessedScope } from "@c4a/context";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { articleReferenceHistoryReader, createArticleReferenceObserver } from "./articleReferenceObservation.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { approveFormatOnlyUpdate, type FormatReferenceChange } from "./formatOnlyUpdate.js";
import { markSubmissionState } from "./submissionState.js";

const exec = promisify(execFile);
export interface FormatOnlyProposal {
  source_ref: string;
  changes: Array<FormatReferenceChange & { before_text: string; after_text: string; file_digest: string }>;
}
interface Hunk { old: number; oldCount: number; next: number; nextCount: number }

async function hunks(root: string, before: string, after: string): Promise<Hunk[]> {
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
