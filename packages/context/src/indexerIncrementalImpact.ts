import { z } from "zod";
import {
  indexerArtifactDependencySetDigest,
  indexerArtifactDependencySetSchema,
  type IndexerArtifactDependencySet,
} from "./indexerArtifactDependencies.js";
import {
  indexerDependencyTargetMatches,
  indexerDependencyVersionRef,
  validateIndexerAuthorDependencyView,
  type IndexerAuthorDependencyView,
  type IndexerNegativeDependencyNode,
  type IndexerPositiveDependencyNode,
} from "./indexerDependencyView.js";
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

const sectionImpactSchema = z.object({
  section_key: indexerIdSchema,
  state: z.enum(["current", "stale"]),
  changed_node_refs: z.array(z.string().min(1)),
}).strict();

const artifactImpactSchema = z.object({
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  state: z.enum(["current", "stale"]),
  changed_node_refs: z.array(z.string().min(1)),
  sections: z.array(sectionImpactSchema).min(1),
}).strict();

const dependencyChangeSchema = z.object({
  node_ref: z.string().min(1),
  polarity: z.enum(["positive", "negative"]),
  kind: z.string().min(1),
  change: z.enum(["added", "removed", "changed"]),
  previous_dependency_ref: z.string().min(1).nullable(),
  current_dependency_ref: z.string().min(1).nullable(),
  affected_artifact_ids: z.array(indexerIdSchema),
  affected_sections: z.array(z.object({
    artifact_id: indexerIdSchema,
    section_key: indexerIdSchema,
  }).strict()),
}).strict();

const envelopeChangeSchema = z.object({
  field: z.string().min(1),
  previous_value: z.string().nullable(),
  current_value: z.string().nullable(),
}).strict();

const impactReportPayloadSchema = z.object({
  protocol: z.literal("context.indexer.incremental-impact-report/v1"),
  indexer_id: indexerIdSchema,
  logical_unit_ref: z.string().min(1),
  previous_run_envelope_digest: indexerDigestSchema,
  current_run_envelope_digest: indexerDigestSchema,
  previous_dependency_view_digest: indexerDigestSchema,
  current_dependency_view_digest: indexerDigestSchema,
  previous_dependency_set_digest: indexerDigestSchema,
  envelope_changes: z.array(envelopeChangeSchema),
  dependency_changes: z.array(dependencyChangeSchema),
  artifacts: z.array(artifactImpactSchema),
  logical_unit_state: z.enum(["current", "stale"]),
  current_artifact_count: z.number().int().nonnegative(),
  stale_artifact_count: z.number().int().nonnegative(),
  current_section_count: z.number().int().nonnegative(),
  stale_section_count: z.number().int().nonnegative(),
  recompute_scope: z.enum(["none", "artifact-sections", "logical-unit-empty"]),
}).strict();

export const indexerIncrementalImpactReportSchema = impactReportPayloadSchema.extend({
  report_digest: indexerDigestSchema,
}).strict();

export type IndexerIncrementalImpactReport = z.infer<
  typeof indexerIncrementalImpactReportSchema
>;

type DependencyNode = IndexerPositiveDependencyNode | IndexerNegativeDependencyNode;
type VersionedDependency =
  IndexerArtifactDependencySet["positive_dependencies"][number] |
  IndexerArtifactDependencySet["negative_dependencies"][number];

const ENVELOPE_COMPARE_FIELDS = [
  "source_snapshot_digest",
  "requirement_set_digest",
  "provider_layer_ref",
  "provider_integrity",
  "provider_bundle_digest",
  "config_fingerprint",
  "customization_fingerprint",
  "plan_binding_digest",
  "runtime_fingerprint",
  "resource_binding_digest",
  "parser_dependency_fingerprint",
  "source_role",
  "source_precedence_digest",
  "metric_set_digest",
] as const;

const SHARED_ARTIFACT_FINGERPRINT_COMPARE_FIELDS = [
  "implementation_fingerprint",
  "instructions_fingerprint",
  "template_fingerprint",
] as const;

function nodePolarity(node: DependencyNode): "positive" | "negative" {
  return "scope_ref" in node ? "negative" : "positive";
}

