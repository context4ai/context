import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { indexerProtocolDigest } from "@c4a/context";
import { readAcceptedIndexerMainAuthorResultHistory, readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import { partitionAuthorBinding, readPartitionStream } from "./indexerPartitionStream.js";

type AuthorRecord = Awaited<ReturnType<typeof readAcceptedIndexerMainAuthorResultRecords>>[number];

function subjectAuthority(record: AuthorRecord): string {
  return indexerProtocolDigest({
    indexer: record.request.workset.indexer_id,
    requirement: record.request.workset.requirement_set_digest,
    subject: record.validation.expected_subject_key,
  });
}

/** Only receipts explicitly settled by the active stream can participate in
 * link repair. A later revision replaces its subject's old article collection;
 * other subjects retain their settled cross-wave link targets. */
export async function readDeliverableAuthorRecords(projectRoot: string) {
  const ledger = await currentLedger(projectRoot);
  const current = ledger?.entries.every(entry => entry.stage === "author")
    ? await readAcceptedIndexerMainAuthorResultRecords(projectRoot) : [];
  const stream = await readPartitionStream(projectRoot);
  if (stream === undefined || stream.completed_bindings.length === 0) return current;
  const order = new Map(stream.completed_bindings.map((binding, index) => [binding, index]));
  const receiptOrder = new Map<string, number>();
  for (const [binding, receipts] of Object.entries(stream.completed_receipts ?? {})) {
    const rank = order.get(binding);
    if (rank !== undefined) for (const receipt of receipts) receiptOrder.set(receipt, rank);
  }
  const history = await readAcceptedIndexerMainAuthorResultHistory({ projectRoot,
    include: spec => {
      const binding = partitionAuthorBinding(spec);
      const receipts = stream.completed_receipts?.[binding];
      return receiptOrder.has(spec.request.execution_request_digest) ||
        (order.has(binding) && receipts === undefined);
    } });
  const selected = new Map<string, AuthorRecord[]>();
  const latest = new Map<string, number>();
  for (const record of history) {
    const key = subjectAuthority(record);
    const rank = receiptOrder.get(record.request.execution_request_digest) ?? order.get(partitionAuthorBinding(record))!;
    const previous = latest.get(key);
    if (previous === undefined || rank > previous) {
      latest.set(key, rank);
      selected.set(key, [record]);
    } else if (rank === previous) {
      // Retain equal-authority receipts so reconciliation can diagnose conflicts.
      selected.get(key)!.push(record);
    }
  }
  const activeSubjects = new Set(current.map(subjectAuthority));
  return [...current, ...[...selected].filter(([key]) => !activeSubjects.has(key)).flatMap(([, records]) => records)];
}
