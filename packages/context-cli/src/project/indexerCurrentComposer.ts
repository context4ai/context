import {
  buildIndexerPostAuthorFragmentRequest,
  indexerArtifactResultSchema,
  indexerProtocolDigest,
  indexerRegistryDigests,
  loadIndexerRegistry,
  materializeIndexerPrimaryResultViewFromArtifactResult,
  planIndexerPostAuthorComposition,
  resolveEffectiveIndexerComposers,
  type IndexerComposerDeclaration,
  type IndexerPostAuthorFragmentRequest,
} from "@c4a/context";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import {
  composeIndexerPostAuthorEnvelopeStore,
  prepareIndexerPostAuthorRunStore,
  retryFailedIndexerPostAuthorRunStore,
  startIndexerPostAuthorRunStore,
} from "./indexerPostAuthorRunStore.js";
import { readPostAuthorCurrentState } from "./indexerPostAuthorStorePersistence.js";

type AcceptedAuthorRecord = Awaited<ReturnType<
  typeof readAcceptedIndexerMainAuthorResultRecords
>>[number];

export interface CurrentIndexerComposerContext {
  request: IndexerPostAuthorFragmentRequest;
  record: AcceptedAuthorRecord;
  authority: Awaited<ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>>;
  composer: IndexerComposerDeclaration;
  plan: Parameters<typeof startIndexerPostAuthorRunStore>[0]["plan"];
  ledger: Parameters<typeof startIndexerPostAuthorRunStore>[0]["ledger"];
  validator_contract_digest: string;
  accepted_input_view_digest: string;
  requirement_set_digest: string;
}

async function describeRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
}) {
  const result = indexerArtifactResultSchema.parse(input.record.artifact_result);
  const indexer = input.registry.indexers.find((item) => item.id === result.indexer_id);
  if (indexer === undefined) throw new TypeError(`unknown accepted Indexer ${result.indexer_id}`);
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
    projectRoot: input.projectRoot,
    registry: input.registry,
    indexer_id: indexer.id,
  });
  const selected = indexer.profile.composers ?? [];
  const effective = resolveEffectiveIndexerComposers({
    selections: selected.map((composer) => ({
      id: composer.id,
      provider: composer.provider,
      composer_selection_entry_digest: indexerProtocolDigest({
        indexer_id: indexer.id,
        composer,
      }),
    })),
    manifest_layers: authority.layers.map((layer) => ({
      provider: layer.layer.id,
      layer_ref: `provider:${layer.layer.id}#layer:${layer.layer.role}`,
      layer_integrity: layer.layer.integrity,
      bundle_digest: layer.layer.integrity,
      composers: layer.manifest.provides.composers ?? [],
    })),
    current_profiles: [
      indexer.profile.primary.id,
      ...(indexer.profile.additional ?? []).map((profile) => profile.id),
    ],
  });
  const accepted = acceptedIdentity(input.record);
  const validatorContractDigest = authority.profile_contract.contract_digest;
  const primaryView = materializeIndexerPrimaryResultViewFromArtifactResult({
    artifact_result: result,
    primary_result_digest: accepted.result_digest,
    validator_contract_digest: validatorContractDigest,
  });
  const plan = planIndexerPostAuthorComposition({
    effective_composer_set: effective,
    author_workset_digest: accepted.workset_digest,
    primary_result_digest: accepted.result_digest,
    primary_facts: primaryView.facts,
    primary_artifacts: primaryView.artifacts,
    validator_contract_digest: validatorContractDigest,
    current_profile_binding_digest: indexerProtocolDigest(indexer.profile),
    allowed_target_refs: [result.logical_unit.logical_unit_ref],
  });
  return {
    result,
    authority,
    effective,
    plan,
    validatorContractDigest,
    acceptedInputViewDigest: input.record.run_result.consumed_input_view_digest,
    requirementSetDigest: indexerRegistryDigests(input.registry).requirementSetDigest,
  };
}

function acceptedIdentity(record: AcceptedAuthorRecord): {
  workset_digest: string;
  result_digest: string;
} {
  const value = record.accepted_record;
  return {
    workset_digest: value.workset_digest,
    result_digest: value.result_digest,
  };
}

