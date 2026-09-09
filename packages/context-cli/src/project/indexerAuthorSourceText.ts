import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  buildIndexerAuthorizedWorksetViewSource,
  loadSourcesRegistry,
  type IndexerAuthorDependencyView,
} from "@c4a/context";
import type { ProjectIndexerParserFactsSourceBinding } from "./indexerMainSourceAdapter.js";
import { projectIndexerReadTargetAllows, projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";
import { selectIndexerAuthorFiles } from "./indexerAuthorFileSelection.js";

// Bound retained source text in memory independently of soft batch packing
// targets. One approved task can be larger than the target for combining tasks.
export const INDEXER_AUTHOR_SOURCE_TEXT_MAX_BYTES = 5 * 1024 * 1024;

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

/** Read one selected file once. Lightweight catalogs authorize file reading:
 * their token/selector anchors are not complete declaration ranges. */
export async function readIndexerAuthorSourceText(input: {
  source_root: string;
  path: string;
  content_digest: string;
  spans: readonly SourceSpan[];
  max_bytes: number;
  whole_file?: boolean;
}): Promise<{ spans: TextRange[]; bytes: number; line_count: number }> {
  if (input.spans.length === 0) return { spans: [], bytes: 0, line_count: 0 };
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
  const ranges = input.whole_file ? [{
    start_line: 1, end_line: Number.MAX_SAFE_INTEGER,
    source_span_refs: [...new Set(input.spans.map((span) => span.node_ref))].sort(), text: "",
  }] : mergedRanges(input.spans);
  const pieces = ranges.map(() => [] as string[]);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const hash = createHash("sha256");
  let line = 1;
  let hasText = false;
  let endsWithNewline = false;
  let rangeIndex = 0;
  let bytes = 0;
  const consume = (text: string) => {
    if (text.length) { hasText = true; endsWithNewline = text.endsWith("\n"); }
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
          throw new TypeError(`Author source text for ${input.path} exceeds the source memory safety limit (${input.max_bytes} bytes remaining); reduce the selected source ranges before retrying`);
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
  // Parser facts can outlive a source refresh. Do not turn that stale locator
  // into a workflow stop: preserve the bytes that still exist, clamp a range
  // that overlaps the file, and omit a range that starts after EOF. Path and
  // digest checks above remain hard guards; this is only mechanical recovery
  // for an outdated line coordinate.
  const repaired = ranges.flatMap((range, index) => {
    if (range.start_line > line) return [];
    return [{
      ...range,
      end_line: Math.min(range.end_line, line),
      text: pieces[index]!.join(""),
    }];
  });
  return { spans: repaired, bytes, line_count: hasText ? line - (endsWithNewline ? 1 : 0) : 0 };
}

/** Temporary Author View content, not a new evidence identity or durable artifact. */
export async function buildProjectIndexerAuthorSourceText(input: {
  projectRoot: string;
  request: unknown;
  indexer_id: string;
  registry?: unknown;
  binding: ProjectIndexerParserFactsSourceBinding;
  dependency_view: IndexerAuthorDependencyView;
  author_member_ids?: readonly string[];
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
  const materialPaths = input.author_member_ids === undefined ? undefined : selectIndexerAuthorFiles({
    files: binding.parser_fact_view.files,
    member_ids: new Set(input.author_member_ids),
    requested_paths: new Set(input.dependency_view.positive_nodes.flatMap((node) =>
      node.kind === "source-span" && node.source_ref === binding.source_ref &&
        node.module_ref === binding.module_ref && node.targets.length > 0 ? [node.locator.path] : [])),
  });
  const items = [];
  items.push({
    ref: `source-access:${binding.source_ref}`, category: "source-access",
    provenance: { protocol: input.dependency_view.protocol, digest: input.dependency_view.view_digest },
    value: {
      source_ref: binding.source_ref, module_ref: binding.module_ref,
      captured_root: resolve(input.projectRoot, source.materializedAt),
      paths: [...spansByPath.keys()].sort(),
    },
  });
  let remaining = INDEXER_AUTHOR_SOURCE_TEXT_MAX_BYTES;
  for (const [path, spans] of [...spansByPath].sort(([a], [b]) => a.localeCompare(b))) {
    if (materialPaths !== undefined && !materialPaths.has(path)) continue;
    const identity = identities.get(path);
    const descriptor = descriptors.get(path);
    if (identity === undefined || descriptor === undefined) throw new TypeError("Author source is absent from its selected Parser slice");
    // Unsupported/binary catalog members remain dispositions, not new text channels.
    if (descriptor.disposition !== "analyzed") continue;
    const text = await readIndexerAuthorSourceText({
      source_root: join(input.projectRoot, source.materializedAt), path,
      content_digest: identity.content_digest, spans, max_bytes: remaining,
      // Style facts are lightweight token/selector identities. Their locators
      // do not delimit the surrounding mixins, defaults or cascade context.
      // Use the existing selected file only; never follow its imports here.
      whole_file: descriptor.facts.some((fact) => fact.kind.startsWith("style-")),
    });
    remaining -= text.bytes;
    items.push({
      ref: `source-text:${descriptor.file_ref}`, category: "source-text",
      provenance: { protocol: input.dependency_view.protocol, digest: input.dependency_view.view_digest, container_ref: descriptor.file_ref },
      value: { source_ref: binding.source_ref, module_ref: binding.module_ref, path,
        read_path: resolve(input.projectRoot, source.materializedAt, path), line_count: text.line_count, spans: text.spans },
    });
  }
  return buildIndexerAuthorizedWorksetViewSource({
    request: input.request, projection_kind: "author-source-text",
    input_digests: [input.dependency_view.view_digest], items,
  });
}
