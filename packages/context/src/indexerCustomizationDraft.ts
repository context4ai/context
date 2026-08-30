import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildIndexerCustomizationPlan,
  indexerCustomizationPlanSchema,
  type IndexerCustomizationLadderStep,
} from "./indexerCustomizationLadder.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import {
  canonicalOwnerCellRef,
  indexerRegistryDigests,
  indexerRegistrySchema,
  validateFinalizedIndexerRegistry,
  type IndexerRegistry,
  type IndexerRegistryEntry,
} from "./indexerRegistry.js";
import {
  indexerProviderRouteInputSchema,
  indexerProviderRouteReportSchema,
  validateIndexerCapabilityGapProof,
} from "./indexerProviderRouting.js";

const extendStepSchema = z.enum([
  "instructions-append",
  "template-override",
  "program-extend",
]);

const rejectedStepSchema = z.object({
  step: z.enum([
    "provider-only",
    "config",
    "instructions-append",
    "template-override",
  ]),
  disposition: z.enum(["unsupported", "insufficient"]),
  reason_code: indexerIdSchema,
  evidence_digest: indexerDigestSchema,
}).strict();

const draftFileSchema = z.object({
  path: portableIndexerPathSchema,
  content: z.string().min(1).max(4 * 1024 * 1024),
}).strict();

export const indexerCustomizationDraftSchema = z.object({
  protocol: z.literal("context.indexer.customization-proposal-draft/v1"),
  capability_gap: z.object({
    route_input: indexerProviderRouteInputSchema,
    route_report: indexerProviderRouteReportSchema,
  }).strict(),
  capability_gap_digest: indexerDigestSchema,
  indexer_id: indexerIdSchema,
  mode: z.literal("extend"),
  selected_step: extendStepSchema,
  rejected_smaller_steps: z.array(rejectedStepSchema).min(2),
  gap_summary: z.string().min(1),
  affected_scope_refs: z.array(z.string().min(1)).min(1),
  files: z.array(draftFileSchema).min(1),
  dependency_intents: z.tuple([]),
}).strict();

export type IndexerCustomizationDraft = z.infer<
  typeof indexerCustomizationDraftSchema
>;

const validatedDraftPayloadSchema = z.object({
  protocol: z.literal("context.indexer.validated-customization-draft/v1"),
  project_ref: z.string().min(1),
  capability_gap: z.object({
    route_input: indexerProviderRouteInputSchema,
    route_report: indexerProviderRouteReportSchema,
  }).strict(),
  capability_gap_digest: indexerDigestSchema,
  source_registry_digest: indexerDigestSchema,
  source_indexer_selection_digest: indexerDigestSchema,
  indexer_id: indexerIdSchema,
  provider: z.object({
    id: indexerIdSchema,
    skill: indexerIdSchema,
    version: z.string().min(1),
    integrity: indexerDigestSchema,
  }).strict(),
  selected_step: extendStepSchema,
  target_registry: indexerRegistrySchema,
  customization_plan: indexerCustomizationPlanSchema,
  files: z.array(z.object({
    path: portableIndexerPathSchema,
    content: z.string().min(1).max(4 * 1024 * 1024),
    content_digest: indexerDigestSchema,
  }).strict()).min(1),
  selection_proposal_input: z.object({
    protocol: z.literal("context.indexer.selection-proposal-input/v1"),
    project_ref: z.string().min(1),
    registry: indexerRegistrySchema,
  }).strict(),
}).strict();

export const validatedIndexerCustomizationDraftSchema =
  validatedDraftPayloadSchema.extend({
    validation_digest: indexerDigestSchema,
  }).strict();

export type ValidatedIndexerCustomizationDraft = z.infer<
  typeof validatedIndexerCustomizationDraftSchema
>;

function expectedScopeRefs(draft: IndexerCustomizationDraft): string[] {
  const proof = draft.capability_gap.route_report.capability_gap_proof!;
  return [...new Set(proof.gaps.map((gap) =>
    `requirement:${gap.requirement_ref!}#target_scope`
  ))].sort(compareIndexerCanonicalText);
}

function allOwnerCells(input: {
  registry: IndexerRegistry;
  requirementRef: string;
  coverageDomain: string;
}): string[] {
  const requirement = input.registry.requirements.find((item) =>
    item.id === input.requirementRef
  );
  if (requirement === undefined) return [];
  return requirement.target_scope.targets.flatMap((target) => {
    const modules = target.module_refs.length === 0 ? [null] : target.module_refs;
    return modules.map((moduleRef) => canonicalOwnerCellRef({
      requirementRef: input.requirementRef,
      coverageDomain: input.coverageDomain,
      sourceRef: target.source_ref,
      moduleRef,
    }));
  }).sort(compareIndexerCanonicalText);
}

