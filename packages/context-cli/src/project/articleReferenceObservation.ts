import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, relative, resolve } from "node:path";
import { articleSourceRegion, articleSourceRegionDigest, indexerProtocolDigest, loadSourcesRegistry,
  type ArticleSourceReference, type ProcessedScope } from "@c4a/context";
import { readArticleRegionBaseline } from "./articleRegionBaselines.js";
import { registeredRepoHistoryReader } from "./articleSourceReader.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { commandGitObjectReader, SourceReadError, SourceUnavailableError } from "./gitObjectReader.js";
import { hunks, mapReferenceRange } from "./referenceRangeMap.js";

/** Unavailable reasons that describe this machine (a download or commit not yet local), not the source. */
export const LOCAL_SOURCE_REASONS: Readonly<Record<string, string>> = {
  "source-content-missing": "The cited file contents are not downloaded in the source checkout.",
  "source-history-missing": "The registered commit is not in the source checkout.",
};

export type ReferenceState = "current" | "moved" | "ambiguous" | "not-found" | "unavailable";
export type SourceRead = ((sourceRef: string, path: string, captured: boolean) => Promise<string>) & {
  incomplete?: (sourceRef: string) => Promise<boolean>;
};
export type ReferenceObservation = { state: ReferenceState; reference: ArticleSourceReference; reason?: string };
const hashRegion = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** Observation only. Each file/window length is scanned once, with exactly the
 * SDK signing rules. History is not needed to prove an unchanged region. */
export function createArticleReferenceObserver(read: SourceRead) {
  const indices = new Map<string, Map<number, Map<string, number | null>>>();
  return async (reference: ArticleSourceReference): Promise<ReferenceObservation> => {
    let text: string;
    try { text = await read(reference.source_ref, reference.locator.path, true); }
    catch (error) {
      if (error instanceof SourceReadError) throw error;
      if (error instanceof SourceUnavailableError) return { state: "unavailable", reference, reason: String(error.detail?.reason_code ?? "source-unavailable") };
      throw error;
    }
    try {
      if (articleSourceRegionDigest(text, reference.locator) === reference.content_digest) return { state: "current", reference };
    } catch (error) { if (!(error instanceof RangeError)) throw error; }
    const length = reference.locator.end_line - reference.locator.start_line + 1;
    let lengths = indices.get(text);
    if (!lengths) { lengths = new Map(); indices.set(text, lengths); }
    let positions = lengths.get(length);
    if (!positions) {
      positions = new Map();
      const lines = text.replace(/\r\n/gu, "\n").split("\n");
      for (let start = 0; start + length <= lines.length; start++) {
        const digest = hashRegion(lines.slice(start, start + length).join("\n"));
        positions.set(digest, positions.has(digest) ? null : start + 1);
      }
      lengths.set(length, positions);
    }
    const start = positions.get(reference.content_digest);
    if (start === null) return { state: "ambiguous", reference, reason: "multiple-matching-regions" };
    if (start !== undefined) return { state: "moved", reference: { ...reference,
      locator: { ...reference.locator, start_line: start, end_line: start + length - 1 } } };
    if (await read.incomplete?.(reference.source_ref)) return { state: "unavailable", reference, reason: "source-capture-incomplete" };
    return { state: "not-found", reference, reason: "region-not-found" };
  };
}

export interface ReferenceHistory { region: string; text?: string; commit?: string }
export const referenceEvidenceKey = (reference: ArticleSourceReference) => indexerProtocolDigest(reference);
export interface ReferenceEvidence {
  id: string;
  source_ref: string;
  path: string;
  history: { status: "available"; text: string; commit?: string; truncated?: true }
    | { status: "unavailable"; message: string };
  current: { status: "available" | "original-range-unavailable"; text: string; start_line: number; end_line: number;
    message: string; truncated?: true } | { status: "unavailable"; reason: string };
  /** Repository citations only: where the diff between the processed and the new commit moves the old lines. */
  suggested?: { start_line: number; end_line: number; text: string; truncated?: true;
    locator: { path: string; start_line: number; end_line: number } | { path: string; quote: string }; message: string };
}

export interface CitedRange { source_ref: string; path: string; start_line: number; end_line: number }

/** A diff mapping, never a semantic match. Submitting the line numbers of an earlier
 * citation means "keep that earlier evidence", so when the mapped lines equal any
 * earlier citation's lines in this file (its own included), suggest a unique quote
 * instead, or nothing when no unambiguous locator exists. */
export async function suggestedRange(root: string, reference: ArticleSourceReference, before: string, current: string,
  cited: readonly CitedRange[], clip: (text: string) => { text: string; truncated?: true } = text => ({ text })): Promise<ReferenceEvidence["suggested"]> {
  const mapped = mapReferenceRange(reference.locator, await hunks(root, before, current));
  if (!mapped) return undefined;
  const region = articleSourceRegion(current, mapped);
  const normalized = current.replace(/\r\n/gu, "\n");
  const collides = [reference.locator, ...cited.filter(item => item.source_ref === reference.source_ref && item.path === reference.locator.path)]
    .some(item => item.start_line === mapped.start_line && item.end_line === mapped.end_line);
  if (!collides) return { start_line: mapped.start_line, end_line: mapped.end_line, ...clip(region),
    locator: { path: mapped.path, start_line: mapped.start_line, end_line: mapped.end_line },
    message: "The source diff maps the old lines here. If this text still supports the section, cite this locator; it is checked again on submit." };
  const unique = region.trim() !== "" && normalized.indexOf(region) === normalized.lastIndexOf(region);
  if (!unique || region.length > 4_000) return undefined;
  return { start_line: mapped.start_line, end_line: mapped.end_line, ...clip(region), locator: { path: mapped.path, quote: region },
    message: "An earlier citation used these line numbers, and repeating them keeps that earlier evidence; to cite the new text here, use this quote locator." };
}

