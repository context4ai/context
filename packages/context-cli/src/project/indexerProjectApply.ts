import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  indexerProjectContentDigest,
  indexerProtocolDigest,
  indexerRegistryDigests,
  canonicalIndexerJson,
  parseIndexerRegistry,
  validateIndexerProjectProposal,
  type IndexerProjectProposal,
} from "@c4a/context";
import {
  recoverDurableMultiFileTransactions,
  runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector,
  type DurableMultiFileTransactionReceipt,
} from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

const PROPOSAL_ROOT = join(".tmp", "context-runtime", "indexer-proposals");
const APPLY_RECORD_ROOT = join(".tmp", "context-runtime", "indexer-project-applies");
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export interface StagedIndexerProjectProposalReceipt {
  protocol: "context.indexer.project-proposal-stage-receipt/v1";
  proposal_digest: string;
  target_count: number;
  dependency_intent_digest: string;
  reused: boolean;
  receipt_digest: string;
}

export interface IndexerProjectApplyReceipt {
  protocol: "context.indexer.project-apply-receipt/v1";
  proposal_digest: string;
  requirement_set_digest: string;
  registry_document_digest: string;
  registry_digest: string;
  indexer_selection_digest: string;
  validation_report_digests: string[];
  transaction: DurableMultiFileTransactionReceipt | null;
  recovered: boolean;
  observation_digest: string;
  receipt_digest: string;
}

