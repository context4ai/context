import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  indexerOverlayQuestionDocumentDigest,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerOverlayQuestionRegistryApplyProposal,
  type IndexerOverlayQuestionRegistryApplyProposal,
  type IndexerProjectFileTarget,
} from "@c4a/context";
import {
  recoverDurableMultiFileTransactions,
  runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector,
  type DurableMultiFileTransactionReceipt,
} from "./durableMultiFileTransaction.js";
import {
  validateIndexerOverlayQuestionRebindReceipt,
  type IndexerOverlayQuestionRebindReceipt,
} from "./indexerOverlayQuestionRebind.js";
import { withProjectWriteLock } from "./writeLock.js";

const PROPOSAL_ROOT = join(
  ".tmp",
  "context-runtime",
  "indexer-overlay-question-proposals",
);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export interface StagedIndexerOverlayQuestionProposalReceipt {
  protocol: "context.indexer.overlay-question-proposal-stage-receipt/v1";
  proposal_digest: string;
  target_document_digest: string;
  rebind_receipt_digest: string;
  reused: boolean;
  receipt_digest: string;
}

export interface IndexerOverlayQuestionApplyReceipt {
  protocol: "context.indexer.overlay-question-apply-receipt/v1";
  proposal_digest: string;
  amendment_digest: string;
  confirmation_digest: string;
  requirement_set_digest: string;
  registry_digest: string;
  indexer_selection_digest: string;
  rebound_selection_digest: string;
  subject_key_schema_set_digest: string;
  transaction: DurableMultiFileTransactionReceipt | null;
  recovered: boolean;
  observation_digest: string;
  receipt_digest: string;
}

