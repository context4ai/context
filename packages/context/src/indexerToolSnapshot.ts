import { z } from "zod";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
} from "./indexerProtocolCommon.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";

const toolSnapshotPageSchema = z.object({
  page_ref: indexerCanonicalRefSchema,
  cursor_in: z.string().min(1).nullable(),
  cursor_out: z.string().min(1).nullable(),
  item_count: z.number().int().nonnegative(),
  response_digest: indexerDigestSchema,
}).strict();

export const indexerToolSnapshotSchema = z.object({
  protocol: z.literal("context.indexer.tool-snapshot/v1"),
  tool: z.object({
    id: indexerIdSchema,
    version: indexerSemverSchema,
    implementation_digest: indexerDigestSchema,
    authority_ref: indexerCanonicalRefSchema,
  }).strict(),
  source: z.object({
    source_ref: indexerCanonicalRefSchema,
    module_ref: indexerCanonicalRefSchema.nullable(),
    input_digest: indexerDigestSchema,
  }).strict(),
  resource: z.object({
    provider: indexerIdSchema,
    kind: indexerIdSchema,
    identity: indexerCanonicalRefSchema,
    endpoint_type: indexerIdSchema,
    protocol: indexerIdSchema,
    resolved_revision: z.string().min(1).max(512),
  }).strict(),
  location: z.object({
    site: z.string().min(1).max(128),
    region: z.string().min(1).max(128).nullable(),
  }).strict(),
  query: z.object({
    operation: indexerIdSchema,
    arguments_digest: indexerDigestSchema,
  }).strict(),
  pages: z.array(toolSnapshotPageSchema).min(1),
  completion: z.object({
    state: z.enum(["complete", "partial"]),
    next_cursor: z.string().min(1).nullable(),
  }).strict(),
  observation: z.object({
    observed_at: z.string().datetime({ offset: true }),
    response_digest: indexerDigestSchema,
  }).strict(),
  snapshot_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.pages.map((page) => page.page_ref), context, "pages");
});

export type IndexerToolSnapshot = z.infer<typeof indexerToolSnapshotSchema>;

const toolSnapshotReadAuthoritySchema = z.object({
  ref: indexerCanonicalRefSchema,
  digest: indexerDigestSchema,
}).strict();

const toolSnapshotReadRequestSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  input_digest: indexerDigestSchema,
  request_digest: indexerDigestSchema,
}).strict();

const toolSnapshotReadOutputSchema = z.object({
  snapshot_digest: indexerDigestSchema,
  response_digest: indexerDigestSchema,
}).strict();

export const indexerToolSnapshotReadReceiptSchema = z.object({
  protocol: z.literal("context.indexer.tool-snapshot-read-receipt/v1"),
  handler: indexerProtocolIdSchema,
  authority: toolSnapshotReadAuthoritySchema,
  request: toolSnapshotReadRequestSchema,
  output: toolSnapshotReadOutputSchema,
  receipt_digest: indexerDigestSchema,
}).strict();

export type IndexerToolSnapshotReadReceipt = z.infer<
  typeof indexerToolSnapshotReadReceiptSchema
>;

export interface ExpectedIndexerToolSnapshotRead {
  handler: string;
  authority_ref: string;
  authority_digest: string;
  source_ref: string;
  module_ref: string | null;
  input_digest: string;
}

export function indexerToolSnapshotPageRef(input: {
  resource_identity: string;
  query_arguments_digest: string;
  cursor_in: string | null;
  response_digest: string;
}): string {
  return `tool-page:${indexerProtocolDigest(input)}`;
}

export function indexerToolSnapshotResponseDigest(
  pages: readonly Pick<
    z.infer<typeof toolSnapshotPageSchema>,
    "page_ref" | "item_count" | "response_digest"
  >[],
): string {
  return indexerProtocolDigest(pages.map((page) => ({
    page_ref: page.page_ref,
    item_count: page.item_count,
    response_digest: page.response_digest,
  })));
}

export function indexerToolSnapshotDigest(
  value: Omit<IndexerToolSnapshot, "snapshot_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function indexerToolSnapshotReadRequestDigest(input: {
  snapshot: IndexerToolSnapshot;
  handler: string;
  authority_ref: string;
  authority_digest: string;
}): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.tool-snapshot-read-request-binding/v1",
    handler: input.handler,
    authority: {
      ref: input.authority_ref,
      digest: input.authority_digest,
    },
    tool: input.snapshot.tool,
    source: input.snapshot.source,
    resource: input.snapshot.resource,
    location: input.snapshot.location,
    query: input.snapshot.query,
  });
}

export function indexerToolSnapshotReadReceiptDigest(
  value: Omit<IndexerToolSnapshotReadReceipt, "receipt_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerToolSnapshotReadReceipt(input: {
  snapshot: unknown;
  handler: string;
  authority_digest: string;
}): IndexerToolSnapshotReadReceipt {
  const snapshot = validateIndexerToolSnapshot(input.snapshot);
  const handler = indexerProtocolIdSchema.parse(input.handler);
  const authorityDigest = indexerDigestSchema.parse(input.authority_digest);
  const payload: Omit<IndexerToolSnapshotReadReceipt, "receipt_digest"> = {
    protocol: "context.indexer.tool-snapshot-read-receipt/v1",
    handler,
    authority: {
      ref: snapshot.tool.authority_ref,
      digest: authorityDigest,
    },
    request: {
      source_ref: snapshot.source.source_ref,
      module_ref: snapshot.source.module_ref,
      input_digest: snapshot.source.input_digest,
      request_digest: indexerToolSnapshotReadRequestDigest({
        snapshot,
        handler,
        authority_ref: snapshot.tool.authority_ref,
        authority_digest: authorityDigest,
      }),
    },
    output: {
      snapshot_digest: snapshot.snapshot_digest,
      response_digest: snapshot.observation.response_digest,
    },
  };
  return indexerToolSnapshotReadReceiptSchema.parse({
    ...payload,
    receipt_digest: indexerToolSnapshotReadReceiptDigest(payload),
  });
}