export interface IndexerProjectApplyRecord {
  protocol: "context.indexer.project-apply-record/v1";
  proposal: IndexerProjectProposal;
  receipt: IndexerProjectApplyReceipt;
  record_digest: string;
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSynced(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function proposalPath(projectRoot: string, digest: string): string {
  if (!DIGEST.test(digest)) throw new TypeError("Indexer project proposal digest is invalid");
  return join(projectRoot, PROPOSAL_ROOT, `${digest.slice("sha256:".length)}.json`);
}

function applyRecordPath(projectRoot: string, digest: string): string {
  if (!DIGEST.test(digest)) throw new TypeError("Indexer project proposal digest is invalid");
  return join(projectRoot, APPLY_RECORD_ROOT, `${digest.slice("sha256:".length)}.json`);
}

function stageReceipt(
  proposal: IndexerProjectProposal,
  reused: boolean,
): StagedIndexerProjectProposalReceipt {
  const base = {
    protocol: "context.indexer.project-proposal-stage-receipt/v1" as const,
    proposal_digest: proposal.proposal_digest,
    target_count: proposal.targets.length,
    dependency_intent_digest: proposal.dependencies.intent_set_digest,
    reused,
  };
  return { ...base, receipt_digest: indexerProtocolDigest(base) };
}

export async function stageIndexerProjectProposal(input: {
  projectRoot: string;
  proposal: unknown;
}): Promise<StagedIndexerProjectProposalReceipt> {
  const proposal = validateIndexerProjectProposal(input.proposal);
  const path = proposalPath(input.projectRoot, proposal.proposal_digest);
  const serialized = `${JSON.stringify(proposal, null, 2)}\n`;
  const existing = await readMaybe(path);
  if (existing !== undefined) {
    const parsed = validateIndexerProjectProposal(JSON.parse(existing) as unknown);
    if (parsed.proposal_digest !== proposal.proposal_digest || existing !== serialized) {
      throw new TypeError("content-addressed Indexer project proposal stage is corrupt");
    }
    return stageReceipt(proposal, true);
  }
  const temporary = `${path}.tmp`;
  await writeSynced(temporary, serialized);
  await rename(temporary, path);
  await syncDirectory(dirname(path));
  return stageReceipt(proposal, false);
}

export async function loadStagedIndexerProjectProposal(input: {
  projectRoot: string;
  proposal_digest: string;
}): Promise<IndexerProjectProposal> {
  const path = proposalPath(input.projectRoot, input.proposal_digest);
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("staged Indexer project proposal is invalid JSON");
  }
  const proposal = validateIndexerProjectProposal(parsed);
  if (proposal.proposal_digest !== input.proposal_digest) {
    throw new TypeError("staged Indexer project proposal identity is invalid");
  }
  return proposal;
}

async function fileDigest(projectRoot: string, path: string): Promise<string | null> {
  const content = await readMaybe(join(projectRoot, path));
  return content === undefined ? null : indexerProjectContentDigest(content);
}

async function allTargetsAt(
  projectRoot: string,
  proposal: IndexerProjectProposal,
  state: "base" | "target",
): Promise<boolean> {
  for (const target of proposal.targets) {
    const expected = state === "base" ? target.base_digest : target.target_digest;
    if (await fileDigest(projectRoot, target.path) !== expected) return false;
  }
  return true;
}

function sameDigests(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((digest, index) => digest === right[index]);
}

async function assertBaseRegistry(projectRoot: string, proposal: IndexerProjectProposal): Promise<void> {
  const content = await readFile(join(projectRoot, "src", "indexers.yaml"), "utf8");
  if (indexerProjectContentDigest(content) !== proposal.base_registry.document_digest) {
    throw new TypeError("Indexer project proposal base registry document CAS mismatch");
  }
  const digests = indexerRegistryDigests(parseIndexerRegistry(content));
  if (
    digests.requirementSetDigest !== proposal.base_registry.requirement_set_digest ||
    digests.indexerSelectionDigest !== proposal.base_registry.indexer_selection_digest ||
    digests.registryDigest !== proposal.base_registry.registry_digest
  ) {
    throw new TypeError("Indexer project proposal base registry authority is stale");
  }
}

async function observeTargetRegistry(
  projectRoot: string,
  proposal: IndexerProjectProposal,
): Promise<{ document: string; registry: string; selection: string; observation: string }> {
  const content = await readFile(join(projectRoot, "src", "indexers.yaml"), "utf8");
  const document = indexerProjectContentDigest(content);
  const digests = indexerRegistryDigests(parseIndexerRegistry(content));
  if (
    document !== proposal.target_registry.document_digest ||
    digests.requirementSetDigest !== proposal.target_registry.requirement_set_digest ||
    digests.indexerSelectionDigest !== proposal.target_registry.indexer_selection_digest ||
    digests.registryDigest !== proposal.target_registry.registry_digest
  ) {
    throw new TypeError("applied Indexer registry does not match the proposal target");
  }
  return {
    document,
    registry: digests.registryDigest,
    selection: digests.indexerSelectionDigest,
    observation: indexerProtocolDigest({
      proposal_digest: proposal.proposal_digest,
      document_digest: document,
      ...digests,
    }),
  };
}

function applyReceipt(input: {
  proposal: IndexerProjectProposal;
  observation: Awaited<ReturnType<typeof observeTargetRegistry>>;
  transaction: DurableMultiFileTransactionReceipt | null;
  recovered: boolean;
}): IndexerProjectApplyReceipt {
  const base = {
    protocol: "context.indexer.project-apply-receipt/v1" as const,
    proposal_digest: input.proposal.proposal_digest,
    requirement_set_digest: input.proposal.requirement_set_digest,
    registry_document_digest: input.observation.document,
    registry_digest: input.observation.registry,
    indexer_selection_digest: input.observation.selection,
    validation_report_digests: input.proposal.finalized_validation_report_digests,
    transaction: input.transaction,
    recovered: input.recovered,
    observation_digest: input.observation.observation,
  };
  return { ...base, receipt_digest: indexerProtocolDigest(base) };
}

function validateApplyReceipt(value: unknown): IndexerProjectApplyReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer project apply receipt must be an object");
  }
  const receipt = value as Partial<IndexerProjectApplyReceipt>;
  if (
    receipt.protocol !== "context.indexer.project-apply-receipt/v1" ||
    typeof receipt.proposal_digest !== "string" ||
    typeof receipt.requirement_set_digest !== "string" ||
    typeof receipt.registry_document_digest !== "string" ||
    typeof receipt.registry_digest !== "string" ||
    typeof receipt.indexer_selection_digest !== "string" ||
    !Array.isArray(receipt.validation_report_digests) ||
    typeof receipt.recovered !== "boolean" ||
    typeof receipt.observation_digest !== "string" ||
    typeof receipt.receipt_digest !== "string"
  ) {
    throw new TypeError("Indexer project apply receipt is incomplete");
  }
  const normalized = receipt as IndexerProjectApplyReceipt;
  const { receipt_digest: _digest, ...payload } = normalized;
  void _digest;
  if (indexerProtocolDigest(payload) !== normalized.receipt_digest) {
    throw new TypeError("Indexer project apply receipt digest is invalid");
  }
  return normalized;
}

function validateApplyRecord(value: unknown): IndexerProjectApplyRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer project apply record must be an object");
  }
  const record = value as Partial<IndexerProjectApplyRecord>;
  if (
    record.protocol !== "context.indexer.project-apply-record/v1" ||
    typeof record.record_digest !== "string"
  ) {
    throw new TypeError("Indexer project apply record is incomplete");
  }
  const proposal = validateIndexerProjectProposal(record.proposal, { apply_ready: true });
  const receipt = validateApplyReceipt(record.receipt);
  const payload = { protocol: record.protocol, proposal, receipt };
  if (
    receipt.proposal_digest !== proposal.proposal_digest ||
    indexerProtocolDigest(payload) !== record.record_digest
  ) {
    throw new TypeError("Indexer project apply record identity is invalid");
  }
  return { ...payload, record_digest: record.record_digest };
}

