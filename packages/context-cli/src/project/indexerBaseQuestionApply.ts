import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerBaseQuestionAmendment,
  validateIndexerBaseQuestionAmendmentConfirmation,
} from "@c4a/context";
import {
  durableContentDigest,
  runDurableSingleFileTransaction,
  type DurableSingleFileTransactionReceipt,
  type DurableTransactionFailureInjector,
} from "./durableSingleFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

export interface IndexerBaseQuestionApplyReceipt {
  protocol: "context.indexer.base-question-apply-receipt/v1";
  amendment_digest: string;
  confirmation_digest: string;
  requirement_set_digest: string;
  registry_digest: string;
  indexer_selection_digest: string;
  transaction: DurableSingleFileTransactionReceipt;
  receipt_digest: string;
}

export async function applyIndexerBaseQuestionAmendment(input: {
  projectRoot: string;
  amendment: unknown;
  confirmation: unknown;
  target_document_content: string;
  inject_failure?: DurableTransactionFailureInjector;
}): Promise<IndexerBaseQuestionApplyReceipt> {
  return withProjectWriteLock(input.projectRoot, "apply-index-requirement-questions", async () => {
    const amendment = validateIndexerBaseQuestionAmendment(input.amendment);
    const confirmation = validateIndexerBaseQuestionAmendmentConfirmation({
      amendment,
      confirmation: input.confirmation,
    });
    const target = parseIndexerRegistry(
      input.target_document_content,
      "base-question-amendment:target",
    );
    if (canonicalIndexerJson(target) !== canonicalIndexerJson(amendment.target_registry)) {
      throw new TypeError("base question target document does not match the confirmed amendment");
    }
    const path = join(input.projectRoot, "src", "indexers.yaml");
    const baseContent = await readFile(path, "utf8");
    const base = parseIndexerRegistry(baseContent);
    const baseDigests = indexerRegistryDigests(base);
    if (
      baseDigests.requirementSetDigest !== amendment.base_requirement_set_digest ||
      base.requirements.find((item) => item.id === amendment.requirement_id) === undefined ||
      indexerProtocolDigest(
        base.requirements.find((item) => item.id === amendment.requirement_id)!,
      ) !== amendment.base_requirement_digest ||
      baseDigests.indexerSelectionDigest !==
        indexerRegistryDigests(amendment.target_registry).indexerSelectionDigest
    ) {
      throw new TypeError("base question amendment CAS or Indexer selection is stale");
    }
    const transaction = await runDurableSingleFileTransaction({
      projectRoot: input.projectRoot,
      kind: "apply-index-requirement-questions",
      target_path: "src/indexers.yaml",
      expected_base_digest: durableContentDigest(baseContent),
      target_content: input.target_document_content,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    const appliedContent = await readFile(path, "utf8");
    const applied = parseIndexerRegistry(appliedContent);
    const digests = indexerRegistryDigests(applied);
    if (
      canonicalIndexerJson(applied) !== canonicalIndexerJson(amendment.target_registry) ||
      digests.requirementSetDigest !== amendment.target_requirement_set_digest ||
      digests.registryDigest !== amendment.target_registry_digest
    ) {
      throw new TypeError("applied base question amendment does not match its target");
    }
    const payload: Omit<IndexerBaseQuestionApplyReceipt, "receipt_digest"> = {
      protocol: "context.indexer.base-question-apply-receipt/v1",
      amendment_digest: amendment.amendment_digest,
      confirmation_digest: confirmation.confirmation_digest,
      requirement_set_digest: digests.requirementSetDigest,
      registry_digest: digests.registryDigest,
      indexer_selection_digest: digests.indexerSelectionDigest,
      transaction,
    };
    return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
  });
}
