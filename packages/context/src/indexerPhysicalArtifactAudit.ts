import { z } from "zod";
import {
  validateIndexerArtifactBundle,
  type IndexerArtifactBundle,
  type IndexerArtifactBundleEntry,
} from "./indexerArtifactPolicy.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  validateIndexerLayoutProposalSet,
  type IndexerLayoutProposalSet,
} from "./indexerLayoutProposalSet.js";
import { validateIndexerNavigationArtifactGraph } from "./indexerNavigationArtifactGraph.js";
import type { IndexerNavigationArtifactPlan } from "./indexerNavigationArtifactPlan.js";
import {
  buildIndexerArtifactManifest,
  validateIndexerArtifactManifest,
  type IndexerArtifactManifest,
  type IndexerPhysicalArtifactFileInput,
  type IndexerPhysicalArtifactManifestEntry,
  type IndexerPhysicalArtifactRegistration,
} from "./indexerPhysicalArtifactManifest.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const physicalArtifactDiagnosticSchema = z.object({
  code: z.enum([
    "empty-physical-artifact",
    "missing-physical-artifact",
    "orphan-physical-artifact",
    "unresolved-material-artifact",
  ]),
  output_path: portableIndexerPathSchema,
  artifact_ref: indexerCanonicalRefSchema.nullable(),
  logical_unit_ref: indexerCanonicalRefSchema.nullable(),
}).strict();

const logicalUnitFanOutSchema = z.object({
  logical_unit_ref: indexerCanonicalRefSchema,
  bundle_digest: indexerDigestSchema,
  planned_artifact_count: z.number().int().nonnegative(),
  ready_artifact_count: z.number().int().nonnegative(),
  materialized_artifact_count: z.number().int().nonnegative(),
  discretionary_fan_out: z.number().int().nonnegative(),
  semantic_split_part_count: z.number().int().nonnegative(),
}).strict();

const readabilityAdvisorySchema = z.object({
  code: z.literal("physical-artifact-reader-body-over-1500-lines"),
  output_path: portableIndexerPathSchema,
  artifact_ref: indexerCanonicalRefSchema,
  reader_body_line_count: z.number().int().min(1501),
}).strict();

const physicalArtifactAuditPayloadSchema = z.object({
  protocol: z.literal("context.indexer.physical-artifact-audit/v1"),
  layout_proposal_set_digest: indexerDigestSchema,
  artifact_manifest_digest: indexerDigestSchema,
  state: z.enum(["passed", "failed"]),
  summary: z.object({
    logical_unit_count: z.number().int().nonnegative(),
    planned_bundle_artifact_count: z.number().int().nonnegative(),
    complete_bundle_artifact_count: z.number().int().nonnegative(),
    physical_artifact_count: z.number().int().nonnegative(),
    registered_physical_artifact_count: z.number().int().nonnegative(),
    navigation_artifact_count: z.number().int().nonnegative(),
    empty_artifact_count: z.number().int().nonnegative(),
    orphan_artifact_count: z.number().int().nonnegative(),
    missing_artifact_count: z.number().int().nonnegative(),
    unresolved_material_artifact_count: z.number().int().nonnegative(),
  }).strict(),
  logical_unit_fan_out: z.array(logicalUnitFanOutSchema),
  diagnostics: z.array(physicalArtifactDiagnosticSchema),
  readability_advisories: z.array(readabilityAdvisorySchema),
}).strict();

export const indexerPhysicalArtifactAuditSchema = physicalArtifactAuditPayloadSchema.extend({
  audit_digest: indexerDigestSchema,
}).strict();

export type IndexerPhysicalArtifactDiagnostic = z.infer<typeof physicalArtifactDiagnosticSchema>;
export type IndexerLogicalUnitFanOut = z.infer<typeof logicalUnitFanOutSchema>;
export type IndexerPhysicalArtifactAudit = z.infer<typeof indexerPhysicalArtifactAuditSchema>;

