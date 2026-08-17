import { loadSourcesRegistry, type FileSourceRegistryEntry, type LarkSourceRegistryEntry } from "@c4a/context";
import {
  buildCommittedEvidenceIndex,
  readCommittedSnapshotMarkdown,
  resolveProseSourceRef,
  type BuildCommittedEvidenceIndexResult,
} from "./documentEvidenceIndex.js";
import { parseCanonicalProseRef, type ParsedCanonicalProseRef, type ReviewCandidateView } from "./reviewShared.js";

export interface ReviewSourceExcerpt {
  source_ref: string;
  status: "available" | "unavailable";
  locator?: string;
  line_range?: string;
  text?: string;
  message?: string;
}

export type ReviewSourceExcerptMap = Map<string, Map<string, ReviewSourceExcerpt>>;

type DocumentSourceEntry = Pick<FileSourceRegistryEntry | LarkSourceRegistryEntry, "id" | "name" | "materializedAt" | "snapshot">;

function sourceKey(parsed: ParsedCanonicalProseRef): string {
  return `${parsed.sourceType}:${parsed.sourceName}`;
}

function sourceEntryFor(
  registry: Awaited<ReturnType<typeof loadSourcesRegistry>>,
  parsed: ParsedCanonicalProseRef,
): DocumentSourceEntry | undefined {
  const entries = parsed.sourceType === "file" ? registry.files : registry.larks;
  return entries.find((entry) => entry.name === parsed.sourceName || entry.id === parsed.sourceName);
}

function stagedSnapshotHashFor(candidate: ReviewCandidateView, parsed: ParsedCanonicalProseRef): string | undefined {
  const source = candidate.record.source;
  if (
    source?.snapshot_hash !== undefined &&
    source.type === parsed.sourceType &&
    source.name === parsed.sourceName
  ) {
    return source.snapshot_hash;
  }
  return undefined;
}

function lineRangeText(markdown: string, lineStart: number, lineEnd: number): string {
  const lines = markdown.split(/\r?\n/u);
  return lines.slice(lineStart - 1, lineEnd).join("\n").trimEnd();
}

function unavailable(sourceRef: string, message: string): ReviewSourceExcerpt {
  return {
    source_ref: sourceRef,
    status: "unavailable",
    message,
  };
}

async function excerptForRef(input: {
  projectRoot: string;
  sourceRef: string;
  parsed: ParsedCanonicalProseRef;
  evidence: BuildCommittedEvidenceIndexResult;
}): Promise<ReviewSourceExcerpt> {
  const resolved = await resolveProseSourceRef({
    projectRoot: input.projectRoot,
    index: input.evidence.index,
    sourceRef: input.sourceRef,
    snapshotMarkdownCache: input.evidence.snapshotMarkdownCache,
  });
  if (resolved === null) {
    return unavailable(input.sourceRef, "source span could not be resolved from the committed snapshot");
  }
  const markdown = await readCommittedSnapshotMarkdown({
    projectRoot: input.projectRoot,
    index: input.evidence.index,
    path: resolved.span.document_path,
    cache: input.evidence.snapshotMarkdownCache,
  });
  return {
    source_ref: input.sourceRef,
    status: "available",
    locator: input.parsed.locator,
    line_range: resolved.span.line_range,
    text: lineRangeText(markdown, resolved.span.line_start, resolved.span.line_end),
  };
}

export async function collectReviewSourceExcerpts(
  projectRoot: string,
  candidates: readonly ReviewCandidateView[],
): Promise<ReviewSourceExcerptMap> {
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const sourceCache = new Map<string, Promise<BuildCommittedEvidenceIndexResult | null>>();
  const result: ReviewSourceExcerptMap = new Map();

  const evidenceFor = (parsed: ParsedCanonicalProseRef): Promise<BuildCommittedEvidenceIndexResult | null> => {
    const key = sourceKey(parsed);
    const existing = sourceCache.get(key);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      const entry = sourceEntryFor(registry, parsed);
      if (entry === undefined) return null;
      return buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: parsed.sourceType,
        sourceName: parsed.sourceName,
        materializedAt: entry.materializedAt,
        ...(entry.snapshot?.manifest !== undefined ? { manifestPath: entry.snapshot.manifest } : {}),
        writeRuntimeIndex: false,
      });
    })().catch(() => null);
    sourceCache.set(key, promise);
    return promise;
  };

  for (const candidate of candidates) {
    const byRef = new Map<string, ReviewSourceExcerpt>();
    const sectionRefs = candidate.record.sections?.flatMap((section) => [section.source_ref, ...(section.source_refs ?? [])]) ?? [];
    for (const sourceRef of new Set([...candidate.record.source_refs, ...sectionRefs])) {
      const parsed = parseCanonicalProseRef(sourceRef);
      if (parsed === null) continue;
      const evidence = await evidenceFor(parsed);
      if (evidence === null) {
        byRef.set(sourceRef, unavailable(sourceRef, "committed source snapshot is unavailable"));
        continue;
      }
      const stagedSnapshotHash = stagedSnapshotHashFor(candidate, parsed);
      if (stagedSnapshotHash !== undefined && evidence.index.snapshot_hash !== stagedSnapshotHash) {
        byRef.set(sourceRef, unavailable(sourceRef, "staged candidate snapshot is stale; rerun compileProse against the current snapshot"));
        continue;
      }
      byRef.set(sourceRef, await excerptForRef({
        projectRoot,
        sourceRef,
        parsed,
        evidence,
      }));
    }
    if (byRef.size > 0) result.set(candidate.record.candidate_id, byRef);
  }

  return result;
}
