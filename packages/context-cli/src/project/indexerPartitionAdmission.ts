import {
  canonicalIndexerJson,
  type IndexerMainRunLedger,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type validateAndRecordIndexerMainRun,
} from "@c4a/context";
import {
  acceptedCachePath, currentSpec, readAcceptedCache, readJsonMaybe,
} from "./indexerMainRunStoreRecords.js";
import { assertIndexerPartitionPrimaryOwners } from "./indexerPartitionSubjectConvergence.js";

type ValidatedRun = ReturnType<typeof validateAndRecordIndexerMainRun>;

/** Check the prospective accepted set while the caller holds the write lock.
 * Batch callers include their not-yet-persisted receipts in staged records. */
export async function assertPartitionAdmission(input: {
  projectRoot: string;
  ledger: IndexerMainRunLedger;
  validated: ValidatedRun;
  staged?: readonly { path: string; value: unknown }[];
}): Promise<void> {
  if (input.validated.request.workset.stage !== "partition") return;
  const partitions: { workset: IndexerMainPartitionWorkset; plan: IndexerPartitionPlan }[] = [];
  for (const entry of input.ledger.entries) {
    if (entry.stage !== "partition" || entry.state !== "accepted") continue;
    const spec = await currentSpec({ projectRoot: input.projectRoot, request_digest: entry.execution_request_digest });
    const path = acceptedCachePath(entry.execution_request_digest);
    const cache = input.staged?.find(record => record.path === path)?.value ??
      await readJsonMaybe(input.projectRoot, path);
    const accepted = readAcceptedCache({ spec, cache });
    if (canonicalIndexerJson(accepted.accepted_record) !== canonicalIndexerJson(entry.accepted_record)) {
      throw new TypeError("Accepted Partition receipt does not match the current ledger");
    }
    partitions.push({ workset: spec.request.workset as IndexerMainPartitionWorkset,
      plan: accepted.operation_result as IndexerPartitionPlan });
  }
  partitions.push({ workset: input.validated.request.workset,
    plan: input.validated.operation_result as IndexerPartitionPlan });
  try {
    assertIndexerPartitionPrimaryOwners(partitions);
  } catch (error) {
    throw new TypeError(
      `partition-subject-conflict: ${error instanceof Error ? error.message : String(error)}. ` +
      `Current request ${input.validated.request.execution_request_digest} was not accepted. ` +
      `Keep accepted requests unchanged; correct this task's SubjectKey/ownership and resubmit the current task. ` +
      `Use enrich-or-independent only when this source supplements the same Subject. `,
    );
  }
}
