import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

export const indexerDependencyTargetSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("logical-unit") }).strict(),
  z.object({
    level: z.literal("artifact-kind"),
    artifact_kind: indexerIdSchema,
  }).strict(),
  z.object({
    level: z.literal("section"),
    artifact_kind: indexerIdSchema,
    section_key: indexerIdSchema,
  }).strict(),
]);

export type IndexerDependencyTarget = z.infer<typeof indexerDependencyTargetSchema>;

const dependencyTargetsSchema = z.array(indexerDependencyTargetSchema).min(1);
const locatorSchema = z.object({
  path: portableIndexerPathSchema,
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (value.end_line < value.start_line) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "end_line must not precede start_line",
      path: ["end_line"],
    });
  }
});

const sourceSpanNodeInputSchema = z.object({
  kind: z.literal("source-span"),
  evidence_ref: indexerCanonicalRefSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  locator: locatorSchema,
  content_digest: indexerDigestSchema,
  targets: z.array(indexerDependencyTargetSchema),
}).strict();

const selectedFactNodeInputSchema = z.object({
  kind: z.literal("selected-fact"),
  fact_ref: indexerCanonicalRefSchema,
  fact_digest: indexerDigestSchema,
  source_span_node_refs: z.array(indexerCanonicalRefSchema).min(1),
  targets: z.array(indexerDependencyTargetSchema),
}).strict();

const logicalUnitNodeInputSchema = z.object({
  kind: z.literal("logical-unit"),
  logical_unit_ref: indexerCanonicalRefSchema,
  group_projection_digest: indexerDigestSchema,
  targets: dependencyTargetsSchema,
}).strict();

const resourceNodeInputSchema = z.object({
  kind: z.enum(["template-policy-fragment", "contract-metric"]),
  target_ref: indexerCanonicalRefSchema,
  content_digest: indexerDigestSchema,
  targets: dependencyTargetsSchema,
}).strict();

export const indexerPositiveDependencyNodeInputSchema = z.union([
  sourceSpanNodeInputSchema,
  selectedFactNodeInputSchema,
  logicalUnitNodeInputSchema,
  resourceNodeInputSchema,
]);

export const indexerNegativeDependencyNodeInputSchema = z.object({
  kind: z.enum([
    "group-input-set",
    "directory-membership",
    "export-set",
    "route-set",
    "candidate-pool",
    "precedence-winner",
    "absence-assertion",
  ]),
  scope_ref: indexerCanonicalRefSchema,
  set_digest: indexerDigestSchema,
  targets: dependencyTargetsSchema,
}).strict();

export const indexerSourceSpanDependencyNodeSchema = sourceSpanNodeInputSchema.extend({
  node_ref: indexerCanonicalRefSchema,
}).strict();
export const indexerSelectedFactDependencyNodeSchema = selectedFactNodeInputSchema.extend({
  node_ref: indexerCanonicalRefSchema,
}).strict();
export const indexerLogicalUnitDependencyNodeSchema = logicalUnitNodeInputSchema.extend({
  node_ref: indexerCanonicalRefSchema,
}).strict();
export const indexerResourceDependencyNodeSchema = resourceNodeInputSchema.extend({
  node_ref: indexerCanonicalRefSchema,
}).strict();

export const indexerPositiveDependencyNodeSchema = z.union([
  indexerSourceSpanDependencyNodeSchema,
  indexerSelectedFactDependencyNodeSchema,
  indexerLogicalUnitDependencyNodeSchema,
  indexerResourceDependencyNodeSchema,
]);

export const indexerNegativeDependencyNodeSchema =
  indexerNegativeDependencyNodeInputSchema.extend({
    node_ref: indexerCanonicalRefSchema,
  }).strict();

export type IndexerPositiveDependencyNode = z.infer<
  typeof indexerPositiveDependencyNodeSchema
>;
export type IndexerNegativeDependencyNode = z.infer<
  typeof indexerNegativeDependencyNodeSchema
>;

const dependencyViewPayloadSchema = z.object({
  protocol: z.literal("context.indexer.author-dependency-view/v1"),
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  logical_unit_ref: indexerCanonicalRefSchema,
  positive_nodes: z.array(indexerPositiveDependencyNodeSchema).min(1),
  negative_nodes: z.array(indexerNegativeDependencyNodeSchema).min(1),
}).strict();

