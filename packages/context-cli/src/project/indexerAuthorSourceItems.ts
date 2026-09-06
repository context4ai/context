import {
  indexerEvidenceBindingDigest,
  type IndexerAuthorDependencyView,
  type IndexerAuthorizedWorksetView,
  type IndexerArtifactResult,
} from "@c4a/context";

type SourceSpan = Extract<IndexerAuthorDependencyView["positive_nodes"][number], { kind: "source-span" }>;
type IndexerEvidenceBinding = IndexerArtifactResult["evidence_bindings"][number];
export interface AuthorSourceItem {
  ref: string;
  path: string;
  source_ref: string;
  ranges: { start_line: number; end_line: number }[];
  evidence_refs: string[];
}

/** The displayed source choices and semantic submission use this same resolver.
 * A materialized text item can contain several authorized spans. It denotes
 * their union, never an arbitrary first span or an entire registered repository.
 */
export function buildIndexerAuthorSourceItems(input: {
  nodes: readonly IndexerAuthorDependencyView["positive_nodes"][number][];
  view: IndexerAuthorizedWorksetView;
}) {
  const spans = input.nodes.filter((node): node is SourceSpan => node.kind === "source-span");
  const byNode = new Map(spans.map((node) => [node.node_ref, node]));
  const bindings = new Map<string, IndexerEvidenceBinding>();
  const aliases = new Map<string, readonly string[]>();
  const ambiguous = new Set<string>();
  const choices: AuthorSourceItem[] = [];
  const documents = new Set(input.view.items.filter((item) => item.category === "document")
    .map((item) => (item.value as { path?: string }).path));
  const register = (ref: string, nodes: readonly SourceSpan[]) => {
    const refs = [...new Set(nodes.map((node) => node.evidence_ref))].sort();
    const previous = aliases.get(ref);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(refs)) ambiguous.add(ref);
    else if (refs.length > 0) aliases.set(ref, refs);
  };
  for (const node of spans) {
    const payload = {
      evidence_ref: node.evidence_ref,
      kind: documents.has(node.locator.path) ? "documentation" as const : "code" as const,
      source_ref: node.source_ref, module_ref: node.module_ref, locator: node.locator,
      content_digest: node.content_digest,
      coverage_tier: documents.has(node.locator.path) ? "lightweight-evidence" as const : "ast-catalog" as const,
    };
    bindings.set(node.evidence_ref, { ...payload, binding_digest: indexerEvidenceBindingDigest(payload) });
    register(node.evidence_ref, [node]);
    register(node.node_ref, [node]);
    // Bare paths are accepted only when they identify one exact source span.
    register(node.locator.path, [node]);
  }
  const covered = new Set<string>();
  for (const item of input.view.items) {
    if (item.category !== "source-text" && item.category !== "document") continue;
    const value = item.value as {
      path?: string; source_path?: string; source_ref?: string; module_ref?: string | null;
      spans?: { source_span_refs: string[]; start_line: number; end_line: number }[];
    };
    if (typeof value.path !== "string") continue;
    const selected = item.category === "source-text"
      ? (value.spans ?? []).flatMap((range) => range.source_span_refs.map((ref) => {
          const node = byNode.get(ref);
          if (node === undefined || node.locator.path !== value.path ||
              node.source_ref !== value.source_ref || node.module_ref !== value.module_ref ||
              node.locator.start_line < range.start_line || node.locator.end_line > range.end_line) {
            throw new TypeError(`source text ${item.ref} does not match its authorized spans`);
          }
          return node;
        }))
      : spans.filter((node) => node.locator.path === value.path &&
          node.source_ref === (value.source_ref ?? input.view.source_ref));
    if (selected.length === 0) continue;
    register(item.ref, selected);
    if (item.category === "document" && value.source_path) register(value.source_path, selected);
    const unique = [...new Map(selected.map((node) => [node.node_ref, node])).values()];
    unique.forEach((node) => covered.add(node.node_ref));
    choices.push({
      ref: item.ref, path: value.path, source_ref: unique[0]!.source_ref,
      ranges: item.category === "source-text"
        ? (value.spans ?? []).map(({ start_line, end_line }) => ({ start_line, end_line }))
        : unique.map((node) => ({ start_line: node.locator.start_line, end_line: node.locator.end_line })),
      evidence_refs: [...new Set(unique.map((node) => node.evidence_ref))].sort(),
    });
  }
  for (const node of spans) {
    if (covered.has(node.node_ref)) continue;
    choices.push({ ref: node.node_ref, path: node.locator.path, source_ref: node.source_ref,
      ranges: [{ start_line: node.locator.start_line, end_line: node.locator.end_line }],
      evidence_refs: [node.evidence_ref] });
  }
  ambiguous.forEach((ref) => aliases.delete(ref));
  return { bindings, aliases, choices };
}

export function resolveIndexerAuthorSourceItems(
  index: ReturnType<typeof buildIndexerAuthorSourceItems>, refs: readonly string[], label: string,
): string[] {
  return [...new Set(refs.flatMap((ref) => {
    const resolved = index.aliases.get(ref);
    if (resolved === undefined) {
      throw new TypeError(`${label} is not authorized: ${ref}. Use source_items from the current task's Source material; use fact references in facts, not source_items.`);
    }
    return resolved;
  }))].sort();
}
