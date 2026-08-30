import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerCurrentEvidenceSourceSchema,
  indexerProtocolDigest,
  normalizeIndexerSourceSpans,
  type IndexerCurrentEvidenceSource,
  type IndexerSourceSpanRef,
} from "@c4a/context";

export interface IndexerMaterialAnswerEvidenceReadReceipt {
  protocol: "context.indexer.material-answer-evidence-read-receipt/v1";
  reader_authority_digest: string;
  source: IndexerCurrentEvidenceSource;
  source_spans: IndexerSourceSpanRef[];
  evidence_digest: string;
  receipt_digest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value;
}

function spansKey(input: {
  source_ref: string;
  source_spans: readonly IndexerSourceSpanRef[];
}): string {
  return canonicalIndexerJson({
    source_ref: input.source_ref,
    source_spans: input.source_spans,
  });
}

export function buildIndexerMaterialAnswerEvidenceReadReceipt(input: {
  reader_authority_digest: string;
  source: unknown;
  source_spans: readonly IndexerSourceSpanRef[];
  evidence_digest: string;
}): IndexerMaterialAnswerEvidenceReadReceipt {
  const source = indexerCurrentEvidenceSourceSchema.parse(input.source);
  const sourceSpans = normalizeIndexerSourceSpans({
    source,
    spans: input.source_spans,
  });
  const payload = {
    protocol: "context.indexer.material-answer-evidence-read-receipt/v1" as const,
    reader_authority_digest: digest(
      input.reader_authority_digest,
      "material-answer reader authority",
    ),
    source,
    source_spans: sourceSpans,
    evidence_digest: digest(input.evidence_digest, "material-answer evidence"),
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}

export function validateIndexerMaterialAnswerEvidenceReadReceipt(
  value: unknown,
): IndexerMaterialAnswerEvidenceReadReceipt {
  if (
    !isRecord(value) ||
    value.protocol !== "context.indexer.material-answer-evidence-read-receipt/v1" ||
    !Array.isArray(value.source_spans)
  ) {
    throw new TypeError("material-answer evidence read receipt has an invalid protocol");
  }
  const receipt = buildIndexerMaterialAnswerEvidenceReadReceipt({
    reader_authority_digest: String(value.reader_authority_digest ?? ""),
    source: value.source,
    source_spans: value.source_spans as IndexerSourceSpanRef[],
    evidence_digest: String(value.evidence_digest ?? ""),
  });
  if (receipt.receipt_digest !== value.receipt_digest) {
    throw new TypeError("material-answer evidence read receipt digest is invalid");
  }
  return receipt;
}

export function materialAnswerEvidenceReadResolver(input: {
  receipts: readonly unknown[];
  expected_reader_authority_digest: string;
}) {
  const expectedAuthority = digest(
    input.expected_reader_authority_digest,
    "expected material-answer reader authority",
  );
  const receipts = input.receipts.map(validateIndexerMaterialAnswerEvidenceReadReceipt)
    .sort((left, right) => compareIndexerCanonicalText(left.receipt_digest, right.receipt_digest));
  if (new Set(receipts.map((receipt) => receipt.receipt_digest)).size !== receipts.length) {
    throw new TypeError("material-answer evidence read receipts must be unique");
  }
  if (receipts.some((receipt) => receipt.reader_authority_digest !== expectedAuthority)) {
    throw new TypeError("material-answer evidence read receipt authority is stale");
  }
  const byKey = new Map(receipts.map((receipt) => [
    spansKey({
      source_ref: receipt.source.source_ref,
      source_spans: receipt.source_spans,
    }),
    receipt,
  ]));
  if (byKey.size !== receipts.length) {
    throw new TypeError("material-answer evidence read receipts overlap the same source spans");
  }
  const consumed = new Set<string>();
  return {
    current_sources: receipts.map((receipt) => receipt.source),
    receipt_set_digest: indexerProtocolDigest({
      protocol: "context.indexer.material-answer-evidence-read-receipt-set/v1",
      reader_authority_digest: expectedAuthority,
      receipt_digests: receipts.map((receipt) => receipt.receipt_digest),
    }),
    resolve_evidence_digest(args: {
      source: IndexerCurrentEvidenceSource;
      source_spans: readonly IndexerSourceSpanRef[];
    }): string {
      const spans = normalizeIndexerSourceSpans({
        source: args.source,
        spans: args.source_spans,
      });
      const receipt = byKey.get(spansKey({
        source_ref: args.source.source_ref,
        source_spans: spans,
      }));
      if (
        receipt === undefined ||
        canonicalIndexerJson(receipt.source) !== canonicalIndexerJson(args.source)
      ) {
        throw new TypeError("material-answer evidence claim lacks a current CLI read receipt");
      }
      consumed.add(receipt.receipt_digest);
      return receipt.evidence_digest;
    },
    assert_all_consumed(): void {
      if (consumed.size !== receipts.length) {
        throw new TypeError("material-answer acceptance contains unused evidence read receipts");
      }
    },
  };
}
