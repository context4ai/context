import { z } from "zod";
import type { IndexerArtifactResult } from "./indexerArtifactResult.js";
import {
  indexerAuthorDependencyViewSchema,
  indexerDependencyTargetMatches,
  indexerDependencyVersionRef,
  indexerLogicalUnitDependencyNodeSchema,
  indexerNegativeDependencyNodeSchema,
  indexerResourceDependencyNodeSchema,
  indexerSelectedFactDependencyNodeSchema,
  indexerSourceSpanDependencyNodeSchema,
  validateIndexerAuthorDependencyView,
  type IndexerAuthorDependencyView,
  type IndexerNegativeDependencyNode,
  type IndexerPositiveDependencyNode,
} from "./indexerDependencyView.js";
import type { IndexerMainAuthorWorkset } from "./indexerMainWorkset.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  validateIndexerRunEnvelope,
  type IndexerRunEnvelope,
} from "./indexerRunEnvelope.js";

const dependencyRefField = { dependency_ref: z.string().min(1) };
const positiveDependencySchema = z.union([
  indexerSourceSpanDependencyNodeSchema.extend(dependencyRefField).strict(),
  indexerSelectedFactDependencyNodeSchema.extend(dependencyRefField).strict(),
  indexerLogicalUnitDependencyNodeSchema.extend(dependencyRefField).strict(),
  indexerResourceDependencyNodeSchema.extend(dependencyRefField).strict(),
]);
const negativeDependencySchema = indexerNegativeDependencyNodeSchema.extend(
  dependencyRefField,
).strict();

const sectionDependencySchema = z.object({
  section_key: indexerIdSchema,
  positive_dependency_refs: z.array(z.string().min(1)).min(1),
  negative_dependency_refs: z.array(z.string().min(1)).min(1),
  dependency_digest: indexerDigestSchema,
}).strict();

const artifactDependencySchema = z.object({
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  positive_dependency_refs: z.array(z.string().min(1)).min(1),
  negative_dependency_refs: z.array(z.string().min(1)).min(1),
  sections: z.array(sectionDependencySchema).min(1),
  dependency_digest: indexerDigestSchema,
}).strict();

export const indexerArtifactDependencySetSchema = z.object({
  protocol: z.literal("context.indexer.artifact-dependency-set/v1"),
  result_digest: indexerDigestSchema,
  author_workset_digest: indexerDigestSchema,
  run_envelope_digest: indexerDigestSchema,
  dependency_view_digest: indexerDigestSchema,
  source_ref: z.string().min(1),
  module_ref: z.string().min(1).nullable(),
  logical_unit_ref: z.string().min(1),
  positive_dependencies: z.array(positiveDependencySchema).min(1),
  negative_dependencies: z.array(negativeDependencySchema).min(1),
  artifacts: z.array(artifactDependencySchema),
  dependency_set_digest: indexerDigestSchema,
}).strict();

export type IndexerArtifactDependencySet = z.infer<
  typeof indexerArtifactDependencySetSchema
>;
type PositiveDependency = IndexerArtifactDependencySet["positive_dependencies"][number];
type NegativeDependency = IndexerArtifactDependencySet["negative_dependencies"][number];
type SectionDependency = IndexerArtifactDependencySet["artifacts"][number]["sections"][number];
type ArtifactDependency = IndexerArtifactDependencySet["artifacts"][number];

function canonicalUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIndexerCanonicalText);
}

function versionedPositive(node: IndexerPositiveDependencyNode): PositiveDependency {
  return positiveDependencySchema.parse({
    ...node,
    dependency_ref: indexerDependencyVersionRef({ polarity: "positive", node }),
  });
}

function versionedNegative(node: IndexerNegativeDependencyNode): NegativeDependency {
  return negativeDependencySchema.parse({
    ...node,
    dependency_ref: indexerDependencyVersionRef({ polarity: "negative", node }),
  });
}

function sectionDependency(
  value: Omit<SectionDependency, "dependency_digest">,
): SectionDependency {
  return { ...value, dependency_digest: indexerProtocolDigest(value) };
}

