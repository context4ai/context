import {
  buildIndexerSourceIdentityInventory,
  canonicalIndexerInventoryMembers,
  indexerMainRunResultSchema,
  indexerInventoryMembersDigest,
  indexerSubjectKeySchemaDigest,
  projectIndexerSourceIdentityInventory,
  validateAndRecordIndexerMainRun,
  validateIndexerAuthorDependencyView,
  validateIndexerSubjectKeyForContract,
} from "@c4a/context";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import {
  assertProjectIndexerMainSourceBinding,
  resolveProjectIndexerMainSourceBinding,
} from "./indexerMainSourceAdapter.js";
import { projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";
import {
  array,
  assertCurrentRequirement,
  assertRequirementRefs,
  protocol,
  record,
} from "./indexerMainLifecycleSupport.js";

export async function validateProjectIndexerMainRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main Indexer run validation input");
  protocol(
    value,
    "context.indexer.main-run-validation-input/v1",
    "main Indexer run validation input",
  );
  const request = record(value.request, "main Indexer run request");
  const workset = record(request.workset, "main Indexer run workset");
  const validation = record(value.validation, "main Indexer run validation");
  const binding = await resolveProjectIndexerMainSourceBinding({
    projectRoot: input.projectRoot,
    indexer_id: workset.indexer_id,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    profile_contract_digest: workset.profile_contract_digest,
  });
  assertProjectIndexerMainSourceBinding({
    workset,
    binding,
    ...(workset.stage === "author"
      ? { dependency_view: validation.dependency_view }
      : {}),
  });
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    workset.requirement_set_digest,
  );
  assertRequirementRefs(registry, [workset.requirement_ref]);
  if (workset.stage === "partition") {
    const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
      registry,
      indexer_id: String(workset.indexer_id),
    });
    const profileSubjectSchema = authority.profile_contract.subject_key_schemas.find((schema) =>
      schema.profile === authority.profile.id
    );
    if (profileSubjectSchema === undefined) {
      throw new TypeError(`missing partition SubjectKey contract for ${authority.profile.id}`);
    }
    const { profile, ...subjectKeyContract } = profileSubjectSchema;
    if (
      indexerSubjectKeySchemaDigest(profile, subjectKeyContract) !==
        workset.subject_key_schema_digest
    ) {
      throw new TypeError("partition validation uses a stale SubjectKey contract");
    }
    const mainResult = indexerMainRunResultSchema.parse(value.result);
    if (mainResult.result.stage !== "partition") {
      throw new TypeError("partition validation requires a partition Result");
    }
    for (const group of mainResult.result.result.groups) {
      validateIndexerSubjectKeyForContract(
        group.subject_key,
        subjectKeyContract,
        authority.profile.id,
      );
    }
    const canonicalInventory = binding.partition_inventory;
    const provided = validation.canonical_inventory_members;
    if (
      provided !== undefined &&
      indexerInventoryMembersDigest(
        array(provided, "canonical_inventory_members") as Parameters<
          typeof indexerInventoryMembersDigest
        >[0],
      ) !== indexerInventoryMembersDigest(canonicalInventory)
    ) {
      throw new TypeError("partition validation uses a stale source adapter inventory");
    }
    validation.canonical_inventory_members = canonicalInventory;
  } else {
    const dependencyView = validateIndexerAuthorDependencyView(
      validation.dependency_view,
    );
    const canonicalInventory = canonicalIndexerInventoryMembers(
      array(
        validation.canonical_inventory_members,
        "canonical_inventory_members",
      ) as Parameters<typeof canonicalIndexerInventoryMembers>[0],
    );
    if (
      indexerInventoryMembersDigest(canonicalInventory) !==
        workset.member_inventory_digest
    ) {
      throw new TypeError("author validation uses stale inventory members");
    }
    const selectedFactRefs = dependencyView.positive_nodes.flatMap((node) =>
      node.kind === "selected-fact" ? [node.fact_ref] : []
    );
    const scopedInventory = binding.adapter === "parser-facts"
      ? projectIndexerSourceIdentityInventory({
          inventory: binding.source_identity_inventory,
          fact_refs: selectedFactRefs,
        })
      : binding.source_identity_inventory;
    const expectedSourceIdentityInventory = buildIndexerSourceIdentityInventory({
      source_ref: scopedInventory.source_ref,
      module_ref: scopedInventory.module_ref,
      source_input_digest: workset.source_binding_digest,
      files: scopedInventory.files,
    });
    const provided = validation.source_identity_inventory;
    if (
      provided !== undefined &&
      record(provided, "source_identity_inventory").inventory_digest !==
        expectedSourceIdentityInventory.inventory_digest
    ) {
      throw new TypeError("author validation uses a stale source identity inventory");
    }
    validation.source_identity_inventory = expectedSourceIdentityInventory;
    validation.canonical_inventory_members = canonicalInventory;
    validation.authorized_evidence_targets = projectIndexerReadTargets({
      registry,
      indexer_id: String(workset.indexer_id),
    });
  }
  try {
    return {
      protocol: "context.indexer.main-run-validation/v1" as const,
      ...validateAndRecordIndexerMainRun(
        {
          ...value,
          validation,
        } as unknown as Parameters<typeof validateAndRecordIndexerMainRun>[0],
      ),
      graph_outcome: "completed" as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = message.includes("index-target-resolution-ambiguous")
      ? "index-target-resolution-ambiguous" as const
      : message.includes("index-target-resolution-invalid")
      ? "index-target-resolution-invalid" as const
      : undefined;
    if (outcome === undefined) throw error;
    return {
      protocol: "context.indexer.target-resolution-outcome/v1" as const,
      outcome,
      conflicts: [],
      message,
      graph_outcome: outcome === "index-target-resolution-ambiguous"
        ? "blocked" as const
        : "failed" as const,
    };
  }
}