export const indexerAuthorDependencyViewSchema = dependencyViewPayloadSchema.extend({
  view_digest: indexerDigestSchema,
}).strict();

export type IndexerAuthorDependencyView = z.infer<
  typeof indexerAuthorDependencyViewSchema
>;

function targetIdentity(target: IndexerDependencyTarget): string {
  return target.level === "logical-unit"
    ? target.level
    : target.level === "artifact-kind"
    ? `${target.level}\u0000${target.artifact_kind}`
    : `${target.level}\u0000${target.artifact_kind}\u0000${target.section_key}`;
}

function canonicalTargets(
  values: readonly IndexerDependencyTarget[],
  field: string,
): IndexerDependencyTarget[] {
  const sorted = values.map((value) => indexerDependencyTargetSchema.parse(value))
    .sort((left, right) =>
      compareIndexerCanonicalText(targetIdentity(left), targetIdentity(right))
    );
  if (new Set(sorted.map(targetIdentity)).size !== sorted.length) {
    throw new TypeError(`${field} must contain unique dependency targets`);
  }
  return sorted;
}

function positiveNodeIdentity(
  node: z.infer<typeof indexerPositiveDependencyNodeInputSchema>,
): Record<string, unknown> {
  if (node.kind === "source-span") {
    return {
      kind: node.kind,
      evidence_ref: node.evidence_ref,
      source_ref: node.source_ref,
      module_ref: node.module_ref,
      locator: node.locator,
    };
  }
  if (node.kind === "selected-fact") {
    return { kind: node.kind, fact_ref: node.fact_ref };
  }
  if (node.kind === "logical-unit") {
    return { kind: node.kind, logical_unit_ref: node.logical_unit_ref };
  }
  return { kind: node.kind, target_ref: node.target_ref };
}

export function indexerDependencyNodeRef(input: {
  polarity: "positive" | "negative";
  node: z.infer<typeof indexerPositiveDependencyNodeInputSchema> |
    z.infer<typeof indexerNegativeDependencyNodeInputSchema>;
}): string {
  const identity = input.polarity === "positive"
    ? positiveNodeIdentity(
        input.node as z.infer<typeof indexerPositiveDependencyNodeInputSchema>,
      )
    : {
        kind: input.node.kind,
        scope_ref: (input.node as z.infer<
          typeof indexerNegativeDependencyNodeInputSchema
        >).scope_ref,
      };
  return `dependency-node:${indexerProtocolDigest({ polarity: input.polarity, ...identity })}`;
}

export function indexerDependencyVersionRef(input: {
  polarity: "positive" | "negative";
  node: IndexerPositiveDependencyNode | IndexerNegativeDependencyNode;
}): string {
  return `dependency:${indexerProtocolDigest({ polarity: input.polarity, ...input.node })}`;
}

function buildPositiveNode(value: unknown): IndexerPositiveDependencyNode {
  const parsed = indexerPositiveDependencyNodeInputSchema.parse(value);
  const normalized = {
    ...parsed,
    targets: canonicalTargets(parsed.targets, `${parsed.kind}.targets`),
  };
  return indexerPositiveDependencyNodeSchema.parse({
    ...normalized,
    node_ref: indexerDependencyNodeRef({ polarity: "positive", node: normalized }),
  });
}

function buildNegativeNode(value: unknown): IndexerNegativeDependencyNode {
  const parsed = indexerNegativeDependencyNodeInputSchema.parse(value);
  const normalized = {
    ...parsed,
    targets: canonicalTargets(parsed.targets, `${parsed.kind}.targets`),
  };
  return indexerNegativeDependencyNodeSchema.parse({
    ...normalized,
    node_ref: indexerDependencyNodeRef({ polarity: "negative", node: normalized }),
  });
}

function dependencyViewDigest(
  value: Omit<IndexerAuthorDependencyView, "view_digest">,
): string {
  return indexerProtocolDigest(value);
}

