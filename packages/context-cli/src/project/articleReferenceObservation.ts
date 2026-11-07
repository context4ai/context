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
}
/** Deduplicated, bounded excerpts for semantic decisions. The current excerpt
 * is explicitly positional: only the separate diff proposal establishes a mapping. */
export async function collectReferenceEvidence(root: string, references: readonly ArticleSourceReference[], previous: readonly ProcessedScope[] = []): Promise<ReferenceEvidence[]> {
  const history = articleReferenceHistoryReader(root, previous);
  const read = await registeredArticleSourceReader(root);
  const clip = (text: string) => text.length <= 16_000 ? { text } : { text: text.slice(0, 16_000), truncated: true as const };
  return Promise.all([...new Map(references.map(reference => [referenceEvidenceKey(reference), reference])).entries()].map(async ([id, reference]) => {
    const before = await history(reference);
    const old: ReferenceEvidence["history"] = before
      ? { status: "available", ...clip(before.region), ...(before.commit ? { commit: before.commit } : {}) }
      : { status: "unavailable", message: "Historical evidence is unavailable: no local or bounded Git-history text matched the signed digest." };
    let current: ReferenceEvidence["current"];
    try {
      const text = await read(reference.source_ref, reference.locator.path, true);
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
    return { id, source_ref: reference.source_ref, path: reference.locator.path, history: old, current };
  }));
}
const exec = promisify(execFile);
/** Display evidence only: every candidate is checked against the signed digest.
 * A bounded search may fail, which never changes the citation's classification. */
export function articleReferenceHistoryReader(root: string, previous: readonly ProcessedScope[] = []) {
  const repoHistory = registeredRepoHistoryReader(root);
  const objects = commandGitObjectReader();
  const registry = loadSourcesRegistry({ rootDir: root });
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
          const text = await (await repoHistory)(reference.source_ref, reference.locator.path, scope.processed_version);
          const result = verified(reference, text, scope.processed_version);
          if (result) return result;
        } catch { /* Historical evidence is optional, unlike the current read. */ }
      }
      return baseline === undefined ? undefined : { region: baseline };
    }
    const [kind, name] = reference.source_ref.split(":", 2);
    const sources = await registry;
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
