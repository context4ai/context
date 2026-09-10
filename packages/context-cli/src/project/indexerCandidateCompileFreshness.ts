import { readIndexerDelivery } from "./indexerDelivery.js";
import type { IndexerCandidateCompile, IndexerMainRunLedger } from "@c4a/context";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { hasChangedIndexerWorksetAuthority } from "./indexerCurrentRegistryFreshness.js";
import { readCurrentIndexerPostAuthorEnvelopesForResults } from "./indexerPostAuthorRunStore.js";
import { recoverDurableMultiFileTransactions } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

/** Acceptance is validated when written and again when compiling. Observing a
 * compile compares its bindings with the current ledger; it must not replay all
 * Author validation or load every Provider bundle again. */
export function matchesAcceptedCompileResults(
  ledger: IndexerMainRunLedger | undefined,
  bindings: IndexerCandidateCompile["result_bindings"],
  partial = false,
): boolean {
  if ((partial && bindings.length === 0) || ledger === undefined || (!partial && ledger.entries.length !== bindings.length)) return false;
  const byRequest = new Map(bindings.map((binding) => [binding.execution_request_digest, binding]));
  if (byRequest.size !== bindings.length) return false;
  return bindings.every((binding) => {
    const entry = ledger.entries.find((item) => item.execution_request_digest === binding.execution_request_digest);
    if (entry === undefined) return false;
    if (entry.stage !== "author" || entry.state !== "accepted") return false;
    return binding !== undefined &&
      binding.indexer_id === entry.indexer_id &&
      binding.workset_digest === entry.workset_digest &&
      binding.acceptance_digest === entry.accepted_record.acceptance_digest &&
      binding.indexer_result_digest === entry.accepted_record.result_digest;
  });
}

export async function readIndexerCandidateCompileStaleDiagnostic(
  projectRoot: string,
  compile: IndexerCandidateCompile,
): Promise<string | undefined> {
  return withProjectWriteLock(projectRoot, "observe-indexer-candidate-compile", async () => {
    // Interrupted commits still recover before observing the committed ledger.
    await recoverDurableMultiFileTransactions(projectRoot);
    const ledger = await currentLedger(projectRoot);
    const delivery = await readIndexerDelivery(projectRoot);
    if (delivery !== undefined && delivery.current.length === 0) return "Previous delivery was built; the next page batch is pending.";
    if (!matchesAcceptedCompileResults(ledger, compile.result_bindings, !!delivery?.current.length)) {
      return "Candidate compile does not bind the exact current accepted author Result set.";
    }
    if (delivery?.current.length) {
      const refs = new Set(compile.files.map((file) => file.artifact_ref));
      if (refs.size !== delivery.current.length || delivery.current.some((page) => !refs.has(page.ref))) {
        return "Candidate compile does not bind the active delivery page set.";
      }
    }
    try {
      // Registry identity is shared by an Indexer's pages. Read one request per
      // Indexer, without resolving or fingerprinting installed Provider files.
      if (await hasChangedIndexerWorksetAuthority(projectRoot, ledger)) {
        return "Accepted author Results do not bind the current requirement set or registry selection.";
      }
    } catch (error) {
      if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    const envelopes = await readCurrentIndexerPostAuthorEnvelopesForResults({
      projectRoot,
      results: compile.result_bindings.map((binding) => ({
        author_workset_digest: binding.workset_digest,
        primary_result_digest: binding.indexer_result_digest,
      })),
    });
    if (envelopes.some((envelope, index) => {
      const fingerprint = envelope !== null && typeof envelope === "object" &&
          "composition_fingerprint" in envelope
        ? envelope.composition_fingerprint
        : null;
      return fingerprint !== compile.result_bindings[index]!.post_author_composition_fingerprint;
    })) {
      return "Candidate compile does not bind the current post-author composition.";
    }
    return undefined;
  });
}