function closeOneRequirementGap(input: {
  registry: IndexerRegistry;
  indexer: IndexerRegistryEntry;
  requirementRef: string;
  coverageDomains: readonly string[];
  gapOwnerCells: ReadonlySet<string>;
}): void {
  const missingCells = input.coverageDomains.flatMap((coverageDomain) =>
    allOwnerCells({
      registry: input.registry,
      requirementRef: input.requirementRef,
      coverageDomain,
    })
  );
  if (missingCells.some((cell) => !input.gapOwnerCells.has(cell))) {
    throw new TypeError(
      "minimal customization cannot infer ownership for a partially covered requirement domain",
    );
  }
  const scopeRef = `requirement:${input.requirementRef}#target_scope`;
  const existing = input.indexer.requirement_bindings.find((binding) =>
    binding.requirement_ref === input.requirementRef &&
    binding.role === "primary" &&
    "ref" in binding.owned_scope &&
    binding.owned_scope.ref === scopeRef
  );
  if (existing === undefined) {
    input.indexer.requirement_bindings.push({
      requirement_ref: input.requirementRef,
      coverage_domains: [...input.coverageDomains].sort(compareIndexerCanonicalText),
      owned_scope: { ref: scopeRef },
      role: "primary",
    });
  } else {
    existing.coverage_domains = [...new Set([
      ...existing.coverage_domains,
      ...input.coverageDomains,
    ])].sort(compareIndexerCanonicalText);
  }
  input.indexer.read_scope.refs = [...new Set([
    ...input.indexer.read_scope.refs,
    scopeRef,
  ])].sort(compareIndexerCanonicalText);
}

function targetRegistry(draft: IndexerCustomizationDraft): IndexerRegistry {
  const registry = structuredClone(draft.capability_gap.route_input.registry);
  const indexer = registry.indexers.find((item) => item.id === draft.indexer_id);
  if (indexer === undefined) {
    throw new TypeError("customization draft must extend one selected fallback Indexer");
  }
  if (indexer.customization !== undefined) {
    throw new TypeError("minimal customization draft requires a Provider-only base selection");
  }
  const proof = draft.capability_gap.route_report.capability_gap_proof!;
  const gapOwnerCells = new Set(proof.gaps.flatMap((gap) =>
    gap.owner_cell_ref === null ? [] : [gap.owner_cell_ref]
  ));
  const domainsByRequirement = new Map<string, Set<string>>();
  for (const gap of proof.gaps) {
    if (
      gap.owner_cell_ref === null ||
      gap.requirement_ref === null ||
      gap.coverage_domain === null
    ) {
      throw new TypeError("customization draft requires structured owner-cell capability gaps");
    }
    const domains = domainsByRequirement.get(gap.requirement_ref) ?? new Set<string>();
    domains.add(gap.coverage_domain);
    domainsByRequirement.set(gap.requirement_ref, domains);
  }
  for (const [requirementRef, domains] of domainsByRequirement) {
    closeOneRequirementGap({
      registry,
      indexer,
      requirementRef,
      coverageDomains: [...domains],
      gapOwnerCells,
    });
  }
  indexer.requirement_bindings.sort((left, right) => compareIndexerCanonicalText(
    `${left.requirement_ref}\u0000${left.role}\u0000${canonicalIndexerJson(left.owned_scope)}`,
    `${right.requirement_ref}\u0000${right.role}\u0000${canonicalIndexerJson(right.owned_scope)}`,
  ));
  indexer.customization = { mode: "extend" };
  validateFinalizedIndexerRegistry(registry);
  return registry;
}

function fileCapability(path: string): IndexerCustomizationLadderStep {
  if (path.endsWith("/instructions.md")) return "instructions-append";
  if (/\/templates\/[a-z0-9][a-z0-9._/-]*\.md$/u.test(path)) {
    return "template-override";
  }
  if (/\/(?:index|variables|helpers)\.ts$/u.test(path)) return "program-extend";
  throw new TypeError(`customization draft contains an unsupported path: ${path}`);
}

