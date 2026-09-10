import { assertApprovedKnowledgeInputCurrent, assertApprovedKnowledgeSourcesCurrent } from "./approvedKnowledgeInput.js";
import type { AuthorSupplementarySource } from "./indexerCurrentMainRunSpec.js";
import type { ApprovedKnowledgeAuthorInput } from "./approvedKnowledgeAuthorView.js";
import {
  buildIndexerSourceIdentityInventory,
  canonicalIndexerInventoryMembers,
  indexerMainRunResultSchema,
  indexerInventoryMembersDigest,
  validateAndRecordIndexerMainRun,
  validateIndexerAuthorDependencyView,
  validateIndexerSubjectKeyForContract,
  validateIndexerMainRunRequest,
} from "@c4a/context";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import {
  assertProjectIndexerMainSourceBinding,
  resolveProjectIndexerMainSourceBinding,
} from "./indexerMainSourceAdapter.js";
import { projectIndexerReadTargets, projectIndexerReadTargetAllows } from "./indexerReadScopeAuthorization.js";
import { indexerParserTaskSelection } from "./indexerParserTaskSelection.js";
import { authorSourceIdentityForView } from "./indexerAuthorMaterial.js";
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
  const request = validateIndexerMainRunRequest(value.request);
  const workset = request.workset;
  const validation = record(value.validation, "main Indexer run validation");
  const binding = await resolveProjectIndexerMainSourceBinding({
    projectRoot: input.projectRoot,
    indexer_id: workset.indexer_id,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    profile_contract_digest: workset.profile_contract_digest,
    parser_selection: indexerParserTaskSelection({
      stage: workset.stage, source_ref: workset.source_ref, module_ref: workset.module_ref, validation,
    }),
  });
  assertProjectIndexerMainSourceBinding({
    workset,
    binding,
    partition_projection: validation.partition_projection,
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
      projectRoot: input.projectRoot,
      registry,
      indexer_id: String(workset.indexer_id),
    });
    const profileSubjectSchema = authority.profile_contract.subject_key_schemas.find((schema) =>
      schema.profile === authority.profile.id
    );
    if (profileSubjectSchema === undefined) {
      throw new TypeError(`missing partition SubjectKey contract for ${authority.profile.id}`);
    }
    const { profile: _profile, ...subjectKeyContract } = profileSubjectSchema;
    void _profile;
    // Validate the actual subject against today's contract. A changed schema
    // fingerprint alone does not make a previously valid subject unusable.
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
    const canonicalInventory = canonicalIndexerInventoryMembers(
      array(
        validation.canonical_inventory_members,
        "canonical_inventory_members",
      ) as Parameters<typeof canonicalIndexerInventoryMembers>[0],
    );
    if (
      indexerInventoryMembersDigest(canonicalInventory) !==
        workset.partition_inventory_digest
    ) {
      throw new TypeError("partition validation uses stale workset inventory members");
    }
    const bindingMembers = new Map(binding.partition_inventory.map((member) => [
      member.member_id,
      indexerInventoryMembersDigest([member]),
    ]));
    if (canonicalInventory.some((member) =>
      bindingMembers.get(member.member_id) !== indexerInventoryMembersDigest([member])
    )) {
      throw new TypeError("partition validation contains inventory outside its source binding");
    }
    validation.canonical_inventory_members = canonicalInventory;
  } else {
    if (validation.knowledge_input !== undefined) {
      const knowledge = validation.knowledge_input as ApprovedKnowledgeAuthorInput;
      await assertApprovedKnowledgeInputCurrent(input.projectRoot, knowledge);
      const supporting = [binding];
      const readTargets = projectIndexerReadTargets({ registry, indexer_id: workset.indexer_id });
      for (const descriptor of (validation.supplementary_sources ?? []) as AuthorSupplementarySource[]) {
        if (!knowledge.evidence_bindings.some(evidence => evidence.source_ref === descriptor.source_ref && evidence.module_ref === descriptor.module_ref)) continue;
        if (!projectIndexerReadTargetAllows({ targets: readTargets, source_ref: descriptor.source_ref, module_ref: descriptor.module_ref })) {
          throw new TypeError("Supporting source is outside the current Indexer read scope");
        }
        supporting.push(await resolveProjectIndexerMainSourceBinding({ projectRoot: input.projectRoot, indexer_id: descriptor.indexer_id,
          source_ref: descriptor.source_ref, module_ref: descriptor.module_ref, profile_contract_digest: descriptor.profile_contract_digest,
          parser_selection: indexerParserTaskSelection({ stage: "author", source_ref: descriptor.source_ref, module_ref: descriptor.module_ref, validation }),
        }));
      }
      assertApprovedKnowledgeSourcesCurrent(knowledge, supporting);
    }
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
    const scopedInventory = binding.adapter === "parser-facts"
      ? authorSourceIdentityForView({
          inventory: binding.source_identity_inventory,
          dependency_view: dependencyView,
        })
      : binding.source_identity_inventory;
    if (typeof scopedInventory.source_ref !== "string") {
      throw new TypeError("author source identity inventory has no source_ref");
    }
    if (typeof workset.source_binding_digest !== "string") {
      throw new TypeError("author workset has no source binding digest");
    }
    const expectedSourceIdentityInventory = buildIndexerSourceIdentityInventory({
      source_ref: scopedInventory.source_ref,
      module_ref: scopedInventory.module_ref,
      source_input_digest: workset.source_binding_digest,
      files: scopedInventory.files,
    });
    const currentFiles = new Map(scopedInventory.files.map((file) => [file.normalized_path, file.content_digest]));
    for (const node of dependencyView.positive_nodes) {
      if (node.kind !== "source-span" || node.source_ref !== scopedInventory.source_ref ||
          node.module_ref !== scopedInventory.module_ref) continue;
      if (currentFiles.get(node.locator.path) !== node.content_digest) {
        throw new TypeError(`Source file ${node.locator.path} changed or is missing; refresh the current task's source material`);
      }
    }
    // This is a derived lookup table, not Agent-owned input. Rebuild it from
    // current scoped sources; Artifact validation still checks actual targets.
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