function nodeVersionRef(node: DependencyNode): string {
  return indexerDependencyVersionRef({ polarity: nodePolarity(node), node });
}

function canonicalUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIndexerCanonicalText);
}

function validateImpactInputs(input: {
  previous_run_envelope: unknown;
  previous_dependency_view: unknown;
  previous_dependency_set: unknown;
  current_run_envelope: unknown;
  current_dependency_view: unknown;
}) {
  const previousEnvelope = validateIndexerRunEnvelope(input.previous_run_envelope);
  const currentEnvelope = validateIndexerRunEnvelope(input.current_run_envelope);
  const previousView = validateIndexerAuthorDependencyView(input.previous_dependency_view);
  const currentView = validateIndexerAuthorDependencyView(input.current_dependency_view);
  const previousSet = indexerArtifactDependencySetSchema.parse(input.previous_dependency_set);
  const { dependency_set_digest: _dependencySetDigest, ...previousSetPayload } = previousSet;
  void _dependencySetDigest;
  if (
    indexerArtifactDependencySetDigest(previousSetPayload) !==
      previousSet.dependency_set_digest
  ) {
    throw new TypeError("previous Artifact dependency set digest is invalid");
  }
  if (
    previousEnvelope.stage !== "author" ||
    currentEnvelope.stage !== "author" ||
    previousEnvelope.indexer_id !== currentEnvelope.indexer_id ||
    previousEnvelope.source_ref !== currentEnvelope.source_ref ||
    previousEnvelope.module_ref !== currentEnvelope.module_ref ||
    previousEnvelope.logical_unit_ref === null ||
    previousEnvelope.logical_unit_ref !== currentEnvelope.logical_unit_ref ||
    previousView.logical_unit_ref !== previousEnvelope.logical_unit_ref ||
    currentView.logical_unit_ref !== currentEnvelope.logical_unit_ref ||
    previousEnvelope.dependency_view_digest !== previousView.view_digest ||
    currentEnvelope.dependency_view_digest !== currentView.view_digest ||
    previousSet.run_envelope_digest !== previousEnvelope.envelope_digest ||
    previousSet.dependency_view_digest !== previousView.view_digest ||
    previousSet.logical_unit_ref !== previousEnvelope.logical_unit_ref
  ) {
    throw new TypeError("incremental impact inputs do not describe one stable logical unit");
  }
  const previousNodes = new Map(
    [...previousView.positive_nodes, ...previousView.negative_nodes]
      .map((node) => [node.node_ref, node]),
  );
  for (const dependency of [
    ...previousSet.positive_dependencies,
    ...previousSet.negative_dependencies,
  ]) {
    const node = previousNodes.get(dependency.node_ref);
    if (node === undefined || nodeVersionRef(node) !== dependency.dependency_ref) {
      throw new TypeError("previous dependency set is not a Merkle projection of its full view");
    }
  }
  return { previousEnvelope, currentEnvelope, previousView, currentView, previousSet };
}

function refsForPreviousDependency(input: {
  set: IndexerArtifactDependencySet;
  dependency: VersionedDependency | undefined;
}): {
  artifactIds: string[];
  sections: Array<{ artifact_id: string; section_key: string }>;
} {
  if (input.dependency === undefined) return { artifactIds: [], sections: [] };
  const ref = input.dependency.dependency_ref;
  const sections = input.set.artifacts.flatMap((artifact) =>
    artifact.sections
      .filter((section) =>
        section.positive_dependency_refs.includes(ref) ||
        section.negative_dependency_refs.includes(ref)
      )
      .map((section) => ({
        artifact_id: artifact.artifact_id,
        section_key: section.section_key,
      }))
  );
  const artifactIds = input.set.artifacts
    .filter((artifact) =>
      artifact.positive_dependency_refs.includes(ref) ||
      artifact.negative_dependency_refs.includes(ref)
    )
    .map((artifact) => artifact.artifact_id);
  return { artifactIds, sections };
}