async function prepareRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
}): Promise<CurrentIndexerComposerContext | undefined> {
  const described = await describeRecord(input);
  const {
    authority,
    effective,
    plan,
    validatorContractDigest,
    acceptedInputViewDigest,
    requirementSetDigest,
  } = described;
  const observed = await prepareIndexerPostAuthorRunStore({
    projectRoot: input.projectRoot,
    requirement_set_digest: requirementSetDigest,
    plan,
    effective_composer_set: effective,
    validator_contract_digest: validatorContractDigest,
    accepted_input_view_digest: acceptedInputViewDigest,
  });
  if (plan.state === "not-required") return undefined;
  if (observed.status.can_reconcile) {
    await composeIndexerPostAuthorEnvelopeStore({
      projectRoot: input.projectRoot,
      plan,
      ledger: observed.ledger,
      effective_composer_set: effective,
      validator_contract_digest: validatorContractDigest,
      accepted_input_view_digest: acceptedInputViewDigest,
    });
    return undefined;
  }
  if (observed.ledger.entries.some((entry) => entry.state === "failed")) {
    const retried = await retryFailedIndexerPostAuthorRunStore({
      projectRoot: input.projectRoot,
      plan,
    });
    observed.ledger = retried.ledger;
  }
  const running = observed.ledger.entries.find((entry) => entry.state === "running");
  const next = running ?? observed.ledger.entries.find((entry) =>
    entry.state === "pending" || entry.state === "stale"
  );
  if (next === undefined) {
    throw new TypeError("post-author composer state cannot advance");
  }
  const started = running === undefined
    ? await startIndexerPostAuthorRunStore({
        projectRoot: input.projectRoot,
        plan,
        ledger: observed.ledger,
        composer_ref: next.composer_ref,
      })
    : {
        ledger: observed.ledger,
        request: buildIndexerPostAuthorFragmentRequest({
          workset: plan.worksets.find((workset) =>
            workset.composer_ref === running.composer_ref
          )!,
          primary_result_view: plan.primary_result_view,
        }),
      };
  const composerId = started.request.composer_ref.slice(
    started.request.composer_ref.lastIndexOf("#composer:") + "#composer:".length,
  );
  const effectiveComposer = effective.entries.find((item) =>
    item.composer_ref === started.request.composer_ref
  );
  const composerLayer = authority.layers.find((item) =>
    item.layer.id === effectiveComposer?.provider
  );
  const composer = (composerLayer?.manifest.provides.composers ?? []).find((item) =>
    item.id === composerId
  );
  if (composer === undefined) throw new TypeError(`current Composer ${composerId} is unavailable`);
  return {
    request: started.request,
    record: input.record,
    authority,
    composer,
    plan,
    ledger: started.ledger,
    validator_contract_digest: validatorContractDigest,
    accepted_input_view_digest: acceptedInputViewDigest,
    requirement_set_digest: requirementSetDigest,
  };
}

async function readRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
}): Promise<CurrentIndexerComposerContext | undefined> {
  const described = await describeRecord(input);
  if (described.plan.state === "not-required") return undefined;
  const state = await readPostAuthorCurrentState(
    input.projectRoot,
    described.plan.workset_set.author_workset_digest,
  );
  const running = state?.ledger.entries.find((entry) => entry.state === "running");
  if (state === undefined || running === undefined) return undefined;
  const workset = described.plan.worksets.find((item) =>
    item.composer_ref === running.composer_ref
  );
  if (workset === undefined) throw new TypeError("current Composer workset is stale");
  const request = buildIndexerPostAuthorFragmentRequest({
    workset,
    primary_result_view: described.plan.primary_result_view,
  });
  const composerId = request.composer_ref.slice(
    request.composer_ref.lastIndexOf("#composer:") + "#composer:".length,
  );
  const effectiveComposer = described.effective.entries.find((item) =>
    item.composer_ref === request.composer_ref
  );
  const composerLayer = described.authority.layers.find((item) =>
    item.layer.id === effectiveComposer?.provider
  );
  const composer = (composerLayer?.manifest.provides.composers ?? []).find((item) =>
    item.id === composerId
  );
  if (composer === undefined) throw new TypeError(`current Composer ${composerId} is unavailable`);
  return {
    request,
    record: input.record,
    authority: described.authority,
    composer,
    plan: described.plan,
    ledger: state.ledger,
    validator_contract_digest: described.validatorContractDigest,
    accepted_input_view_digest: described.acceptedInputViewDigest,
    requirement_set_digest: described.requirementSetDigest,
  };
}

export async function resolveCurrentIndexerComposerContext(
  projectRoot: string,
): Promise<CurrentIndexerComposerContext | undefined> {
  const [loaded, records] = await Promise.all([
    loadIndexerRegistry(projectRoot),
    readAcceptedIndexerMainAuthorResultRecords(projectRoot),
  ]);
  const ordered = [...records].sort((left, right) =>
    left.accepted_record.workset_digest.localeCompare(right.accepted_record.workset_digest)
  );
  for (const record of ordered) {
    const current = await prepareRecord({
      projectRoot,
      record,
      registry: loaded.registry,
    });
    if (current !== undefined) return current;
  }
  return undefined;
}

export async function readCurrentIndexerComposerContext(
  projectRoot: string,
): Promise<CurrentIndexerComposerContext | undefined> {
  const [loaded, records] = await Promise.all([
    loadIndexerRegistry(projectRoot),
    readAcceptedIndexerMainAuthorResultRecords(projectRoot),
  ]);
  const ordered = [...records].sort((left, right) =>
    left.accepted_record.workset_digest.localeCompare(right.accepted_record.workset_digest)
  );
  for (const record of ordered) {
    const current = await readRecord({
      projectRoot,
      record,
      registry: loaded.registry,
    });
    if (current !== undefined) return current;
  }
  return undefined;
}