interface ValidatedArtifactPlan {
  layoutSet: IndexerLayoutProposalSet;
  bundles: IndexerArtifactBundle[];
  navigation: IndexerNavigationArtifactPlan[];
  registrations: IndexerPhysicalArtifactRegistration[];
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must be unique`);
  }
}

function bundleEntryById(bundle: IndexerArtifactBundle): Map<string, IndexerArtifactBundleEntry> {
  return new Map(bundle.artifacts.map((entry) => [entry.artifact_id, entry]));
}

function logicalUnitRegistrations(input: {
  layoutSet: IndexerLayoutProposalSet;
  bundles: readonly IndexerArtifactBundle[];
}): IndexerPhysicalArtifactRegistration[] {
  const bundleByUnit = new Map(input.bundles.map((bundle) => [bundle.logical_unit_ref, bundle]));
  if (bundleByUnit.size !== input.bundles.length) {
    throw new TypeError("physical Artifact audit received duplicate logical-unit Bundles");
  }
  const registrations = input.layoutSet.proposals.flatMap((proposal) => {
    const bundle = bundleByUnit.get(proposal.node.node_ref);
    if (bundle === undefined) {
      if (proposal.artifacts.length === 0) return [];
      throw new TypeError(`layout Node ${proposal.node.node_ref} lacks an Artifact Bundle`);
    }
    const entries = bundleEntryById(bundle);
    if (entries.size !== proposal.artifacts.length || entries.size !== bundle.artifacts.length) {
      throw new TypeError(`Artifact Bundle ${bundle.bundle_digest} does not close its layout Artifact set`);
    }
    return proposal.artifacts.map((artifact): IndexerPhysicalArtifactRegistration => {
      const entry = entries.get(artifact.artifact_id);
      if (entry === undefined || entry.artifact_kind !== artifact.artifact_kind) {
        throw new TypeError(`layout Artifact ${artifact.artifact_id} is absent or changed in its Bundle`);
      }
      return {
        output_path: artifact.output_path,
        owner: {
          kind: "logical-unit",
          logical_unit_ref: bundle.logical_unit_ref,
          node_ref: proposal.node.node_ref,
          artifact_ref: artifact.artifact_ref,
          artifact_id: artifact.artifact_id,
          artifact_kind: artifact.artifact_kind,
          bundle_digest: bundle.bundle_digest,
          purpose: entry.purpose,
          split_of: entry.purpose === "semantic-split" ? entry.split_of : null,
          section_refs: artifact.sections.map((section) => section.section_ref)
            .sort(compareIndexerCanonicalText),
          material_state: artifact.sections.some((section) => section.state === "material-gap")
            ? "blocked"
            : "ready",
        },
      };
    });
  });
  const artifactBearingUnits = input.layoutSet.proposals.filter((proposal) =>
    proposal.artifacts.length > 0
  );
  if (
    bundleByUnit.size !== artifactBearingUnits.length ||
    [...bundleByUnit.keys()].some((nodeRef) =>
      !artifactBearingUnits.some((proposal) => proposal.node.node_ref === nodeRef)
    )
  ) {
    throw new TypeError("physical Artifact audit received an unrelated Artifact Bundle");
  }
  return registrations;
}

function navigationRegistrations(input: {
  plans: readonly IndexerNavigationArtifactPlan[];
}): IndexerPhysicalArtifactRegistration[] {
  return input.plans.map((plan) => {
    return {
      output_path: plan.output_path,
      owner: {
        kind: "navigation",
        navigation_ref: plan.navigation_ref,
        artifact_ref: plan.artifact_ref,
        artifact_id: plan.artifact_id,
        artifact_kind: plan.artifact_kind,
        plan_digest: plan.plan_digest,
        child_artifact_refs: [...plan.child_artifact_refs],
      },
    };
  });
}

function validatePlans(input: {
  layout_proposal_set: unknown;
  artifact_bundles: readonly unknown[];
  navigation_artifacts: readonly unknown[];
}): ValidatedArtifactPlan {
  const layoutSet = validateIndexerLayoutProposalSet(input.layout_proposal_set);
  const bundles = input.artifact_bundles.flatMap((value) =>
    value === null ? [] : [validateIndexerArtifactBundle(value)]
  );
  const logicalRegistrations = logicalUnitRegistrations({ layoutSet, bundles });
  const knownArtifactRefs = new Set(logicalRegistrations.map((registration) => {
    if (registration.owner.kind !== "logical-unit") throw new TypeError("unreachable owner kind");
    return registration.owner.artifact_ref;
  }));
  const navigation = validateIndexerNavigationArtifactGraph({
    plans: input.navigation_artifacts,
    logical_artifact_refs: [...knownArtifactRefs],
  });
  const registrations = [
    ...logicalRegistrations,
    ...navigationRegistrations({ plans: navigation }),
  ];
  assertUnique(registrations.map((registration) => registration.output_path), "planned physical Artifact paths");
  assertUnique(registrations.map((registration) => registration.owner.artifact_ref), "planned Artifact refs");
  return { layoutSet, bundles, navigation, registrations };
}

function diagnosticForRegistration(input: {
  code: IndexerPhysicalArtifactDiagnostic["code"];
  registration: IndexerPhysicalArtifactRegistration;
}): IndexerPhysicalArtifactDiagnostic {
  return {
    code: input.code,
    output_path: input.registration.output_path,
    artifact_ref: input.registration.owner.artifact_ref,
    logical_unit_ref: input.registration.owner.kind === "logical-unit"
      ? input.registration.owner.logical_unit_ref
      : null,
  };
}

function diagnosticForFile(
  code: IndexerPhysicalArtifactDiagnostic["code"],
  file: IndexerPhysicalArtifactManifestEntry,
): IndexerPhysicalArtifactDiagnostic {
  return {
    code,
    output_path: file.output_path,
    artifact_ref: file.owner.kind === "orphan" ? null : file.owner.artifact_ref,
    logical_unit_ref: file.owner.kind === "logical-unit" ? file.owner.logical_unit_ref : null,
  };
}

function compareDiagnostics(
  left: IndexerPhysicalArtifactDiagnostic,
  right: IndexerPhysicalArtifactDiagnostic,
): number {
  return compareIndexerCanonicalText(
    `${left.code}\u0000${left.output_path}\u0000${left.artifact_ref ?? ""}`,
    `${right.code}\u0000${right.output_path}\u0000${right.artifact_ref ?? ""}`,
  );
}

function fanOut(input: {
  plan: ValidatedArtifactPlan;
  manifest: IndexerArtifactManifest;
}): IndexerLogicalUnitFanOut[] {
  return input.plan.bundles.map((bundle) => {
    const registrations = input.plan.registrations.filter((registration) =>
      registration.owner.kind === "logical-unit" &&
      registration.owner.logical_unit_ref === bundle.logical_unit_ref
    );
    const files = input.manifest.files.filter((file) =>
      file.owner.kind === "logical-unit" &&
      file.owner.logical_unit_ref === bundle.logical_unit_ref
    );
    return {
      logical_unit_ref: bundle.logical_unit_ref,
      bundle_digest: bundle.bundle_digest,
      planned_artifact_count: bundle.artifacts.length,
      ready_artifact_count: registrations.filter((registration) =>
        registration.owner.kind === "logical-unit" && registration.owner.material_state === "ready"
      ).length,
      materialized_artifact_count: files.filter((file) =>
        !file.empty && file.owner.kind === "logical-unit" && file.owner.material_state === "ready"
      ).length,
      discretionary_fan_out: bundle.discretionary_artifact_count,
      semantic_split_part_count: bundle.semantic_split_part_count,
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.logical_unit_ref, right.logical_unit_ref));
}

export function auditIndexerPhysicalArtifacts(input: {
  layout_proposal_set: unknown;
  artifact_bundles: readonly unknown[];
  navigation_artifacts?: readonly unknown[];
  files: readonly IndexerPhysicalArtifactFileInput[];
}): {
  manifest: IndexerArtifactManifest;
  audit: IndexerPhysicalArtifactAudit;
} {
  const plan = validatePlans({
    layout_proposal_set: input.layout_proposal_set,
    artifact_bundles: input.artifact_bundles,
    navigation_artifacts: input.navigation_artifacts ?? [],
  });
  const manifest = buildIndexerArtifactManifest({
    layout_proposal_set_digest: plan.layoutSet.set_digest,
    registrations: plan.registrations,
    files: input.files,
  });
  return { manifest, audit: buildPhysicalArtifactAudit(plan, manifest) };
}

function assertManifestOwnership(
  plan: ValidatedArtifactPlan,
  manifest: IndexerArtifactManifest,
): void {
  if (manifest.layout_proposal_set_digest !== plan.layoutSet.set_digest) {
    throw new TypeError("Artifact manifest is bound to another layout proposal set");
  }
  const ownerByPath = new Map(plan.registrations.map((registration) => [
    registration.output_path,
    registration.owner,
  ]));
  for (const file of manifest.files) {
    const expected = ownerByPath.get(file.output_path);
    if (expected === undefined) {
      if (file.owner.kind !== "orphan") {
        throw new TypeError(`unregistered Artifact ${file.output_path} claims a registered owner`);
      }
      continue;
    }
    if (canonicalIndexerJson(expected) !== canonicalIndexerJson(file.owner)) {
      throw new TypeError(`Artifact ${file.output_path} changes its planned owner`);
    }
  }
}

function buildPhysicalArtifactAudit(
  plan: ValidatedArtifactPlan,
  manifest: IndexerArtifactManifest,
): IndexerPhysicalArtifactAudit {
  assertManifestOwnership(plan, manifest);
  const actualPaths = new Set(manifest.files.map((file) => file.output_path));
  const diagnostics: IndexerPhysicalArtifactDiagnostic[] = [];
  for (const registration of plan.registrations) {
    if (registration.owner.kind === "logical-unit" && registration.owner.material_state === "blocked") {
      diagnostics.push(diagnosticForRegistration({
        code: "unresolved-material-artifact",
        registration,
      }));
      continue;
    }
    if (!actualPaths.has(registration.output_path)) {
      diagnostics.push(diagnosticForRegistration({
        code: "missing-physical-artifact",
        registration,
      }));
    }
  }
  for (const file of manifest.files) {
    if (file.owner.kind === "orphan") {
      diagnostics.push(diagnosticForFile("orphan-physical-artifact", file));
    }
    if (file.empty) diagnostics.push(diagnosticForFile("empty-physical-artifact", file));
  }
  diagnostics.sort(compareDiagnostics);
  const logicalUnitFanOut = fanOut({ plan, manifest });
  const registeredFiles = manifest.files.filter((file) => file.owner.kind !== "orphan");
  const navigationFiles = manifest.files.filter((file) => file.owner.kind === "navigation");
  const payload = physicalArtifactAuditPayloadSchema.parse({
    protocol: "context.indexer.physical-artifact-audit/v1",
    layout_proposal_set_digest: plan.layoutSet.set_digest,
    artifact_manifest_digest: manifest.manifest_digest,
    state: diagnostics.length === 0 ? "passed" : "failed",
    summary: {
      logical_unit_count: plan.layoutSet.proposals.length,
      planned_bundle_artifact_count: logicalUnitFanOut.reduce(
        (total, unit) => total + unit.planned_artifact_count,
        0,
      ),
      complete_bundle_artifact_count: logicalUnitFanOut.reduce(
        (total, unit) => total + unit.materialized_artifact_count,
        0,
      ),
      physical_artifact_count: manifest.files.length,
      registered_physical_artifact_count: registeredFiles.length,
      navigation_artifact_count: navigationFiles.length,
      empty_artifact_count: manifest.files.filter((file) => file.empty).length,
      orphan_artifact_count: manifest.files.filter((file) => file.owner.kind === "orphan").length,
      missing_artifact_count: diagnostics.filter((item) =>
        item.code === "missing-physical-artifact"
      ).length,
      unresolved_material_artifact_count: diagnostics.filter((item) =>
        item.code === "unresolved-material-artifact"
      ).length,
    },
    logical_unit_fan_out: logicalUnitFanOut,
    diagnostics,
    readability_advisories: manifest.files.flatMap((file) =>
      file.owner.kind === "orphan" || file.empty || file.reader_body_line_count <= 1500
        ? []
        : [{
        code: "physical-artifact-reader-body-over-1500-lines" as const,
        output_path: file.output_path,
        artifact_ref: file.owner.artifact_ref,
        reader_body_line_count: file.reader_body_line_count,
      }]
    )
      .sort((left, right) => compareIndexerCanonicalText(left.output_path, right.output_path)),
  });
  return indexerPhysicalArtifactAuditSchema.parse({
    ...payload,
    audit_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerPhysicalArtifactAudit(input: {
  audit: unknown;
  manifest: unknown;
  layout_proposal_set: unknown;
  artifact_bundles: readonly unknown[];
  navigation_artifacts?: readonly unknown[];
}): IndexerPhysicalArtifactAudit {
  const audit = indexerPhysicalArtifactAuditSchema.parse(input.audit);
  const manifest = validateIndexerArtifactManifest(input.manifest);
  const plan = validatePlans({
    layout_proposal_set: input.layout_proposal_set,
    artifact_bundles: input.artifact_bundles,
    navigation_artifacts: input.navigation_artifacts ?? [],
  });
  const expected = buildPhysicalArtifactAudit(plan, manifest);
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(audit)) {
    throw new TypeError("physical Artifact audit is stale or forged");
  }
  return audit;
}

export function assertIndexerPhysicalArtifactAuditPassed(input: {
  audit: unknown;
  manifest: unknown;
  layout_proposal_set: unknown;
  artifact_bundles: readonly unknown[];
  navigation_artifacts?: readonly unknown[];
}): IndexerPhysicalArtifactAudit {
  const audit = validateIndexerPhysicalArtifactAudit(input);
  if (audit.state !== "passed") {
    throw new TypeError(
      `physical Artifact audit failed: ${audit.diagnostics.map((item) => item.code).join(", ")}`,
    );
  }
  return audit;
}