function refsForCurrentNode(input: {
  set: IndexerArtifactDependencySet;
  node: DependencyNode | undefined;
}): {
  artifactIds: string[];
  sections: Array<{ artifact_id: string; section_key: string }>;
} {
  if (input.node === undefined) return { artifactIds: [], sections: [] };
  const sections = input.set.artifacts.flatMap((artifact) =>
    artifact.sections.filter((section) => input.node!.targets.some((target) =>
      indexerDependencyTargetMatches({
        target,
        artifact_kind: artifact.artifact_kind,
        section_key: section.section_key,
      })
    )).map((section) => ({
      artifact_id: artifact.artifact_id,
      section_key: section.section_key,
    }))
  );
  return {
    artifactIds: canonicalUnique(sections.map((section) => section.artifact_id)),
    sections,
  };
}

function buildDependencyChanges(input: {
  previousView: IndexerAuthorDependencyView;
  currentView: IndexerAuthorDependencyView;
  previousSet: IndexerArtifactDependencySet;
}): IndexerIncrementalImpactReport["dependency_changes"] {
  const previousNodes = new Map(
    [...input.previousView.positive_nodes, ...input.previousView.negative_nodes]
      .map((node) => [node.node_ref, node]),
  );
  const currentNodes = new Map(
    [...input.currentView.positive_nodes, ...input.currentView.negative_nodes]
      .map((node) => [node.node_ref, node]),
  );
  const previousDependencies = new Map(
    [...input.previousSet.positive_dependencies, ...input.previousSet.negative_dependencies]
      .map((dependency) => [dependency.node_ref, dependency]),
  );
  return canonicalUnique([...previousNodes.keys(), ...currentNodes.keys()]).flatMap((nodeRef) => {
    const previous = previousNodes.get(nodeRef);
    const current = currentNodes.get(nodeRef);
    const previousRef = previous === undefined ? null : nodeVersionRef(previous);
    const currentRef = current === undefined ? null : nodeVersionRef(current);
    if (previousRef === currentRef) return [];
    const fromPrevious = refsForPreviousDependency({
      set: input.previousSet,
      dependency: previousDependencies.get(nodeRef),
    });
    const fromCurrent = refsForCurrentNode({ set: input.previousSet, node: current });
    const sectionKeys = new Map([
      ...fromPrevious.sections,
      ...fromCurrent.sections,
    ].map((section) => [`${section.artifact_id}\u0000${section.section_key}`, section]));
    const sections = [...sectionKeys.values()].sort((left, right) =>
      compareIndexerCanonicalText(
        `${left.artifact_id}\u0000${left.section_key}`,
        `${right.artifact_id}\u0000${right.section_key}`,
      )
    );
    const node = current ?? previous!;
    return [{
      node_ref: nodeRef,
      polarity: nodePolarity(node),
      kind: node.kind,
      change: previous === undefined
        ? "added" as const
        : current === undefined
        ? "removed" as const
        : "changed" as const,
      previous_dependency_ref: previousRef,
      current_dependency_ref: currentRef,
      affected_artifact_ids: canonicalUnique([
        ...fromPrevious.artifactIds,
        ...fromCurrent.artifactIds,
      ]),
      affected_sections: sections,
    }];
  });
}

function buildEnvelopeChanges(
  previous: IndexerRunEnvelope,
  current: IndexerRunEnvelope,
): IndexerIncrementalImpactReport["envelope_changes"] {
  const topLevelChanges = ENVELOPE_COMPARE_FIELDS.flatMap((field) => {
    const previousValue = previous[field];
    const currentValue = current[field];
    return previousValue === currentValue
      ? []
      : [{
          field,
          previous_value: previousValue,
          current_value: currentValue,
        }];
  });
  const sharedFingerprintChanges = SHARED_ARTIFACT_FINGERPRINT_COMPARE_FIELDS.flatMap(
    (field) => {
      const previousValue = previous.shared_artifact_fingerprint[field];
      const currentValue = current.shared_artifact_fingerprint[field];
      return previousValue === currentValue
        ? []
        : [{
            field: `shared_artifact_fingerprint.${field}`,
            previous_value: previousValue,
            current_value: currentValue,
          }];
    },
  );
  return [...topLevelChanges, ...sharedFingerprintChanges];
}