function assertViewClosure(view: IndexerAuthorDependencyView): void {
  const nodes = [...view.positive_nodes, ...view.negative_nodes];
  if (new Set(nodes.map((node) => node.node_ref)).size !== nodes.length) {
    throw new TypeError("author dependency view node identities must be unique");
  }
  const sourceSpans = view.positive_nodes.filter((node) => node.kind === "source-span");
  if (new Set(sourceSpans.map((node) => node.evidence_ref)).size !== sourceSpans.length) {
    throw new TypeError("author dependency view evidence refs must be unique");
  }
  const selectedFacts = view.positive_nodes.filter((node) => node.kind === "selected-fact");
  if (new Set(selectedFacts.map((node) => node.fact_ref)).size !== selectedFacts.length) {
    throw new TypeError("author dependency view selected Fact refs must be unique");
  }
  const sourceSpanRefs = new Set(view.positive_nodes
    .filter((node) => node.kind === "source-span")
    .map((node) => node.node_ref));
  for (const fact of view.positive_nodes.filter((node) => node.kind === "selected-fact")) {
    const sorted = [...fact.source_span_node_refs].sort(compareIndexerCanonicalText);
    if (
      new Set(sorted).size !== sorted.length ||
      canonicalIndexerJson(sorted) !== canonicalIndexerJson(fact.source_span_node_refs) ||
      sorted.some((ref) => !sourceSpanRefs.has(ref))
    ) {
      throw new TypeError("selected Fact dependency references unknown or non-canonical source spans");
    }
  }
  const logical = view.positive_nodes.filter((node) => node.kind === "logical-unit");
  if (
    logical.length !== 1 ||
    logical[0]!.logical_unit_ref !== view.logical_unit_ref ||
    canonicalIndexerJson(logical[0]!.targets) !==
      canonicalIndexerJson([{ level: "logical-unit" }])
  ) {
    throw new TypeError("author dependency view requires one logical-unit root node");
  }
  const groupInput = view.negative_nodes.filter((node) => node.kind === "group-input-set");
  if (
    groupInput.length !== 1 ||
    groupInput[0]!.scope_ref !== view.logical_unit_ref ||
    canonicalIndexerJson(groupInput[0]!.targets) !==
      canonicalIndexerJson([{ level: "logical-unit" }])
  ) {
    throw new TypeError("author dependency view requires one logical-unit group-input denominator");
  }
}

export function buildIndexerAuthorDependencyView(input: {
  source_ref: string;
  module_ref: string | null;
  logical_unit_ref: string;
  positive_nodes: readonly unknown[];
  negative_nodes: readonly unknown[];
}): IndexerAuthorDependencyView {
  const payload = dependencyViewPayloadSchema.parse({
    protocol: "context.indexer.author-dependency-view/v1",
    source_ref: input.source_ref,
    module_ref: input.module_ref,
    logical_unit_ref: input.logical_unit_ref,
    positive_nodes: input.positive_nodes.map(buildPositiveNode).sort((left, right) =>
      compareIndexerCanonicalText(left.node_ref, right.node_ref)
    ),
    negative_nodes: input.negative_nodes.map(buildNegativeNode).sort((left, right) =>
      compareIndexerCanonicalText(left.node_ref, right.node_ref)
    ),
  });
  const view = indexerAuthorDependencyViewSchema.parse({
    ...payload,
    view_digest: dependencyViewDigest(payload),
  });
  assertViewClosure(view);
  return view;
}

export function validateIndexerAuthorDependencyView(
  value: unknown,
): IndexerAuthorDependencyView {
  const view = indexerAuthorDependencyViewSchema.parse(value);
  const rebuilt = buildIndexerAuthorDependencyView({
    source_ref: view.source_ref,
    module_ref: view.module_ref,
    logical_unit_ref: view.logical_unit_ref,
    positive_nodes: view.positive_nodes.map((node) => Object.fromEntries(
      Object.entries(node).filter(([key]) => key !== "node_ref"),
    )),
    negative_nodes: view.negative_nodes.map((node) => Object.fromEntries(
      Object.entries(node).filter(([key]) => key !== "node_ref"),
    )),
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(view)) {
    throw new TypeError("author dependency view digest, nodes, or ordering is invalid");
  }
  return view;
}

export function indexerDependencyTargetMatches(input: {
  target: IndexerDependencyTarget;
  artifact_kind: string;
  section_key: string;
}): boolean {
  return input.target.level === "logical-unit" ||
    (input.target.artifact_kind === input.artifact_kind &&
      (input.target.level === "artifact-kind" ||
        input.target.section_key === input.section_key));
}
