import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerMaterialQuestionWorkset,
} from "@c4a/context";
import { materialAnswerEvidenceReadResolver } from "./indexerMaterialAnswerEvidenceReads.js";
import {
  acceptIndexerMaterialAnswerRunStore,
  failIndexerMaterialAnswerRunStore,
  observeIndexerMaterialAnswerRunStore,
  prepareIndexerMaterialAnswerRunStore,
  startIndexerMaterialAnswerRunStore,
} from "./indexerMaterialAnswerRunStore.js";
import { buildProjectIndexerMaterialAnswerExecutionPlan } from "./indexerMaterialQuestionActions.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function protocol(value: Record<string, unknown>, expected: string): void {
  if (value.protocol !== expected) {
    throw new TypeError(`material-answer run input.protocol must be ${expected}`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

async function assertCurrentRequirement(
  projectRoot: string,
  requirementSetDigest: unknown,
 ) {
  const registry = parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const current = indexerRegistryDigests(registry);
  if (requirementSetDigest !== current.requirementSetDigest) {
    throw new TypeError("material-answer run input targets a stale requirement set");
  }
  return { registry, ...current };
}

function assertExecutionAuthorities(
  registry: Awaited<ReturnType<typeof assertCurrentRequirement>>["registry"],
  value: unknown,
): void {
  for (const candidate of list(value, "material-answer execution authorities")) {
    const authority = record(candidate, "material-answer execution authority");
    const indexerId = text(authority.answer_indexer_id, "answer_indexer_id");
    const indexer = registry.indexers.find((item) => item.id === indexerId);
    const primary = indexer?.providers.find((provider) => provider.role === "primary");
    const finalAuthority = record(authority.final_authority, "material-answer final authority");
    if (
      indexer === undefined ||
      primary === undefined ||
      !indexer.operations.includes("material-answer") ||
      finalAuthority.integrity !== primary.integrity ||
      finalAuthority.layer_ref !== `provider:${primary.id}#layer:primary`
    ) {
      throw new TypeError(
        "material-answer execution authority does not match the current primary Provider",
      );
    }
  }
}

export async function prepareProjectIndexerMaterialAnswerRuns(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "prepare material-answer runs input");
  protocol(value, "context.indexer.prepare-material-answer-runs-input/v1");
  const current = await assertCurrentRequirement(
    input.projectRoot,
    value.requirement_set_digest,
  );
  const workset = validateIndexerMaterialQuestionWorkset(value.workset);
  if (
    workset.registry_digest !== current.registryDigest ||
    workset.requirement_set_digest !== current.requirementSetDigest
  ) {
    throw new TypeError("material-answer execution plan targets a stale registry");
  }
  assertExecutionAuthorities(current.registry, value.authorities);
  const plan = buildProjectIndexerMaterialAnswerExecutionPlan(value);
  return {
    protocol: "context.indexer.material-answer-run-preparation/v1" as const,
    ...await prepareIndexerMaterialAnswerRunStore({
      projectRoot: input.projectRoot,
      requirement_set_digest: current.requirementSetDigest,
      registry_digest: current.registryDigest,
      plan,
    }),
  };
}

export async function startProjectIndexerMaterialAnswerRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "start material-answer run input");
  protocol(value, "context.indexer.start-material-answer-run-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  return {
    protocol: "context.indexer.material-answer-run-start/v1" as const,
    ...await startIndexerMaterialAnswerRunStore({
      projectRoot: input.projectRoot,
      plan_digest: text(value.plan_digest, "material-answer plan_digest"),
      expected_revision: text(value.expected_revision, "material-answer expected_revision"),
      run_ref: text(value.run_ref, "material-answer run_ref"),
    }),
  };
}

export async function acceptProjectIndexerMaterialAnswerRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "accept material-answer run input");
  protocol(value, "context.indexer.accept-material-answer-run-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  const receipts = list(
    value.evidence_read_receipts,
    "material-answer evidence_read_receipts",
  );
  const readerAuthority = text(
    value.reader_authority_digest,
    "material-answer reader_authority_digest",
  );
  const evidenceReads = materialAnswerEvidenceReadResolver({
    receipts,
    expected_reader_authority_digest: readerAuthority,
  });
  const readReceiptRecord = {
    protocol: "context.indexer.material-answer-evidence-read-receipt-set-record/v1",
    reader_authority_digest: readerAuthority,
    receipts,
    receipt_set_digest: evidenceReads.receipt_set_digest,
  };
  return {
    protocol: "context.indexer.material-answer-run-acceptance/v1" as const,
    ...await acceptIndexerMaterialAnswerRunStore({
      projectRoot: input.projectRoot,
      plan_digest: text(value.plan_digest, "material-answer plan_digest"),
      expected_revision: text(value.expected_revision, "material-answer expected_revision"),
      run_ref: text(value.run_ref, "material-answer run_ref"),
      result: value.result,
      current_sources: evidenceReads.current_sources,
      resolve_evidence_digest: evidenceReads.resolve_evidence_digest,
      assert_evidence_reads_consumed: evidenceReads.assert_all_consumed,
      read_receipt_set_digest: evidenceReads.receipt_set_digest,
      read_receipt_record: readReceiptRecord,
    }),
  };
}

export async function failProjectIndexerMaterialAnswerRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "fail material-answer run input");
  protocol(value, "context.indexer.fail-material-answer-run-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  return {
    protocol: "context.indexer.material-answer-run-failure/v1" as const,
    ...await failIndexerMaterialAnswerRunStore({
      projectRoot: input.projectRoot,
      plan_digest: text(value.plan_digest, "material-answer plan_digest"),
      expected_revision: text(value.expected_revision, "material-answer expected_revision"),
      run_ref: text(value.run_ref, "material-answer run_ref"),
      reason_code: text(value.reason_code, "material-answer reason_code"),
      dependency_digests: list(
        value.dependency_digests,
        "material-answer dependency_digests",
      ).map((item) => text(item, "material-answer dependency digest")),
    }),
  };
}

export async function observeProjectIndexerMaterialAnswerRuns(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "observe material-answer runs input");
  protocol(value, "context.indexer.observe-material-answer-runs-input/v1");
  await assertCurrentRequirement(input.projectRoot, value.requirement_set_digest);
  return {
    protocol: "context.indexer.material-answer-run-observation-result/v1" as const,
    ...await observeIndexerMaterialAnswerRunStore({
      projectRoot: input.projectRoot,
      plan_digest: text(value.plan_digest, "material-answer plan_digest"),
      expected_revision: text(value.expected_revision, "material-answer expected_revision"),
    }),
  };
}