function withoutSnapshotDigest(
  value: IndexerToolSnapshot,
): Omit<IndexerToolSnapshot, "snapshot_digest"> {
  const payload: Partial<IndexerToolSnapshot> = { ...value };
  Reflect.deleteProperty(payload, "snapshot_digest");
  return payload as Omit<IndexerToolSnapshot, "snapshot_digest">;
}

export function validateIndexerToolSnapshot(value: unknown): IndexerToolSnapshot {
  const parsed = indexerToolSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `tool snapshot is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const snapshot = parsed.data;
  if (snapshot.pages[0]!.cursor_in !== null) {
    throw new TypeError("tool snapshot pagination must start with a null cursor");
  }
  snapshot.pages.forEach((page, index) => {
    if (page.page_ref !== indexerToolSnapshotPageRef({
      resource_identity: snapshot.resource.identity,
      query_arguments_digest: snapshot.query.arguments_digest,
      cursor_in: page.cursor_in,
      response_digest: page.response_digest,
    })) {
      throw new TypeError(`tool snapshot page ${page.page_ref} has a non-canonical identity`);
    }
    if (index > 0 && page.cursor_in !== snapshot.pages[index - 1]!.cursor_out) {
      throw new TypeError("tool snapshot pagination cursors do not form one chain");
    }
  });
  const lastCursor = snapshot.pages.at(-1)!.cursor_out;
  if (
    (snapshot.completion.state === "complete" &&
      (lastCursor !== null || snapshot.completion.next_cursor !== null)) ||
    (snapshot.completion.state === "partial" &&
      (lastCursor === null || snapshot.completion.next_cursor !== lastCursor))
  ) {
    throw new TypeError("tool snapshot completion does not match the final page cursor");
  }
  const pageRefs = snapshot.pages.map((page) => page.page_ref);
  const canonicallySorted = [...pageRefs].sort(compareIndexerCanonicalText);
  if (
    snapshot.completion.state === "complete" &&
    new Set(canonicallySorted).size !== snapshot.pages.length
  ) {
    throw new TypeError("tool snapshot page identities must be unique");
  }
  if (
    snapshot.observation.response_digest !==
      indexerToolSnapshotResponseDigest(snapshot.pages)
  ) {
    throw new TypeError(
      "tool snapshot response digest does not match its canonical page set",
    );
  }
  if (indexerToolSnapshotDigest(withoutSnapshotDigest(snapshot)) !== snapshot.snapshot_digest) {
    throw new TypeError("tool snapshot digest does not match its canonical payload");
  }
  return snapshot;
}

export function validateAuthorizedIndexerToolSnapshot(input: {
  value: unknown;
  receipt: unknown;
  expected: ExpectedIndexerToolSnapshotRead;
}): {
  snapshot: IndexerToolSnapshot;
  receipt: IndexerToolSnapshotReadReceipt;
} {
  const snapshot = validateIndexerToolSnapshot(input.value);
  const receipt = indexerToolSnapshotReadReceiptSchema.parse(input.receipt);
  const expected = z.object({
    handler: indexerProtocolIdSchema,
    authority_ref: indexerCanonicalRefSchema,
    authority_digest: indexerDigestSchema,
    source_ref: indexerCanonicalRefSchema,
    module_ref: indexerCanonicalRefSchema.nullable(),
    input_digest: indexerDigestSchema,
  }).strict().parse(input.expected);
  if (
    receipt.handler !== expected.handler ||
    receipt.authority.ref !== expected.authority_ref ||
    receipt.authority.digest !== expected.authority_digest ||
    snapshot.tool.authority_ref !== expected.authority_ref
  ) {
    throw new TypeError("tool snapshot read receipt does not match the expected authority");
  }
  if (
    snapshot.source.source_ref !== expected.source_ref ||
    snapshot.source.module_ref !== expected.module_ref ||
    snapshot.source.input_digest !== expected.input_digest ||
    receipt.request.source_ref !== expected.source_ref ||
    receipt.request.module_ref !== expected.module_ref ||
    receipt.request.input_digest !== expected.input_digest
  ) {
    throw new TypeError("tool snapshot read receipt does not match the resolved source identity");
  }
  const requestDigest = indexerToolSnapshotReadRequestDigest({
    snapshot,
    handler: receipt.handler,
    authority_ref: receipt.authority.ref,
    authority_digest: receipt.authority.digest,
  });
  if (receipt.request.request_digest !== requestDigest) {
    throw new TypeError("tool snapshot read receipt request digest is invalid");
  }
  if (
    receipt.output.snapshot_digest !== snapshot.snapshot_digest ||
    receipt.output.response_digest !== snapshot.observation.response_digest
  ) {
    throw new TypeError("tool snapshot read receipt does not match the current output");
  }
  const payload: Omit<IndexerToolSnapshotReadReceipt, "receipt_digest"> = {
    protocol: receipt.protocol,
    handler: receipt.handler,
    authority: receipt.authority,
    request: receipt.request,
    output: receipt.output,
  };
  if (receipt.receipt_digest !== indexerToolSnapshotReadReceiptDigest(payload)) {
    throw new TypeError("tool snapshot read receipt digest is invalid");
  }
  return { snapshot, receipt };
}
