import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  indexerMaterialQuestionKey,
  indexerQuestionRevisionDigest,
} from "./indexerQuestionAuthority.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const dependenciesSchema = z.object({
  requirement_digest: indexerDigestSchema,
  owner_cell_digest: indexerDigestSchema,
  emitted_question_digest: indexerDigestSchema,
  source_input_set_digest: indexerDigestSchema,
}).strict();

export const indexerUnresolvedMaterialGapSchema = z.object({
  owner_cell_ref: indexerCanonicalRefSchema,
  question_ref: indexerCanonicalRefSchema,
  question_contract_digest: indexerDigestSchema,
  question_subject_target_ref: indexerCanonicalRefSchema,
  question_target_item_digest: indexerDigestSchema,
  question_revision_digest: indexerDigestSchema,
  state: z.literal("unresolved"),
  dependencies: dependenciesSchema,
}).strict();

export const indexerMaterialGapLedgerEntrySchema = indexerUnresolvedMaterialGapSchema;

export const indexerMaterialGapLedgerSchema = z.object({
  protocol: z.literal("context.indexer.material-gap-ledger/v1"),
  revision: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
  entries: z.array(indexerMaterialGapLedgerEntrySchema),
}).strict();

export type IndexerMaterialGapLedgerEntry = z.infer<
  typeof indexerMaterialGapLedgerEntrySchema
>;
export type IndexerMaterialGapLedger = z.infer<
  typeof indexerMaterialGapLedgerSchema
>;
export type IndexerUnresolvedMaterialGap = z.infer<
  typeof indexerUnresolvedMaterialGapSchema
>;

export function indexerMaterialGapQuestionKey(
  entry: Pick<
    IndexerMaterialGapLedgerEntry,
    "owner_cell_ref" | "question_contract_digest" | "question_subject_target_ref"
  >,
): string {
  return indexerMaterialQuestionKey({
    owner_cell_ref: entry.owner_cell_ref,
    question_contract_digest: entry.question_contract_digest,
    question_subject_target_ref: entry.question_subject_target_ref,
  });
}

export function indexerMaterialGapLedgerRevision(
  value: Omit<IndexerMaterialGapLedger, "revision">,
): string {
  return indexerProtocolDigest(value);
}

function validateEntry(entry: IndexerMaterialGapLedgerEntry): void {
  const questionKey = indexerMaterialGapQuestionKey(entry);
  const expectedRevision = indexerQuestionRevisionDigest({
    question_contract_digest: entry.question_contract_digest,
    question_key: questionKey,
    owner_cell_digest: entry.dependencies.owner_cell_digest,
    question_target_item_digest: entry.question_target_item_digest,
  });
  if (expectedRevision !== entry.question_revision_digest) {
    throw new TypeError("material gap question revision is invalid");
  }
}

export function buildIndexerMaterialGapLedger(input: {
  question_target_inventory_digest: string;
  entries: readonly IndexerMaterialGapLedgerEntry[];
}): IndexerMaterialGapLedger {
  const entries = input.entries.map((entry) =>
    indexerMaterialGapLedgerEntrySchema.parse(entry)
  ).sort((left, right) =>
    compareIndexerCanonicalText(
      indexerMaterialGapQuestionKey(left),
      indexerMaterialGapQuestionKey(right),
    )
  );
  entries.forEach(validateEntry);
  const keys = entries.map(indexerMaterialGapQuestionKey);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("material gap ledger question identities must be unique");
  }
  const payload: Omit<IndexerMaterialGapLedger, "revision"> = {
    protocol: "context.indexer.material-gap-ledger/v1",
    question_target_inventory_digest: indexerDigestSchema.parse(
      input.question_target_inventory_digest,
    ),
    entries,
  };
  return indexerMaterialGapLedgerSchema.parse({
    ...payload,
    revision: indexerMaterialGapLedgerRevision(payload),
  });
}

export function validateIndexerMaterialGapLedger(
  value: unknown,
): IndexerMaterialGapLedger {
  const ledger = indexerMaterialGapLedgerSchema.parse(value);
  const rebuilt = buildIndexerMaterialGapLedger({
    question_target_inventory_digest: ledger.question_target_inventory_digest,
    entries: ledger.entries,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(ledger)) {
    throw new TypeError("material gap ledger is stale or not canonical");
  }
  return ledger;
}

export function checkpointIndexerEmittedMaterialGaps(input: {
  ledger: unknown;
  expected_revision: string;
  authoritative_owner_cell_refs: readonly string[];
  current_entries: readonly IndexerUnresolvedMaterialGap[];
  complete_inventory_digest?: string;
}): IndexerMaterialGapLedger {
  const ledger = validateIndexerMaterialGapLedger(input.ledger);
  if (ledger.revision !== input.expected_revision) {
    throw new TypeError("material gap ledger CAS predecessor does not match current revision");
  }
  const ownerRefs = new Set(input.authoritative_owner_cell_refs);
  if (ownerRefs.size !== input.authoritative_owner_cell_refs.length) {
    throw new TypeError("authoritative owner-cell refs must be unique");
  }
  const current = input.current_entries.map((entry) =>
    indexerUnresolvedMaterialGapSchema.parse(entry)
  );
  if (current.some((entry) => !ownerRefs.has(entry.owner_cell_ref))) {
    throw new TypeError("current material gaps exceed the authoritative owner-cell set");
  }
  if (
    input.complete_inventory_digest !== undefined &&
    ledger.entries.some((entry) => !ownerRefs.has(entry.owner_cell_ref))
  ) {
    throw new TypeError(
      "a complete question target inventory requires authority for every retained owner",
    );
  }
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest:
      input.complete_inventory_digest ?? ledger.question_target_inventory_digest,
    entries: current,
  });
}