function artifactDependency(
  value: Omit<ArtifactDependency, "dependency_digest">,
): ArtifactDependency {
  return { ...value, dependency_digest: indexerProtocolDigest(value) };
}

function artifactSections(
  artifact: IndexerArtifactResult["artifacts"][number],
): Array<{ section_key: string; fact_refs: string[]; evidence_refs: string[] }> {
  if (artifact.representation === "template") {
    const factRefs = canonicalUnique(
      Object.values(artifact.variables).flatMap((variable) => variable.fact_refs),
    );
    const evidenceRefs = canonicalUnique(
      Object.values(artifact.variables).flatMap((variable) => variable.evidence_refs),
    );
    return artifact.section_projections.map((section) => ({
      section_key: section.section_key,
      fact_refs: factRefs,
      evidence_refs: evidenceRefs,
    }));
  }
  return artifact.sections.map((section) => ({
    section_key: section.section_key,
    fact_refs: canonicalUnique(section.blocks.flatMap((block) =>
      block.layer === "deterministic-block" ? block.fact_refs : []
    )),
    evidence_refs: canonicalUnique(section.blocks.flatMap((block) =>
      block.layer === "semantic-prose" ? block.evidence_refs : []
    )),
  }));
}

function dependencySetPayload(
  value: IndexerArtifactDependencySet,
): Omit<IndexerArtifactDependencySet, "dependency_set_digest"> {
  const { dependency_set_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function indexerArtifactDependencySetDigest(
  value: Omit<IndexerArtifactDependencySet, "dependency_set_digest">,
): string {
  return indexerProtocolDigest(value);
}

function assertBoundInputs(input: {
  result: IndexerArtifactResult;
  workset: IndexerMainAuthorWorkset;
  runEnvelope: IndexerRunEnvelope;
  dependencyView: IndexerAuthorDependencyView;
}): void {
  const { result, workset, runEnvelope, dependencyView } = input;
  if (
    dependencyView.view_digest !== workset.group_dependency_view_digest ||
    runEnvelope.dependency_view_digest !== dependencyView.view_digest ||
    dependencyView.source_ref !== result.source_ref ||
    dependencyView.module_ref !== result.module_ref ||
    dependencyView.logical_unit_ref !== result.logical_unit.logical_unit_ref ||
    runEnvelope.workset_digest !== workset.workset_digest ||
    runEnvelope.logical_unit_ref !== result.logical_unit.logical_unit_ref ||
    runEnvelope.source_ref !== result.source_ref ||
    runEnvelope.module_ref !== result.module_ref ||
    runEnvelope.indexer_id !== result.indexer_id ||
    runEnvelope.source_role !== result.source_role ||
    runEnvelope.provider_layer_ref !== result.provider_layer_ref ||
    runEnvelope.provider_integrity !== result.provider_integrity ||
    runEnvelope.provider_bundle_digest !== result.provider_bundle_digest ||
    runEnvelope.config_fingerprint !== result.config_fingerprint ||
    runEnvelope.customization_fingerprint !== result.customization_fingerprint
  ) {
    throw new TypeError("Artifact dependency inputs do not bind the same current author run");
  }
  const logical = dependencyView.positive_nodes.find((node) => node.kind === "logical-unit")!;
  if (logical.group_projection_digest !== workset.group_projection_digest) {
    throw new TypeError("logical-unit dependency does not match the author group projection");
  }
}

function nodeTargetsSection(input: {
  node: IndexerPositiveDependencyNode | IndexerNegativeDependencyNode;
  artifact_kind: string;
  section_key: string;
}): boolean {
  return input.node.targets.some((target) => indexerDependencyTargetMatches({
    target,
    artifact_kind: input.artifact_kind,
    section_key: input.section_key,
  }));
}

function hasLogicalUnitTarget(
  node: IndexerPositiveDependencyNode | IndexerNegativeDependencyNode,
): boolean {
  return node.targets.some((target) => target.level === "logical-unit");
}

export function buildIndexerArtifactDependencySet(input: {
  result: IndexerArtifactResult;
  workset: IndexerMainAuthorWorkset;
  run_envelope: unknown;
  dependency_view: unknown;
}): IndexerArtifactDependencySet {
  const runEnvelope = validateIndexerRunEnvelope(input.run_envelope);
  const dependencyView = validateIndexerAuthorDependencyView(input.dependency_view);
  assertBoundInputs({
    result: input.result,
    workset: input.workset,
    runEnvelope,
    dependencyView,
  });

  const sourceNodes = dependencyView.positive_nodes.filter((node) =>
    node.kind === "source-span"
  );
  const sourceByEvidence = new Map(sourceNodes.map((node) => [node.evidence_ref, node]));
  const evidenceByRef = new Map(input.result.evidence_bindings.map((evidence) => {
    const node = sourceByEvidence.get(evidence.evidence_ref);
    if (
      node === undefined ||
      canonicalIndexerJson({
        source_ref: node.source_ref,
        module_ref: node.module_ref,
        locator: node.locator,
        content_digest: node.content_digest,
      }) !== canonicalIndexerJson({
        source_ref: evidence.source_ref,
        module_ref: evidence.module_ref,
        locator: evidence.locator,
        content_digest: evidence.content_digest,
      })
    ) {
      throw new TypeError(`evidence ${evidence.evidence_ref} is absent or stale in the dependency view`);
    }
    return [evidence.evidence_ref, versionedPositive(node)] as const;
  }));

  const factNodes = dependencyView.positive_nodes.filter((node) =>
    node.kind === "selected-fact"
  );
  const factNodeByRef = new Map(factNodes.map((node) => [node.fact_ref, node]));
  const factByRef = new Map(input.result.facts.map((fact) => {
    const node = factNodeByRef.get(fact.fact_ref);
    const sourceSpanNodeRefs = canonicalUnique(fact.evidence_refs.map((ref) => {
      const evidence = evidenceByRef.get(ref);
      if (evidence === undefined) {
        throw new TypeError(`Fact ${fact.fact_ref} references evidence outside the dependency view`);
      }
      return evidence.node_ref;
    }));
    if (
      node === undefined ||
      node.fact_digest !== indexerProtocolDigest(fact) ||
      canonicalIndexerJson(node.source_span_node_refs) !== canonicalIndexerJson(sourceSpanNodeRefs)
    ) {
      throw new TypeError(`Fact ${fact.fact_ref} is absent or stale in the dependency view`);
    }
    return [fact.fact_ref, versionedPositive(node)] as const;
  }));

  const logical = versionedPositive(
    dependencyView.positive_nodes.find((node) => node.kind === "logical-unit")!,
  );
  const resources = dependencyView.positive_nodes.filter((node) =>
    node.kind === "template-policy-fragment" || node.kind === "contract-metric"
  ).map(versionedPositive);
  const negatives = dependencyView.negative_nodes.map(versionedNegative);
  const usedPositive = new Map<string, PositiveDependency>([[logical.node_ref, logical]]);
  const usedNegative = new Map<string, NegativeDependency>();

  const artifacts = input.result.artifacts.map((artifact) => {
    const sections = artifactSections(artifact).map((section) => {
      const facts = section.fact_refs.map((ref) => factByRef.get(ref)!);
      const evidenceRefs = canonicalUnique([
        ...section.evidence_refs,
        ...section.fact_refs.flatMap((ref) =>
          input.result.facts.find((fact) => fact.fact_ref === ref)!.evidence_refs
        ),
      ]);
      const evidence = evidenceRefs.map((ref) => evidenceByRef.get(ref)!);
      const sectionResources = resources.filter((node) => nodeTargetsSection({
        node,
        artifact_kind: artifact.artifact_kind,
        section_key: section.section_key,
      }));
      const sectionNegatives = negatives.filter((node) => nodeTargetsSection({
        node,
        artifact_kind: artifact.artifact_kind,
        section_key: section.section_key,
      }));
      if (sectionNegatives.length === 0) {
        throw new TypeError(`Artifact Section ${section.section_key} has no negative dependency`);
      }
      for (const dependency of [...facts, ...evidence, ...sectionResources]) {
        usedPositive.set(dependency.node_ref, dependency);
      }
      for (const dependency of sectionNegatives) {
        usedNegative.set(dependency.node_ref, dependency);
      }
      return sectionDependency({
        section_key: section.section_key,
        positive_dependency_refs: canonicalUnique([
          logical.dependency_ref,
          ...facts.map((item) => item.dependency_ref),
          ...evidence.map((item) => item.dependency_ref),
          ...sectionResources.map((item) => item.dependency_ref),
        ]),
        negative_dependency_refs: canonicalUnique(
          sectionNegatives.map((item) => item.dependency_ref),
        ),
      });
    }).sort((left, right) => compareIndexerCanonicalText(left.section_key, right.section_key));
    return artifactDependency({
      artifact_id: artifact.artifact_id,
      artifact_kind: artifact.artifact_kind,
      positive_dependency_refs: canonicalUnique(
        sections.flatMap((section) => section.positive_dependency_refs),
      ),
      negative_dependency_refs: canonicalUnique(
        sections.flatMap((section) => section.negative_dependency_refs),
      ),
      sections,
    });
  }).sort((left, right) => compareIndexerCanonicalText(left.artifact_id, right.artifact_id));

  if (artifacts.length === 0) {
    for (const resource of resources.filter(hasLogicalUnitTarget)) {
      usedPositive.set(resource.node_ref, resource);
    }
    for (const negative of negatives.filter(hasLogicalUnitTarget)) {
      usedNegative.set(negative.node_ref, negative);
    }
  }
  if (usedNegative.size === 0) {
    throw new TypeError("empty Artifact Result must retain its group-input negative dependency");
  }

  const payload: Omit<IndexerArtifactDependencySet, "dependency_set_digest"> = {
    protocol: "context.indexer.artifact-dependency-set/v1",
    result_digest: input.result.output_digest,
    author_workset_digest: input.workset.workset_digest,
    run_envelope_digest: runEnvelope.envelope_digest,
    dependency_view_digest: dependencyView.view_digest,
    source_ref: input.result.source_ref,
    module_ref: input.result.module_ref,
    logical_unit_ref: input.result.logical_unit.logical_unit_ref,
    positive_dependencies: [...usedPositive.values()].sort((left, right) =>
      compareIndexerCanonicalText(left.node_ref, right.node_ref)
    ),
    negative_dependencies: [...usedNegative.values()].sort((left, right) =>
      compareIndexerCanonicalText(left.node_ref, right.node_ref)
    ),
    artifacts,
  };
  return indexerArtifactDependencySetSchema.parse({
    ...payload,
    dependency_set_digest: indexerArtifactDependencySetDigest(payload),
  });
}

export function validateIndexerArtifactDependencySet(input: {
  value: unknown;
  result: IndexerArtifactResult;
  workset: IndexerMainAuthorWorkset;
  run_envelope: unknown;
  dependency_view: unknown;
}): IndexerArtifactDependencySet {
  const value = indexerArtifactDependencySetSchema.parse(input.value);
  if (
    indexerArtifactDependencySetDigest(dependencySetPayload(value)) !==
      value.dependency_set_digest
  ) {
    throw new TypeError("Artifact dependency set digest is invalid");
  }
  const expected = buildIndexerArtifactDependencySet({
    result: input.result,
    workset: input.workset,
    run_envelope: input.run_envelope,
    dependency_view: input.dependency_view,
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(value)) {
    throw new TypeError(
      "Artifact dependency set does not match its run envelope, source spans, logical unit, Artifacts, or dependency view",
    );
  }
  return value;
}

export function validateIndexerArtifactDependencyViewBinding(input: {
  view: unknown;
  workset: IndexerMainAuthorWorkset;
}): IndexerAuthorDependencyView {
  const view = indexerAuthorDependencyViewSchema.parse(
    validateIndexerAuthorDependencyView(input.view),
  );
  if (view.view_digest !== input.workset.group_dependency_view_digest) {
    throw new TypeError("author workset does not bind the supplied dependency view");
  }
  return view;
}
