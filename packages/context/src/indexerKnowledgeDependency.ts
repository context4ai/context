import { z } from "zod";
import { compareIndexerCanonicalText, indexerCanonicalRefSchema, indexerDigestSchema, indexerProtocolDigest } from "./indexerProtocolCommon.js";

/** Supporting knowledge is referenced by identity, never copied into the
 * primary inventory ownership of a second topic. */
export const indexerKnowledgeDependencySchema = z.object({
  artifact_ref: indexerCanonicalRefSchema,
  section_refs: z.array(indexerCanonicalRefSchema).default([]),
  required: z.boolean().default(true),
}).strict();

export type IndexerKnowledgeDependency = z.infer<typeof indexerKnowledgeDependencySchema>;

export interface IndexerKnowledgeDependencyNode {
  artifact_ref: string;
  dependencies: readonly IndexerKnowledgeDependency[];
}

export class IndexerKnowledgeDependencyCycleError extends TypeError {
  constructor(readonly artifact_refs: readonly string[]) {
    super(`Knowledge dependency cycle: ${artifact_refs.join(" -> ")}. Revise the Partition dependency plan.`);
    this.name = "IndexerKnowledgeDependencyCycleError";
  }
}

/** Missing dependencies may be produced later. Cycles cannot become ready by
 * waiting, so reject them before any Author is scheduled. */
export function validateIndexerKnowledgeDependencyGraph(nodes: readonly IndexerKnowledgeDependencyNode[]): void {
  const graph = new Map<string, readonly IndexerKnowledgeDependency[]>();
  for (const node of nodes) {
    indexerCanonicalRefSchema.parse(node.artifact_ref);
    if (graph.has(node.artifact_ref)) throw new TypeError(`Knowledge article has duplicate responsibility: ${node.artifact_ref}`);
    const dependencies = node.dependencies.map(dependency => indexerKnowledgeDependencySchema.parse(dependency));
    if (new Set(dependencies.map(dependency => dependency.artifact_ref)).size !== dependencies.length) {
      throw new TypeError(`Knowledge article repeats a dependency: ${node.artifact_ref}`);
    }
    if (dependencies.some(dependency => new Set(dependency.section_refs).size !== dependency.section_refs.length)) {
      throw new TypeError(`Knowledge article repeats a supporting section: ${node.artifact_ref}`);
    }
    graph.set(node.artifact_ref, dependencies);
  }
  const complete = new Set<string>();
  const active = new Set<string>();
  const visit = (ref: string, trail: string[]): void => {
    if (active.has(ref)) throw new IndexerKnowledgeDependencyCycleError([...trail.slice(trail.indexOf(ref)), ref]);
    if (complete.has(ref)) return;
    active.add(ref);
    for (const dependency of graph.get(ref) ?? []) visit(dependency.artifact_ref, [...trail, ref]);
    active.delete(ref);
    complete.add(ref);
  };
  for (const ref of graph.keys()) visit(ref, []);
}

export const indexerKnowledgeDependencyVersionSchema = z.object({
  artifact_ref: indexerCanonicalRefSchema,
  approved_content_digest: indexerDigestSchema,
  projection_digest: indexerDigestSchema,
}).strict();

export type IndexerKnowledgeDependencyVersion = z.infer<typeof indexerKnowledgeDependencyVersionSchema>;

export function indexerKnowledgeDependencyFingerprint(versions: readonly IndexerKnowledgeDependencyVersion[]): string {
  const parsed = versions.map(version => indexerKnowledgeDependencyVersionSchema.parse(version));
  if (new Set(parsed.map(version => version.artifact_ref)).size !== parsed.length) {
    throw new TypeError("Knowledge dependency versions repeat an article");
  }
  return indexerProtocolDigest(parsed.sort((left, right) => compareIndexerCanonicalText(left.artifact_ref, right.artifact_ref)));
}

/** A changed or removed dependency invalidates transitive readers as well.
 * This returns identities for the existing update flow, not another queue. */
export function impactedIndexerKnowledgeArticles(
  nodes: readonly IndexerKnowledgeDependencyNode[], changed: ReadonlySet<string>,
): string[] {
  validateIndexerKnowledgeDependencyGraph(nodes);
  const reverse = new Map<string, Set<string>>();
  for (const node of nodes) for (const dependency of node.dependencies) {
    const readers = reverse.get(dependency.artifact_ref) ?? new Set<string>();
    readers.add(node.artifact_ref);
    reverse.set(dependency.artifact_ref, readers);
  }
  const impacted = new Set(changed);
  const queue = [...changed];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const reader of reverse.get(queue[cursor]!) ?? []) {
      if (impacted.has(reader)) continue;
      impacted.add(reader);
      queue.push(reader);
    }
  }
  return [...impacted].filter(ref => !changed.has(ref)).sort();
}
