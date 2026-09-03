import {
  buildIndexerSourceIdentityInventory,
  buildIndexerQuestionTargetInventory,
  indexerInventoryMembersDigest,
  ownerCells,
  type IndexerProfileContract,
} from "@c4a/context";
import { bundledIndexerProfileContract } from "./indexerBaseContracts.js";
import { ensureCurrentProjectIndexerParserExecution } from
  "./indexerParserCurrentExecution.js";
import { resolveProjectIndexerMainSourceBinding } from
  "./indexerMainSourceAdapter.js";
import {
  assertCurrentRequirement,
  protocol,
  record,
} from "./indexerMainLifecycleSupport.js";

function referenceIdentity(value: string): string {
  const separator = value.indexOf(":");
  const body = separator < 0 ? value : value.slice(separator + 1);
  const parts = body.split("/").filter(Boolean);
  return parts.at(-1) ?? body;
}

function normalizedSubjectValue(value: string, rules: readonly string[]): string {
  let normalized = rules.includes("trim") ? value.trim() : value;
  if (rules.includes("unicode-nfc")) normalized = normalized.normalize("NFC");
  if (rules.includes("lowercase")) normalized = normalized.toLocaleLowerCase("en-US");
  return normalized;
}

function questionTargetSubjectKey(input: {
  profile_contract: IndexerProfileContract;
  profile_id: string;
  subject_kind: string;
  source_ref: string;
  module_ref: string | null;
  normalized_path: string | null;
}) {
  const schema = input.profile_contract.subject_key_schemas.find((candidate) =>
    candidate.profile === input.profile_id
  );
  const kind = schema?.kinds.find((candidate) => candidate.id === input.subject_kind);
  if (schema === undefined || kind === undefined) {
    throw new TypeError(`question target SubjectKey schema is missing for ${input.profile_id}`);
  }
  const sourceIdentity = referenceIdentity(input.source_ref);
  const moduleIdentity = input.module_ref === null
    ? sourceIdentity
    : referenceIdentity(input.module_ref);
  const namespace = (() => {
    switch (schema.namespace.operator) {
      case "canonical-source-module-namespace":
      case "canonical-service-namespace":
        return moduleIdentity;
      default:
        throw new TypeError(
          `unsupported question target namespace operator ${schema.namespace.operator}`,
        );
    }
  })();
  const localIdentity = (() => {
    switch (kind.local_key.operator) {
      case "canonical-module-identity":
      case "canonical-export-family":
        return input.normalized_path === null
          ? moduleIdentity
          : input.normalized_path.replace(/\.[^./]+$/u, "");
      default:
        throw new TypeError(
          `unsupported question target local-key operator ${kind.local_key.operator}`,
        );
    }
  })();
  const rules = schema.normalization ?? [];
  return {
    protocol: "context.subject-key/v1" as const,
    namespace: normalizedSubjectValue(namespace, rules),
    kind: normalizedSubjectValue(input.subject_kind, rules),
    local_key: normalizedSubjectValue(localIdentity, rules),
  };
}