async function persistApplyRecord(input: {
  projectRoot: string;
  proposal: IndexerProjectProposal;
  receipt: IndexerProjectApplyReceipt;
}): Promise<IndexerProjectApplyRecord> {
  const path = applyRecordPath(input.projectRoot, input.proposal.proposal_digest);
  const existing = await readMaybe(path);
  if (existing !== undefined) {
    const record = validateApplyRecord(JSON.parse(existing) as unknown);
    if (canonicalIndexerJson(record.proposal) !== canonicalIndexerJson(input.proposal)) {
      throw new TypeError("content-addressed Indexer project apply record is corrupt");
    }
    return record;
  }
  const payload = {
    protocol: "context.indexer.project-apply-record/v1" as const,
    proposal: input.proposal,
    receipt: input.receipt,
  };
  const record = validateApplyRecord({
    ...payload,
    record_digest: indexerProtocolDigest(payload),
  });
  const temporary = `${path}.tmp`;
  await writeSynced(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, path);
  await syncDirectory(dirname(path));
  return record;
}

export async function loadIndexerProjectApplyRecord(input: {
  projectRoot: string;
  proposal_digest: string;
}): Promise<IndexerProjectApplyRecord> {
  const raw = await readFile(applyRecordPath(input.projectRoot, input.proposal_digest), "utf8");
  return validateApplyRecord(JSON.parse(raw) as unknown);
}

export async function observeAppliedIndexerProjectState(input: {
  projectRoot: string;
  proposal_digest: string;
}): Promise<{
  record: IndexerProjectApplyRecord;
  target_set_digest: string;
}> {
  const record = await loadIndexerProjectApplyRecord(input);
  if (!await allTargetsAt(input.projectRoot, record.proposal, "target")) {
    throw new TypeError("applied Indexer project target set is stale or incomplete");
  }
  const registry = await observeTargetRegistry(input.projectRoot, record.proposal);
  if (registry.observation !== record.receipt.observation_digest) {
    throw new TypeError("applied Indexer project observation no longer matches its receipt");
  }
  return {
    record,
    target_set_digest: indexerProtocolDigest({
      protocol: "context.indexer.applied-target-set/v1",
      proposal_digest: record.proposal.proposal_digest,
      targets: record.proposal.targets.map((target) => ({
        path: target.path,
        digest: target.target_digest,
      })),
    }),
  };
}

async function removeStagedProposal(projectRoot: string, digest: string): Promise<void> {
  const path = proposalPath(projectRoot, digest);
  await rm(path, { force: true });
  await syncDirectory(dirname(path));
}

async function applyUnlocked(input: {
  projectRoot: string;
  proposal_digest: string;
  validate_staging: (proposal: IndexerProjectProposal) => Promise<readonly string[]>;
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<IndexerProjectApplyReceipt> {
  await recoverDurableMultiFileTransactions(input.projectRoot);
  const proposal = validateIndexerProjectProposal(
    await loadStagedIndexerProjectProposal(input),
    { apply_ready: true },
  );
  const reportDigests = [...await input.validate_staging(proposal)]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (!sameDigests(reportDigests, proposal.finalized_validation_report_digests)) {
    throw new TypeError("Indexer project proposal finalized validation reports are stale");
  }
  if (await allTargetsAt(input.projectRoot, proposal, "target")) {
    const observation = await observeTargetRegistry(input.projectRoot, proposal);
    const receipt = applyReceipt({ proposal, observation, transaction: null, recovered: true });
    const record = await persistApplyRecord({
      projectRoot: input.projectRoot,
      proposal,
      receipt,
    });
    await removeStagedProposal(input.projectRoot, proposal.proposal_digest);
    return record.receipt;
  }
  if (!await allTargetsAt(input.projectRoot, proposal, "base")) {
    throw new TypeError("Indexer project proposal targets have mixed or stale CAS state");
  }
  await assertBaseRegistry(input.projectRoot, proposal);
  const transaction = await runDurableMultiFileTransaction({
    projectRoot: input.projectRoot,
    kind: "apply-indexer-project",
    proposal_digest: proposal.proposal_digest,
    targets: proposal.targets,
    ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
  });
  const observation = await observeTargetRegistry(input.projectRoot, proposal);
  const receipt = applyReceipt({ proposal, observation, transaction, recovered: false });
  const record = await persistApplyRecord({
    projectRoot: input.projectRoot,
    proposal,
    receipt,
  });
  await removeStagedProposal(input.projectRoot, proposal.proposal_digest);
  return record.receipt;
}

export async function applyIndexerProjectProposal(input: {
  projectRoot: string;
  proposal_digest: string;
  validate_staging: (proposal: IndexerProjectProposal) => Promise<readonly string[]>;
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<IndexerProjectApplyReceipt> {
  return withProjectWriteLock(input.projectRoot, "apply-indexer-project", () =>
    applyUnlocked(input)
  );
}

export async function recoverIndexerProjectApply(
  projectRoot: string,
): Promise<DurableMultiFileTransactionReceipt[]> {
  return withProjectWriteLock(projectRoot, "recover-indexer-project", () =>
    recoverDurableMultiFileTransactions(projectRoot)
  );
}
