import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  indexerRegistryDigests,
  parseIndexerRegistry,
  planIndexerPostAuthorComposition,
  resolveEffectiveIndexerComposers,
} from "@c4a/context";
import {
  acceptIndexerPostAuthorRunStore,
  composeIndexerPostAuthorEnvelopeStore,
  failIndexerPostAuthorRunStore,
  observeIndexerPostAuthorRunStore,
  prepareIndexerPostAuthorRunStore,
  startIndexerPostAuthorRunStore,
} from "./indexerPostAuthorRunStore.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function protocol(value: Record<string, unknown>, expected: string): void {
  if (value.protocol !== expected) {
    throw new TypeError(`post-author input.protocol must be ${expected}`);
  }
}

async function assertCurrentRequirement(
  projectRoot: string,
  digest: unknown,
): Promise<void> {
  const registry = parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  if (
    typeof digest !== "string" ||
    digest !== indexerRegistryDigests(registry).requirementSetDigest
  ) {
    throw new TypeError("post-author lifecycle input targets a stale requirement set");
  }
}

export async function resolveProjectIndexerEffectiveComposers(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "effective composer input");
  protocol(value, "context.indexer.effective-composer-resolution-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  return resolveEffectiveIndexerComposers(
    value as unknown as Parameters<typeof resolveEffectiveIndexerComposers>[0],
  );
}

export async function buildProjectIndexerPostAuthorWorksets(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "post-author workset input");
  protocol(value, "context.indexer.post-author-workset-build-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  const plan = planIndexerPostAuthorComposition(
    value as unknown as Parameters<typeof planIndexerPostAuthorComposition>[0],
  );
  const observed = await prepareIndexerPostAuthorRunStore({
    projectRoot: input.projectRoot,
    requirement_set_digest: String(value.requirement_set_digest ?? ""),
    plan,
    effective_composer_set: value.effective_composer_set as Parameters<
      typeof prepareIndexerPostAuthorRunStore
    >[0]["effective_composer_set"],
    validator_contract_digest: String(value.validator_contract_digest ?? ""),
    accepted_input_view_digest: String(value.accepted_input_view_digest ?? ""),
  });
  return {
    protocol: "context.indexer.post-author-workset-build/v1" as const,
    plan,
    ledger: observed.ledger,
    status: observed.status,
    expected_envelope: observed.expected_envelope,
  };
}

export async function startProjectIndexerPostAuthorRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "post-author run start input");
  protocol(value, "context.indexer.post-author-run-start-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  const started = await startIndexerPostAuthorRunStore({
    projectRoot: input.projectRoot,
    plan: value.plan as Parameters<typeof startIndexerPostAuthorRunStore>[0]["plan"],
    ledger: value.ledger,
    composer_ref: String(value.composer_ref ?? ""),
  });
  return {
    protocol: "context.indexer.post-author-run-start/v1" as const,
    ledger: started.ledger,
    request: started.request,
  };
}

export async function acceptProjectIndexerPostAuthorRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "post-author run acceptance input");
  protocol(value, "context.indexer.post-author-run-accept-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  const accepted = await acceptIndexerPostAuthorRunStore({
    projectRoot: input.projectRoot,
    plan: value.plan as Parameters<typeof acceptIndexerPostAuthorRunStore>[0]["plan"],
    ledger: value.ledger,
    composer_ref: String(value.composer_ref ?? ""),
    result: value.result,
    validator_contract_digest: String(value.validator_contract_digest ?? ""),
  });
  return {
    protocol: "context.indexer.post-author-run-acceptance/v1" as const,
    ledger: accepted.ledger,
  };
}

export async function failProjectIndexerPostAuthorRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "post-author run failure input");
  protocol(value, "context.indexer.post-author-run-fail-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  const failed = await failIndexerPostAuthorRunStore({
    projectRoot: input.projectRoot,
    plan: value.plan as Parameters<typeof failIndexerPostAuthorRunStore>[0]["plan"],
    ledger: value.ledger,
    composer_ref: String(value.composer_ref ?? ""),
    reason_code: String(value.reason_code ?? ""),
    dependency_digests: Array.isArray(value.dependency_digests)
      ? value.dependency_digests.map(String)
      : [],
  });
  return {
    protocol: "context.indexer.post-author-run-failure/v1" as const,
    ledger: failed.ledger,
  };
}

function observationInput(value: Record<string, unknown>) {
  return {
    plan: value.plan as Parameters<typeof observeIndexerPostAuthorRunStore>[0]["plan"],
    ledger: value.ledger,
    effective_composer_set: value.effective_composer_set as Parameters<
      typeof observeIndexerPostAuthorRunStore
    >[0]["effective_composer_set"],
    validator_contract_digest: String(value.validator_contract_digest ?? ""),
    accepted_input_view_digest: String(value.accepted_input_view_digest ?? ""),
  };
}

export async function observeProjectIndexerPostAuthorState(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "post-author observation input");
  protocol(value, "context.indexer.post-author-observation-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  if (value.current_envelope !== undefined) {
    throw new TypeError("post-author current envelope is owned by the runtime store");
  }
  return {
    protocol: "context.indexer.post-author-observation/v1" as const,
    ...await observeIndexerPostAuthorRunStore({
      projectRoot: input.projectRoot,
      ...observationInput(value),
    }),
  };
}

export async function composeProjectIndexerPostAuthorEnvelope(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "post-author composition input");
  protocol(value, "context.indexer.post-author-compose-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  if (value.current_envelope !== undefined) {
    throw new TypeError("post-author current envelope is owned by the runtime store");
  }
  const composed = await composeIndexerPostAuthorEnvelopeStore({
    projectRoot: input.projectRoot,
    ...observationInput(value),
  });
  return {
    protocol: "context.indexer.post-author-composition/v1" as const,
    envelope: composed.envelope,
    ledger: composed.ledger,
    status: composed.status,
  };
}
