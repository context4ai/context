import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  buildIndexerAuthorizedWorksetViewSource,
  loadIndexerRegistry,
  loadSourcesRegistry,
  type IndexerAuthorDependencyView,
} from "@c4a/context";
import type { ProjectIndexerParserFactsSourceBinding } from "./indexerMainSourceAdapter.js";
import { indexerBatchStagePolicy } from "./indexerCurrentBatchPlanner.js";
import { projectIndexerReadTargetAllows, projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";

type SourceSpan = Extract<IndexerAuthorDependencyView["positive_nodes"][number], { kind: "source-span" }>;
type TextRange = {
  start_line: number;
  end_line: number;
  source_span_refs: string[];
  text: string;
};

function mergedRanges(spans: readonly SourceSpan[]): TextRange[] {
  const ranges: TextRange[] = [];
  for (const span of [...spans].sort((a, b) =>
    a.locator.start_line - b.locator.start_line || a.locator.end_line - b.locator.end_line ||
    a.node_ref.localeCompare(b.node_ref)
  )) {
    const previous = ranges.at(-1);
    if (previous !== undefined && span.locator.start_line <= previous.end_line + 1) {
      previous.end_line = Math.max(previous.end_line, span.locator.end_line);
      previous.source_span_refs.push(span.node_ref);
    } else {
      ranges.push({ ...span.locator, source_span_refs: [span.node_ref], text: "" });
    }
  }
  return ranges.map((range) => ({
    start_line: range.start_line, end_line: range.end_line,
    source_span_refs: [...new Set(range.source_span_refs)].sort(), text: "",
  }));
}

function assertInside(root: string, path: string): void {
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TypeError("Author source path escapes its registered source root");
  }
}

/** Read one selected file once; retain only the union of authorized line ranges. */
export async function readIndexerAuthorSourceText(input: {
  source_root: string;
  path: string;
  content_digest: string;
  spans: readonly SourceSpan[];
  max_bytes: number;
}): Promise<{ spans: TextRange[]; bytes: number }> {
  if (input.spans.length === 0) return { spans: [], bytes: 0 };
  for (const span of input.spans) {
    if (span.locator.path !== input.path || span.content_digest !== input.content_digest) {
      throw new TypeError("Author source span does not match its current file identity");
    }
  }
  const root = await realpath(input.source_root);
  const lexical = resolve(root, input.path);
  assertInside(root, lexical);
  const path = await realpath(lexical);
  assertInside(root, path);
  if (!(await stat(path)).isFile()) throw new TypeError("Author source must be a regular file");
  const ranges = mergedRanges(input.spans);
  const pieces = ranges.map(() => [] as string[]);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const hash = createHash("sha256");
  let line = 1;
  let rangeIndex = 0;
  let bytes = 0;
  const consume = (text: string) => {
    if (text.includes("\0")) throw new TypeError("Author source is not UTF-8 text");
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf("\n", start);
      const end = newline === -1 ? text.length : newline + 1;
      while (ranges[rangeIndex] !== undefined && ranges[rangeIndex]!.end_line < line) rangeIndex += 1;
      const range = ranges[rangeIndex];
      if (range !== undefined && range.start_line <= line) {
        const piece = text.slice(start, end);
        bytes += Buffer.byteLength(piece, "utf8");
        if (bytes > input.max_bytes) {
          throw new TypeError("Author source text exceeds the current batch input budget; revise the semantic Partition before retrying");
        }
        pieces[rangeIndex]!.push(piece);
      }
      if (newline !== -1) line += 1;
      start = end;
    }
  };
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    consume(decoder.decode(chunk as Buffer, { stream: true }));
  }
  consume(decoder.decode());
  if (`sha256:${hash.digest("hex")}` !== input.content_digest) {
    throw new TypeError("Author source changed since Parser extraction; refresh the registered source and retry the current lifecycle");
  }
  if (ranges.some((range) => range.end_line > line)) {
    throw new TypeError("Author source range is outside its pinned file; refresh Parser facts before retrying");
  }
  return { spans: ranges.map((range, index) => ({ ...range, text: pieces[index]!.join("") })), bytes };
}

/** Temporary Author View content, not a new evidence identity or durable artifact. */
export async function buildProjectIndexerAuthorSourceText(input: {
  projectRoot: string;
  request: unknown;
  indexer_id: string;
  registry?: unknown;
  binding: ProjectIndexerParserFactsSourceBinding;
  dependency_view: IndexerAuthorDependencyView;
}) {
  const registry = input.registry ?? (await loadIndexerRegistry(input.projectRoot)).registry;
  const binding = input.binding;
  if (!projectIndexerReadTargetAllows({
    targets: projectIndexerReadTargets({ registry, indexer_id: input.indexer_id }),
    source_ref: binding.source_ref, module_ref: binding.module_ref,
  })) throw new TypeError("Author source text is outside the Indexer read scope");
  const spansByPath = new Map<string, SourceSpan[]>();
  for (const node of input.dependency_view.positive_nodes) {
    if (node.kind !== "source-span" || node.source_ref !== binding.source_ref || node.module_ref !== binding.module_ref) continue;
    const spans = spansByPath.get(node.locator.path) ?? [];
    spans.push(node);
    spansByPath.set(node.locator.path, spans);
  }
  const sources = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const name = binding.source_ref.startsWith("repo:") ? binding.source_ref.slice(5) : null;
  const source = name === null ? undefined : sources.repos.find((item) => item.name === name || item.id === name);
  if (source === undefined) throw new TypeError(`Author uses an unknown registered repository: ${binding.source_ref}`);
  const identities = new Map(binding.source_identity_inventory.files.map((file) => [file.normalized_path, file]));
  const descriptors = new Map(binding.parser_fact_view.files.map((file) => [file.normalized_path, file]));
  const items = [];
  let remaining = indexerBatchStagePolicy("author").max_input_bytes;
  for (const [path, spans] of [...spansByPath].sort(([a], [b]) => a.localeCompare(b))) {
    const identity = identities.get(path);
    const descriptor = descriptors.get(path);
    if (identity === undefined || descriptor === undefined) throw new TypeError("Author source is absent from its selected Parser slice");
    // Unsupported/binary catalog members remain dispositions, not new text channels.
    if (descriptor.disposition !== "analyzed") continue;
    const text = await readIndexerAuthorSourceText({
      source_root: join(input.projectRoot, source.materializedAt), path,
      content_digest: identity.content_digest, spans, max_bytes: remaining,
    });
    remaining -= text.bytes;
    items.push({
      ref: `source-text:${descriptor.file_ref}`, category: "source-text",
      provenance: { protocol: input.dependency_view.protocol, digest: input.dependency_view.view_digest, container_ref: descriptor.file_ref },
      value: { source_ref: binding.source_ref, module_ref: binding.module_ref, path, spans: text.spans },
    });
  }
  return buildIndexerAuthorizedWorksetViewSource({
    request: input.request, projection_kind: "author-source-text",
    input_digests: [input.dependency_view.view_digest], items,
  });
}
