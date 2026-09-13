import {
  buildIndexerSourceIdentityInventory,
  buildIndexerQuestionTargetInventory,
  ownerCells,
} from "@c4a/context";
import { bundledIndexerProfileContract } from "./indexerBaseContracts.js";
import { resolveProjectIndexerMainSourceIdentity } from
  "./indexerMainSourceAdapter.js";
import {
  assertCurrentRequirement,
  protocol,
  record,
} from "./indexerMainLifecycleSupport.js";

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
    typeof resolveProjectIndexerMainSourceIdentity
  >>>();
  const profileById = new Map(profileContract.profiles.map((profile) => [profile.id, profile]));
  const currentOwners = ownerCells(registry).filter((owner) =>
    owner.obligation !== "out-of-scope" &&
    !(owner.owner_indexer_ids.length === 0 && owner.obligation === "optional")
  );
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
    if (profile === undefined) {
      throw new TypeError(`question target profile ${profileId} is not bundled`);
    }
    if (profile.question_target_domains.length !== 1) {
      throw new TypeError(`question target profile ${profileId} must define one target domain`);
    }
    const targetDomain = profile.question_target_domains[0]!;
    const bindingKey = [currentIndexer.id, owner.source_ref, owner.module_ref ?? ""].join("\u0000");
    let binding = bindingCache.get(bindingKey);
    if (binding === undefined) {
      binding = await resolveProjectIndexerMainSourceIdentity({
        projectRoot: input.projectRoot,
        indexer_id: currentIndexer.id,
        source_ref: owner.source_ref,
        module_ref: owner.module_ref,
        profile_contract_digest: profileContract.contract_digest,
        inventory_only: true,
      });
      bindingCache.set(bindingKey, binding);
    }
    sourceInventoryDigests.add(binding.inventory_digest);
    const targetFiles = targetDomain.granularity === "module"
      ? [null]
      : binding.files;
    for (const targetFile of targetFiles) {
      const factSliceDigest = targetFile === null
        ? binding.inventory_digest
        : buildIndexerSourceIdentityInventory({
            source_ref: binding.source_ref,
            module_ref: binding.module_ref,
            source_input_digest: binding.source_input_digest,
            files: [targetFile],
          }).inventory_digest;
      items.push({
        target_domain_ref: targetDomain.id,
        requirement_ref: owner.requirement_ref,
        owner_cell_ref: owner.owner_cell_ref,
        source_ref: owner.source_ref,
        module_ref: owner.module_ref,
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