export async function buildProjectIndexerQuestionTargetInventory(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "question target inventory input");
  protocol(
    value,
    "context.indexer.question-target-inventory-input/v1",
    "question target inventory input",
  );
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    value.requirement_set_digest,
  );
  const profileContract = bundledIndexerProfileContract();
  const bindingCache = new Map<string, Awaited<ReturnType<
    typeof resolveProjectIndexerMainSourceBinding
  >>>();
  const profileById = new Map(profileContract.profiles.map((profile) => [profile.id, profile]));
  const schemaByProfile = new Map(
    profileContract.subject_key_schemas.map((schema) => [schema.profile, schema]),
  );
  const currentOwners = ownerCells(registry).filter((owner) =>
    !(owner.owner_indexer_ids.length === 0 && owner.obligation === "optional")
  );
  const parserExecutionByIndexer = new Map<string, Awaited<ReturnType<
    typeof ensureCurrentProjectIndexerParserExecution
  >>>();
  await Promise.all([...new Set(currentOwners.flatMap((owner) =>
    owner.source_ref.startsWith("repo:") ? owner.owner_indexer_ids : []
  ))].map(async (indexerId) => {
    parserExecutionByIndexer.set(indexerId, await ensureCurrentProjectIndexerParserExecution({
      projectRoot: input.projectRoot,
      indexer_id: indexerId,
    }));
  }));
  const sourceInventoryDigests = new Set<string>();
  const items: Array<
    Parameters<typeof buildIndexerQuestionTargetInventory>[0]["items"][number]
  > = [];

  for (const owner of currentOwners) {
    if (owner.owner_indexer_ids.length !== 1) {
      throw new TypeError(
        `question target owner ${owner.owner_cell_ref} requires exactly one primary Indexer`,
      );
    }
    const currentIndexer = registry.indexers.find((candidate) =>
      candidate.id === owner.owner_indexer_ids[0]
    );
    if (currentIndexer === undefined) {
      throw new TypeError(`question target owner ${owner.owner_cell_ref} is unresolved`);
    }
    const profileId = currentIndexer.profile.primary.id;
    const profile = profileById.get(profileId);
    const subjectSchema = schemaByProfile.get(profileId);
    if (profile === undefined || subjectSchema === undefined) {
      throw new TypeError(`question target profile ${profileId} is not bundled`);
    }
    if (profile.question_target_domains.length !== 1) {
      throw new TypeError(`question target profile ${profileId} must define one target domain`);
    }
    const targetDomain = profile.question_target_domains[0]!;
    const bindingKey = [currentIndexer.id, owner.source_ref, owner.module_ref ?? ""].join("\u0000");
    let binding = bindingCache.get(bindingKey);
    if (binding === undefined) {
      binding = await resolveProjectIndexerMainSourceBinding({
        projectRoot: input.projectRoot,
        indexer_id: currentIndexer.id,
        source_ref: owner.source_ref,
        module_ref: owner.module_ref,
        profile_contract_digest: profileContract.contract_digest,
        ...(parserExecutionByIndexer.get(currentIndexer.id) === undefined
          ? {}
          : { parser_execution: parserExecutionByIndexer.get(currentIndexer.id)! }),
      });
      bindingCache.set(bindingKey, binding);
    }
    sourceInventoryDigests.add(binding.source_identity_inventory.inventory_digest);
    const targetFiles = targetDomain.granularity === "module"
      ? [null]
      : binding.source_identity_inventory.files;
    for (const targetFile of targetFiles) {
      const subjectKey = questionTargetSubjectKey({
        profile_contract: profileContract,
        profile_id: profileId,
        subject_kind: targetDomain.subject_key_kind,
        source_ref: owner.source_ref,
        module_ref: owner.module_ref,
        normalized_path: targetFile?.normalized_path ?? null,
      });
      const factSliceDigest = targetFile === null
        ? binding.source_identity_inventory.inventory_digest
        : buildIndexerSourceIdentityInventory({
            source_ref: binding.source_identity_inventory.source_ref,
            module_ref: binding.source_identity_inventory.module_ref,
            source_input_digest: binding.source_identity_inventory.source_input_digest,
            files: [targetFile],
          }).inventory_digest;
      items.push({
        target_domain_ref: targetDomain.id,
        requirement_ref: owner.requirement_ref,
        owner_cell_ref: owner.owner_cell_ref,
        source_ref: owner.source_ref,
        module_ref: owner.module_ref,
        subject_key: subjectKey,
        canonical_fact_slice_digest: factSliceDigest,
      });
    }
  }
  return buildIndexerQuestionTargetInventory({
    requirement_set_digest: String(value.requirement_set_digest),
    profile_contract_digests: [profileContract.contract_digest],
    source_inventory_digests: [...sourceInventoryDigests],
    items,
  });
}
