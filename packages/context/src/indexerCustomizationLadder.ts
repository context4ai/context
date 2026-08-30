import { z } from "zod";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const INDEXER_CUSTOMIZATION_LADDER_STEPS = [
  "provider-only",
  "config",
  "instructions-append",
  "template-override",
  "program-extend",
  "replace",
] as const;

export const indexerCustomizationLadderStepSchema = z.enum(
  INDEXER_CUSTOMIZATION_LADDER_STEPS,
);

export type IndexerCustomizationLadderStep = z.infer<
  typeof indexerCustomizationLadderStepSchema
>;

const rejectedStepSchema = z.object({
  step: indexerCustomizationLadderStepSchema,
  disposition: z.enum(["unsupported", "insufficient"]),
  reason_code: indexerIdSchema,
  evidence_digest: indexerDigestSchema,
}).strict();

const customizationPlanPayloadSchema = z.object({
  protocol: z.literal("context.indexer.customization-plan/v1"),
  project_ref: z.string().min(1),
  indexer_id: indexerIdSchema,
  provider_integrity: indexerDigestSchema,
  capability_gap_digest: indexerDigestSchema.nullable(),
  selected_step: indexerCustomizationLadderStepSchema,
  rejected_smaller_steps: z.array(rejectedStepSchema),
  extend_attempt_digests: z.array(indexerDigestSchema),
  affected_scope_refs: z.array(z.string().min(1)).min(1),
  introduces_external_dependencies: z.boolean(),
  workspace_mode: z.enum(["registry-only", "extend", "replace"]),
  requires_human_confirmation: z.boolean(),
}).strict();

export const indexerCustomizationPlanSchema = customizationPlanPayloadSchema.extend({
  plan_digest: indexerDigestSchema,
}).strict();

export type IndexerCustomizationPlan = z.infer<
  typeof indexerCustomizationPlanSchema
>;

function planPayload(
  plan: IndexerCustomizationPlan,
): Omit<IndexerCustomizationPlan, "plan_digest"> {
  const { plan_digest: _digest, ...payload } = plan;
  void _digest;
  return payload;
}

function expectedWorkspaceMode(
  step: IndexerCustomizationLadderStep,
): IndexerCustomizationPlan["workspace_mode"] {
  if (step === "provider-only" || step === "config") return "registry-only";
  if (step === "replace") return "replace";
  return "extend";
}

function validateLadder(plan: Omit<IndexerCustomizationPlan, "plan_digest">): void {
  const selectedIndex = INDEXER_CUSTOMIZATION_LADDER_STEPS.indexOf(
    plan.selected_step,
  );
  const expectedRejected = INDEXER_CUSTOMIZATION_LADDER_STEPS.slice(
    0,
    selectedIndex,
  );
  const actualRejected = plan.rejected_smaller_steps.map((item) => item.step);
  if (canonicalIndexerJson(actualRejected) !== canonicalIndexerJson(expectedRejected)) {
    throw new TypeError(
      "customization plan must close every smaller ladder step in order",
    );
  }
  if (
    plan.selected_step === "provider-only" && plan.capability_gap_digest !== null
  ) {
    throw new TypeError("provider-only selection cannot claim a capability gap");
  }
  if (
    plan.selected_step !== "provider-only" && plan.capability_gap_digest === null
  ) {
    throw new TypeError("customization beyond Provider-only requires an exact gap");
  }
  if (plan.workspace_mode !== expectedWorkspaceMode(plan.selected_step)) {
    throw new TypeError("customization workspace mode does not match ladder step");
  }
  if (
    plan.selected_step === "replace"
      ? plan.extend_attempt_digests.length !== 3
      : plan.extend_attempt_digests.length !== 0
  ) {
    throw new TypeError("replace requires exactly three failed extend attempts");
  }
  if (
    new Set(plan.extend_attempt_digests).size !== plan.extend_attempt_digests.length
  ) {
    throw new TypeError("extend attempt digests must be unique");
  }
  const expectedHuman = plan.selected_step === "replace" ||
    plan.introduces_external_dependencies;
  if (plan.requires_human_confirmation !== expectedHuman) {
    throw new TypeError("customization authority does not match its risk boundary");
  }
  if (
    new Set(plan.affected_scope_refs).size !== plan.affected_scope_refs.length ||
    canonicalIndexerJson(plan.affected_scope_refs) !==
      canonicalIndexerJson([...plan.affected_scope_refs].sort())
  ) {
    throw new TypeError("customization affected scope refs are not canonical");
  }
}

export function buildIndexerCustomizationPlan(input: {
  project_ref: string;
  indexer_id: string;
  provider_integrity: string;
  capability_gap_digest: string | null;
  selected_step: IndexerCustomizationLadderStep;
  rejected_smaller_steps: readonly z.input<typeof rejectedStepSchema>[];
  extend_attempt_digests?: readonly string[];
  affected_scope_refs: readonly string[];
  introduces_external_dependencies: boolean;
}): IndexerCustomizationPlan {
  const selectedStep = indexerCustomizationLadderStepSchema.parse(
    input.selected_step,
  );
  const payload = customizationPlanPayloadSchema.parse({
    protocol: "context.indexer.customization-plan/v1",
    project_ref: input.project_ref,
    indexer_id: input.indexer_id,
    provider_integrity: input.provider_integrity,
    capability_gap_digest: input.capability_gap_digest,
    selected_step: selectedStep,
    rejected_smaller_steps: input.rejected_smaller_steps,
    extend_attempt_digests: input.extend_attempt_digests ?? [],
    affected_scope_refs: [...input.affected_scope_refs].sort(
      compareIndexerCanonicalText,
    ),
    introduces_external_dependencies: input.introduces_external_dependencies,
    workspace_mode: expectedWorkspaceMode(selectedStep),
    requires_human_confirmation: selectedStep === "replace" ||
      input.introduces_external_dependencies,
  });
  validateLadder(payload);
  return indexerCustomizationPlanSchema.parse({
    ...payload,
    plan_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerCustomizationPlan(
  value: unknown,
): IndexerCustomizationPlan {
  const plan = indexerCustomizationPlanSchema.parse(value);
  validateLadder(planPayload(plan));
  if (indexerProtocolDigest(planPayload(plan)) !== plan.plan_digest) {
    throw new TypeError("customization plan digest is invalid");
  }
  return plan;
}