function proposalPath(projectRoot: string, digest: string): string {
  if (!DIGEST.test(digest)) throw new TypeError("overlay question proposal digest is invalid");
  return join(projectRoot, PROPOSAL_ROOT, `${digest.slice("sha256:".length)}.json`);
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

function stageReceipt(
  proposal: IndexerOverlayQuestionRegistryApplyProposal,
  reused: boolean,
): StagedIndexerOverlayQuestionProposalReceipt {
  const payload = {
    protocol: "context.indexer.overlay-question-proposal-stage-receipt/v1" as const,
    proposal_digest: proposal.proposal_digest,
    target_document_digest: proposal.target_registry.document_digest,
    rebind_receipt_digest: proposal.rebind_receipt_digest,
    reused,
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}

export async function stageIndexerOverlayQuestionRegistryApplyProposal(input: {
  projectRoot: string;
  proposal: unknown;
}): Promise<StagedIndexerOverlayQuestionProposalReceipt> {
  const proposal = validateIndexerOverlayQuestionRegistryApplyProposal(input.proposal);
  const path = proposalPath(input.projectRoot, proposal.proposal_digest);
  const serialized = `${JSON.stringify(proposal, null, 2)}\n`;
  const existing = await readMaybe(path);
  if (existing !== undefined) {
    const staged = validateIndexerOverlayQuestionRegistryApplyProposal(
      JSON.parse(existing) as unknown,
    );
    if (staged.proposal_digest !== proposal.proposal_digest || existing !== serialized) {
      throw new TypeError("content-addressed overlay question proposal stage is corrupt");
    }
    return stageReceipt(proposal, true);
  }
  const temporary = `${path}.tmp`;
  await writeSynced(temporary, serialized);
  await rename(temporary, path);
  await syncDirectory(dirname(path));
  return stageReceipt(proposal, false);
}

export async function loadStagedIndexerOverlayQuestionRegistryApplyProposal(input: {
  projectRoot: string;
  proposal_digest: string;
}): Promise<IndexerOverlayQuestionRegistryApplyProposal> {
  const raw = await readFile(proposalPath(input.projectRoot, input.proposal_digest), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("staged overlay question proposal is invalid JSON");
  }
  const proposal = validateIndexerOverlayQuestionRegistryApplyProposal(parsed);
  if (proposal.proposal_digest !== input.proposal_digest) {
    throw new TypeError("staged overlay question proposal identity is invalid");
  }
  return proposal;
}

function expectedValidationReports(input: {
  proposal: IndexerOverlayQuestionRegistryApplyProposal;
  rebind: IndexerOverlayQuestionRebindReceipt;
}): string[] {
  return [
    input.proposal.amendment.conformance_report_digest,
    input.rebind.target_final_report.report_digest,
    input.rebind.receipt_digest,
  ].sort();
}

function assertRebind(input: {
  proposal: IndexerOverlayQuestionRegistryApplyProposal;
  receipt: IndexerOverlayQuestionRebindReceipt;
}): void {
  const receipt = validateIndexerOverlayQuestionRebindReceipt({
    receipt: input.receipt,
    amendment_digest: input.proposal.amendment.amendment_digest,
    confirmation_digest: input.proposal.confirmation.confirmation_digest,
  });
  if (
    receipt.receipt_digest !== input.proposal.rebind_receipt_digest ||
    receipt.target_requirement_set_digest !==
      input.proposal.target_registry.requirement_set_digest ||
    receipt.target_final_report.report_digest !== input.proposal.rebound_selection_digest ||
    receipt.target_final_report.subject_key_schema_set_digest !==
      input.proposal.subject_key_schema_set_digest ||
    receipt.target_final_report.indexer_selection_digest !==
      input.proposal.target_registry.indexer_selection_digest ||
    JSON.stringify(expectedValidationReports({ proposal: input.proposal, rebind: receipt })) !==
      JSON.stringify(input.proposal.finalized_validation_report_digests)
  ) {
    throw new TypeError("overlay question apply proposal has a stale rebound selection");
  }
}

function registryTarget(
  proposal: IndexerOverlayQuestionRegistryApplyProposal,
): IndexerProjectFileTarget {
  return {
    path: "src/indexers.yaml",
    operation: "write",
    base_digest: proposal.base_registry.document_digest,
    target_digest: proposal.target_registry.document_digest,
    content: proposal.target_document_content,
  };
}

async function observeRegistry(input: {
  projectRoot: string;
  proposal: IndexerOverlayQuestionRegistryApplyProposal;
}) {
  const content = await readFile(join(input.projectRoot, "src", "indexers.yaml"), "utf8");
  const documentDigest = indexerOverlayQuestionDocumentDigest(content);
  const registry = parseIndexerRegistry(content);
  const digests = indexerRegistryDigests(registry);
  if (
    documentDigest !== input.proposal.target_registry.document_digest ||
    digests.requirementSetDigest !== input.proposal.target_registry.requirement_set_digest ||
    digests.indexerSelectionDigest !== input.proposal.target_registry.indexer_selection_digest ||
    digests.registryDigest !== input.proposal.target_registry.registry_digest
  ) {
    throw new TypeError("applied overlay question registry does not match the proposal target");
  }
  return {
    ...digests,
    documentDigest,
    observationDigest: indexerProtocolDigest({
      proposal_digest: input.proposal.proposal_digest,
      document_digest: documentDigest,
      ...digests,
    }),
  };
}

function applyReceipt(input: {
  proposal: IndexerOverlayQuestionRegistryApplyProposal;
  observation: Awaited<ReturnType<typeof observeRegistry>>;
  transaction: DurableMultiFileTransactionReceipt | null;
  recovered: boolean;
}): IndexerOverlayQuestionApplyReceipt {
  const payload = {
    protocol: "context.indexer.overlay-question-apply-receipt/v1" as const,
    proposal_digest: input.proposal.proposal_digest,
    amendment_digest: input.proposal.amendment.amendment_digest,
    confirmation_digest: input.proposal.confirmation.confirmation_digest,
    requirement_set_digest: input.observation.requirementSetDigest,
    registry_digest: input.observation.registryDigest,
    indexer_selection_digest: input.observation.indexerSelectionDigest,
    rebound_selection_digest: input.proposal.rebound_selection_digest,
    subject_key_schema_set_digest: input.proposal.subject_key_schema_set_digest,
    transaction: input.transaction,
    recovered: input.recovered,
    observation_digest: input.observation.observationDigest,
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}

async function removeStagedProposal(projectRoot: string, digest: string): Promise<void> {
  const path = proposalPath(projectRoot, digest);
  await rm(path, { force: true });
  await syncDirectory(dirname(path));
}

async function applyUnlocked(input: {
  projectRoot: string;
  proposal_digest: string;
  rebind_receipt: IndexerOverlayQuestionRebindReceipt;
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<IndexerOverlayQuestionApplyReceipt> {
  await recoverDurableMultiFileTransactions(input.projectRoot);
  const proposal = await loadStagedIndexerOverlayQuestionRegistryApplyProposal(input);
  assertRebind({ proposal, receipt: input.rebind_receipt });
  const currentContent = await readFile(join(input.projectRoot, "src", "indexers.yaml"), "utf8");
  const currentDigest = indexerOverlayQuestionDocumentDigest(currentContent);
  if (currentDigest === proposal.target_registry.document_digest) {
    const observation = await observeRegistry({ projectRoot: input.projectRoot, proposal });
    await removeStagedProposal(input.projectRoot, proposal.proposal_digest);
    return applyReceipt({ proposal, observation, transaction: null, recovered: true });
  }
  if (currentDigest !== proposal.base_registry.document_digest) {
    throw new TypeError("overlay question apply base document CAS mismatch");
  }
  const currentDigests = indexerRegistryDigests(parseIndexerRegistry(currentContent));
  if (
    currentDigests.requirementSetDigest !== proposal.base_registry.requirement_set_digest ||
    currentDigests.indexerSelectionDigest !== proposal.base_registry.indexer_selection_digest ||
    currentDigests.registryDigest !== proposal.base_registry.registry_digest
  ) {
    throw new TypeError("overlay question apply base registry authority is stale");
  }
  const transaction = await runDurableMultiFileTransaction({
    projectRoot: input.projectRoot,
    kind: "apply-overlay-question-registry",
    proposal_digest: proposal.proposal_digest,
    targets: [registryTarget(proposal)],
    ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
  });
  const observation = await observeRegistry({ projectRoot: input.projectRoot, proposal });
  await removeStagedProposal(input.projectRoot, proposal.proposal_digest);
  return applyReceipt({ proposal, observation, transaction, recovered: false });
}

export async function applyIndexerOverlayQuestionRegistryProposal(input: {
  projectRoot: string;
  proposal_digest: string;
  rebind_receipt: IndexerOverlayQuestionRebindReceipt;
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<IndexerOverlayQuestionApplyReceipt> {
  return withProjectWriteLock(input.projectRoot, "apply-overlay-question-registry", () =>
    applyUnlocked(input)
  );
}