export function indexerIncrementalImpactReportDigest(
  value: Omit<IndexerIncrementalImpactReport, "report_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerIncrementalImpactReport(input: {
  previous_run_envelope: unknown;
  previous_dependency_view: unknown;
  previous_dependency_set: unknown;
  current_run_envelope: unknown;
  current_dependency_view: unknown;
}): IndexerIncrementalImpactReport {
  const validated = validateImpactInputs(input);
  const dependencyChanges = buildDependencyChanges(validated);
  const changedBySection = new Map<string, string[]>();
  for (const change of dependencyChanges) {
    for (const section of change.affected_sections) {
      const key = `${section.artifact_id}\u0000${section.section_key}`;
      changedBySection.set(key, [
        ...(changedBySection.get(key) ?? []),
        change.node_ref,
      ]);
    }
  }
  const artifacts = validated.previousSet.artifacts.map((artifact) => {
    const sections = artifact.sections.map((section) => {
      const changed = canonicalUnique(
        changedBySection.get(`${artifact.artifact_id}\u0000${section.section_key}`) ?? [],
      );
      return {
        section_key: section.section_key,
        state: changed.length === 0 ? "current" as const : "stale" as const,
        changed_node_refs: changed,
      };
    });
    const changed = canonicalUnique(sections.flatMap((section) => section.changed_node_refs));
    return {
      artifact_id: artifact.artifact_id,
      artifact_kind: artifact.artifact_kind,
      state: changed.length === 0 ? "current" as const : "stale" as const,
      changed_node_refs: changed,
      sections,
    };
  });
  const staleArtifactCount = artifacts.filter((artifact) => artifact.state === "stale").length;
  const staleSectionCount = artifacts.flatMap((artifact) => artifact.sections)
    .filter((section) => section.state === "stale").length;
  const logicalOnlyChange = artifacts.length === 0 && dependencyChanges.some((change) => {
    const current = [...validated.currentView.positive_nodes, ...validated.currentView.negative_nodes]
      .find((node) => node.node_ref === change.node_ref);
    const previous = [...validated.previousView.positive_nodes, ...validated.previousView.negative_nodes]
      .find((node) => node.node_ref === change.node_ref);
    return (current ?? previous)?.targets.some((target) => target.level === "logical-unit") === true;
  });
  const logicalUnitState = staleArtifactCount > 0 || logicalOnlyChange
    ? "stale" as const
    : "current" as const;
  const payload = impactReportPayloadSchema.parse({
    protocol: "context.indexer.incremental-impact-report/v1",
    indexer_id: validated.previousEnvelope.indexer_id,
    logical_unit_ref: validated.previousEnvelope.logical_unit_ref,
    previous_run_envelope_digest: validated.previousEnvelope.envelope_digest,
    current_run_envelope_digest: validated.currentEnvelope.envelope_digest,
    previous_dependency_view_digest: validated.previousView.view_digest,
    current_dependency_view_digest: validated.currentView.view_digest,
    previous_dependency_set_digest: validated.previousSet.dependency_set_digest,
    envelope_changes: buildEnvelopeChanges(
      validated.previousEnvelope,
      validated.currentEnvelope,
    ),
    dependency_changes: dependencyChanges,
    artifacts,
    logical_unit_state: logicalUnitState,
    current_artifact_count: artifacts.length - staleArtifactCount,
    stale_artifact_count: staleArtifactCount,
    current_section_count: artifacts.flatMap((artifact) => artifact.sections).length -
      staleSectionCount,
    stale_section_count: staleSectionCount,
    recompute_scope: artifacts.length === 0 && logicalOnlyChange
      ? "logical-unit-empty"
      : staleArtifactCount > 0
      ? "artifact-sections"
      : "none",
  });
  return indexerIncrementalImpactReportSchema.parse({
    ...payload,
    report_digest: indexerIncrementalImpactReportDigest(payload),
  });
}

export function validateIndexerIncrementalImpactReport(input: {
  report: unknown;
  previous_run_envelope: unknown;
  previous_dependency_view: unknown;
  previous_dependency_set: unknown;
  current_run_envelope: unknown;
  current_dependency_view: unknown;
}): IndexerIncrementalImpactReport {
  const report = indexerIncrementalImpactReportSchema.parse(input.report);
  const expected = buildIndexerIncrementalImpactReport(input);
  if (canonicalIndexerJson(report) !== canonicalIndexerJson(expected)) {
    throw new TypeError("incremental impact report is stale, forged, or coarse-grained");
  }
  return report;
}