/** Deduplicated, bounded excerpts for semantic decisions. The current excerpt
 * is explicitly positional: only the separate diff proposal establishes a mapping. */
export async function collectReferenceEvidence(root: string, references: readonly ArticleSourceReference[], previous: readonly ProcessedScope[] = [],
  cited: readonly CitedRange[] = []): Promise<ReferenceEvidence[]> {
  const history = articleReferenceHistoryReader(root, previous);
  const read = await registeredArticleSourceReader(root);
  const clip = (text: string) => text.length <= 16_000 ? { text } : { text: text.slice(0, 16_000), truncated: true as const };
  return Promise.all([...new Map(references.map(reference => [referenceEvidenceKey(reference), reference])).entries()].map(async ([id, reference]) => {
    const before = await history(reference);
    const old: ReferenceEvidence["history"] = before
      ? { status: "available", ...clip(before.region), ...(before.commit ? { commit: before.commit } : {}) }
      : { status: "unavailable", message: "Historical evidence is unavailable: no local or bounded Git-history text matched the signed digest." };
    let current: ReferenceEvidence["current"];
    let suggested: ReferenceEvidence["suggested"];
    try {
      const text = await read(reference.source_ref, reference.locator.path, true);
      if (reference.source_ref.startsWith("repo:") && before?.text !== undefined) {
        suggested = await suggestedRange(root, reference, before.text, text, cited, clip).catch(() => undefined);
      }
      const lines = text.replace(/\r\n/gu, "\n").split("\n");
      const rangeExists = reference.locator.end_line <= lines.length;
      const length = reference.locator.end_line - reference.locator.start_line + 1;
      const start = rangeExists ? reference.locator.start_line : Math.max(1, Math.min(reference.locator.start_line, lines.length - length + 1));
      const end = Math.min(start + length - 1, lines.length);
      current = { status: rangeExists ? "available" : "original-range-unavailable", start_line: start, end_line: end,
        ...clip(lines.slice(start - 1, end).join("\n")), message: rangeExists
          ? "Current text at the old line range; this is not proof that the old citation maps here."
          : "The old line range no longer exists. This is a nearby current excerpt, not a mapped citation." };
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      current = { status: "unavailable", reason: String(error.detail?.reason_code ?? "source-unavailable") };
    }
    return { id, source_ref: reference.source_ref, path: reference.locator.path, history: old, current, ...(suggested ? { suggested } : {}) };
  }));
}
const exec = promisify(execFile);
/** Display evidence only: every candidate is checked against the signed digest.
 * A bounded search may fail, which never changes the citation's classification. */
export function articleReferenceHistoryReader(root: string, previous: readonly ProcessedScope[] = []) {
  // Loaded on first use: a reader that is never asked must not leave a rejected promise behind.
  let repoHistory: ReturnType<typeof registeredRepoHistoryReader> | undefined;
  const objects = commandGitObjectReader();
  let registry: ReturnType<typeof loadSourcesRegistry> | undefined;
  const logs = new Map<string, Promise<string[]>>();
  function verified(reference: ArticleSourceReference, text: string, commit?: string): ReferenceHistory | undefined {
    try {
      return articleSourceRegionDigest(text, reference.locator) === reference.content_digest
        ? { region: articleSourceRegion(text, reference.locator), text, ...(commit ? { commit } : {}) } : undefined;
    } catch { return undefined; }
  }
  return async (reference: ArticleSourceReference): Promise<ReferenceHistory | undefined> => {
    const baseline = readArticleRegionBaseline(root, reference.content_digest);
    const versions = previous.filter(scope => reference.source_ref === scope.source_ref || reference.source_ref.startsWith(`${scope.source_ref}#`));
    if (reference.source_ref.startsWith("repo:")) {
      for (const scope of versions) {
        try {
          const text = await (await (repoHistory ??= registeredRepoHistoryReader(root)))(reference.source_ref, reference.locator.path, scope.processed_version);
          const result = verified(reference, text, scope.processed_version);
          if (result) return result;
        } catch { /* Historical evidence is optional, unlike the current read. */ }
      }
      return baseline === undefined ? undefined : { region: baseline };
    }
    const [kind, name] = reference.source_ref.split(":", 2);
    const sources = await (registry ??= loadSourcesRegistry({ rootDir: root }));
    const entries = kind === "lark" ? sources.larks : kind === "file" ? sources.files : kind === "note" ? sources.notes : kind === "sessions" ? sources.sessions : [];
    const entry = entries.find(candidate => candidate.id === name || candidate.name === name);
    if (!entry) return baseline === undefined ? undefined : { region: baseline };
    const directory = kind === "note" || kind === "sessions" ? dirname(entry.materializedAt) : entry.materializedAt;
    const path = relative(resolve(root), resolve(root, directory, reference.locator.path)).split("\\").join("/");
    if (path.startsWith("../") || path === "..") return baseline === undefined ? undefined : { region: baseline };
    let commits = logs.get(path);
    if (!commits) {
      commits = exec("git", ["log", "-32", "--format=%H", "--", path], { cwd: root, timeout: 10_000, maxBuffer: 1024 * 1024 })
        .then(value => value.stdout.trim().split("\n").filter(Boolean), () => []);
      logs.set(path, commits);
    }
    for (const commit of await commits) {
      try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await objects.read(root, commit, path));
        const result = verified(reference, text, commit);
        if (result) return result;
      } catch { /* A shallow or uncommitted history need not contain this region. */ }
    }
    return baseline === undefined ? undefined : { region: baseline };
  };
}