function validateDraftFiles(input: {
  draft: IndexerCustomizationDraft;
  indexer: IndexerRegistryEntry;
}): ValidatedIndexerCustomizationDraft["files"] {
  const prefix = `src/indexer/${input.indexer.id}/`;
  const primary = input.indexer.providers.find((provider) => provider.role === "primary")!;
  const activeProfiles = new Set([
    input.indexer.profile.primary.id,
    ...(input.indexer.profile.additional ?? []).map((profile) => profile.id),
  ]);
  const ranks = new Map<IndexerCustomizationLadderStep, number>([
    ["instructions-append", 0],
    ["template-override", 1],
    ["program-extend", 2],
  ]);
  const selectedRank = ranks.get(input.draft.selected_step)!;
  const seen = new Set<string>();
  const files = input.draft.files.map((file) => {
    if (!file.path.startsWith(prefix) || seen.has(file.path)) {
      throw new TypeError("customization draft file path is duplicate or outside its fixed Indexer root");
    }
    seen.add(file.path);
    const capability = fileCapability(file.path);
    if (ranks.get(capability)! > selectedRank) {
      throw new TypeError("customization draft contains a file above its selected ladder step");
    }
    const firstLine = file.content.split(/\r?\n/u, 1)[0] ?? "";
    const origin = firstLine.match(
      /@context-indexer-origin\s+([a-z0-9][a-z0-9._/-]*)@([^\s]+)\s+profile=([a-z0-9][a-z0-9._/-]*)/u,
    );
    if (
      origin?.[1] !== primary.skill ||
      origin[2] !== primary.version ||
      !activeProfiles.has(origin[3]!)
    ) {
      throw new TypeError("customization draft file has no exact current Provider origin");
    }
    return {
      path: file.path,
      content: file.content,
      content_digest: `sha256:${createHash("sha256").update(file.content).digest("hex")}`,
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.path, right.path));
  if (!files.some((file) => fileCapability(file.path) === input.draft.selected_step)) {
    throw new TypeError("customization draft does not contain its selected ladder step");
  }
  return files;
}

export function buildValidatedIndexerCustomizationDraft(
  value: unknown,
): ValidatedIndexerCustomizationDraft {
  const draft = indexerCustomizationDraftSchema.parse(value);
  const proof = validateIndexerCapabilityGapProof({
    route_input: draft.capability_gap.route_input,
    report: draft.capability_gap.route_report,
  });
  if (proof.gap_digest !== draft.capability_gap_digest) {
    throw new TypeError("customization draft does not consume the exact CLI capability gap");
  }
  const scopes = expectedScopeRefs(draft);
  if (canonicalIndexerJson(scopes) !== canonicalIndexerJson(
    [...draft.affected_scope_refs].sort(compareIndexerCanonicalText),
  )) {
    throw new TypeError("customization draft affected scopes do not match the CLI capability gap");
  }
  const registry = targetRegistry(draft);
  const sourceDigests = indexerRegistryDigests(draft.capability_gap.route_input.registry);
  const indexer = registry.indexers.find((item) => item.id === draft.indexer_id)!;
  const primary = indexer.providers.find((provider) => provider.role === "primary")!;
  const files = validateDraftFiles({ draft, indexer });
  const plan = buildIndexerCustomizationPlan({
    project_ref: proof.project_ref,
    indexer_id: indexer.id,
    provider_integrity: primary.integrity,
    capability_gap_digest: proof.gap_digest,
    selected_step: draft.selected_step,
    rejected_smaller_steps: draft.rejected_smaller_steps,
    affected_scope_refs: scopes,
    introduces_external_dependencies: false,
  });
  const payload = validatedDraftPayloadSchema.parse({
    protocol: "context.indexer.validated-customization-draft/v1",
    project_ref: proof.project_ref,
    capability_gap: draft.capability_gap,
    capability_gap_digest: proof.gap_digest,
    source_registry_digest: sourceDigests.registryDigest,
    source_indexer_selection_digest: sourceDigests.indexerSelectionDigest,
    indexer_id: indexer.id,
    provider: {
      id: primary.id,
      skill: primary.skill,
      version: primary.version,
      integrity: primary.integrity,
    },
    selected_step: draft.selected_step,
    target_registry: registry,
    customization_plan: plan,
    files,
    selection_proposal_input: {
      protocol: "context.indexer.selection-proposal-input/v1",
      project_ref: proof.project_ref,
      registry,
    },
  });
  return validatedIndexerCustomizationDraftSchema.parse({
    ...payload,
    validation_digest: indexerProtocolDigest(payload),
  });
}

export function validateValidatedIndexerCustomizationDraft(
  value: unknown,
): ValidatedIndexerCustomizationDraft {
  const validated = validatedIndexerCustomizationDraftSchema.parse(value);
  const { validation_digest: _digest, ...payload } = validated;
  void _digest;
  if (indexerProtocolDigest(payload) !== validated.validation_digest) {
    throw new TypeError("validated customization draft digest is invalid");
  }
  validateFinalizedIndexerRegistry(validated.target_registry);
  const proof = validateIndexerCapabilityGapProof({
    route_input: validated.capability_gap.route_input,
    report: validated.capability_gap.route_report,
  });
  if (
    proof.project_ref !== validated.project_ref ||
    proof.gap_digest !== validated.capability_gap_digest ||
    canonicalIndexerJson(validated.selection_proposal_input.registry) !==
      canonicalIndexerJson(validated.target_registry) ||
    validated.selection_proposal_input.project_ref !== validated.project_ref ||
    validated.customization_plan.project_ref !== validated.project_ref ||
    validated.customization_plan.indexer_id !== validated.indexer_id ||
    validated.customization_plan.capability_gap_digest !==
      validated.capability_gap_digest ||
    validated.customization_plan.plan_digest === undefined
  ) {
    throw new TypeError("validated customization draft bindings are invalid");
  }
  for (const file of validated.files) {
    const actual = `sha256:${createHash("sha256").update(file.content).digest("hex")}`;
    if (actual !== file.content_digest) {
      throw new TypeError(`validated customization draft file digest is invalid: ${file.path}`);
    }
  }
  return validated;
}
