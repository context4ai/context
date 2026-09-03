import { z } from "zod";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export type IndexerReadJson =
  | null
  | boolean
  | number
  | string
  | IndexerReadJson[]
  | { [key: string]: IndexerReadJson };

function isIndexerReadJson(
  value: unknown,
  ancestors = new WeakSet<object>(),
): value is IndexerReadJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value) || !isIndexerReadJson(value[index], ancestors)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every((item) =>
      isIndexerReadJson(item, ancestors)
    );
  } finally {
    ancestors.delete(value);
  }
}

const indexerReadJsonSchema = z.custom<IndexerReadJson>(isIndexerReadJson, {
  message: "must be finite JSON data",
});

const opaqueCursorSchema = z.string().min(1).max(4096);

export const indexerWorksetReadRequestSchema = z.object({
  protocol: z.literal("context.indexer.workset-read-request/v1"),
  workset_digest: indexerDigestSchema,
  read_kind: z.enum(["source", "evidence"]),
  requested_refs: z.array(z.string().min(1)).min(1),
  request_digest: indexerDigestSchema,
  transport: z.object({
    cursor: opaqueCursorSchema.optional(),
    page_size: z.number().int().positive().max(1000),
  }).strict(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.requested_refs, context, "requested_refs");
});

export type IndexerWorksetReadRequest = z.infer<
  typeof indexerWorksetReadRequestSchema
>;

type ReadRequestIdentity = Pick<
  IndexerWorksetReadRequest,
  "protocol" | "workset_digest" | "read_kind" | "requested_refs"
>;

function readRequestIdentity(
  value: ReadRequestIdentity,
): ReadRequestIdentity {
  return {
    protocol: value.protocol,
    workset_digest: value.workset_digest,
    read_kind: value.read_kind,
    requested_refs: value.requested_refs,
  };
}

export function indexerWorksetReadRequestDigest(
  value: ReadRequestIdentity,
): string {
  return indexerProtocolDigest(readRequestIdentity(value));
}

function sortedUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate values`);
  }
  return sorted;
}

function assertAllowedRefs(
  requestedRefs: readonly string[],
  allowedRefs: readonly string[],
): void {
  const allowed = new Set(allowedRefs);
  const outside = requestedRefs.find((ref) => !allowed.has(ref));
  if (outside !== undefined) {
    throw new TypeError(`workset read ref is outside the authorized view: ${outside}`);
  }
}

function parseCanonicalReadRequest(value: unknown): IndexerWorksetReadRequest {
  const request = indexerWorksetReadRequestSchema.parse(value);
  if (indexerWorksetReadRequestDigest(request) !== request.request_digest) {
    throw new TypeError("workset read request digest is invalid");
  }
  const canonicalRefs = sortedUnique(request.requested_refs, "requested_refs");
  if (canonicalRefs.some((ref, index) => ref !== request.requested_refs[index])) {
    throw new TypeError("workset read requested_refs must use canonical ordering");
  }
  return request;
}

export function buildIndexerWorksetReadRequest(input: {
  workset_digest: string;
  read_kind: IndexerWorksetReadRequest["read_kind"];
  requested_refs: readonly string[];
  allowed_refs: readonly string[];
  cursor?: string;
  page_size: number;
}): IndexerWorksetReadRequest {
  const requestedRefs = sortedUnique(input.requested_refs, "requested_refs");
  assertAllowedRefs(requestedRefs, input.allowed_refs);
  const identity: ReadRequestIdentity = {
    protocol: "context.indexer.workset-read-request/v1",
    workset_digest: input.workset_digest,
    read_kind: input.read_kind,
    requested_refs: requestedRefs,
  };
  return indexerWorksetReadRequestSchema.parse({
    ...identity,
    request_digest: indexerWorksetReadRequestDigest(identity),
    transport: {
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      page_size: input.page_size,
    },
  });
}

export function validateIndexerWorksetReadRequest(input: {
  request: unknown;
  expected_workset_digest: string;
  allowed_refs: readonly string[];
}): IndexerWorksetReadRequest {
  const request = parseCanonicalReadRequest(input.request);
  if (request.workset_digest !== input.expected_workset_digest) {
    throw new TypeError("workset read request does not bind the current workset");
  }
  assertAllowedRefs(request.requested_refs, input.allowed_refs);
  return request;
}

const readItemPayloadSchema = z.object({
  ref: z.string().min(1),
  value: indexerReadJsonSchema,
}).strict();

const readItemSchema = readItemPayloadSchema.extend({
  item_digest: indexerDigestSchema,
}).strict();

export const indexerWorksetReadResponseSchema = z.object({
  protocol: z.literal("context.indexer.workset-read-response/v1"),
  request_digest: indexerDigestSchema,
  workset_digest: indexerDigestSchema,
  read_kind: z.enum(["source", "evidence"]),
  items: z.array(readItemSchema),
  page_payload_digest: indexerDigestSchema,
  transport: z.object({
    request_cursor: opaqueCursorSchema.optional(),
    next_cursor: opaqueCursorSchema.optional(),
    complete: z.boolean(),
  }).strict(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.items.map((item) => item.ref), context, "items.ref");
  if (value.transport.complete === (value.transport.next_cursor !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "complete must be true exactly when next_cursor is absent",
      path: ["transport"],
    });
  }
});

export type IndexerWorksetReadResponse = z.infer<
  typeof indexerWorksetReadResponseSchema
>;

type ReadItemPayload = z.infer<typeof readItemPayloadSchema>;

function readItemPayload(value: ReadItemPayload): ReadItemPayload {
  return { ref: value.ref, value: value.value };
}

export function indexerWorksetReadItemDigest(value: ReadItemPayload): string {
  return indexerProtocolDigest(readItemPayload(value));
}

type ReadPagePayload = Pick<
  IndexerWorksetReadResponse,
  "protocol" | "request_digest" | "workset_digest" | "read_kind" | "items"
>;

function readPagePayload(value: ReadPagePayload): ReadPagePayload {
  return {
    protocol: value.protocol,
    request_digest: value.request_digest,
    workset_digest: value.workset_digest,
    read_kind: value.read_kind,
    items: value.items,
  };
}

export function indexerWorksetReadPagePayloadDigest(
  value: ReadPagePayload,
): string {
  return indexerProtocolDigest(readPagePayload(value));
}

export function buildIndexerWorksetReadResponse(input: {
  request: IndexerWorksetReadRequest;
  items: readonly ReadItemPayload[];
  request_cursor?: string;
  next_cursor?: string;
}): IndexerWorksetReadResponse {
  const request = parseCanonicalReadRequest(input.request);
  if (input.request_cursor !== request.transport.cursor) {
    throw new TypeError("workset read response request cursor does not match the request");
  }
  const allowed = new Set(request.requested_refs);
  const items = [...input.items]
    .sort((left, right) => compareIndexerCanonicalText(left.ref, right.ref))
    .map((item) => {
      if (!allowed.has(item.ref)) {
        throw new TypeError(`workset read response ref was not requested: ${item.ref}`);
      }
      const payload = readItemPayloadSchema.parse(item);
      return { ...payload, item_digest: indexerWorksetReadItemDigest(payload) };
    });
  if (items.length > request.transport.page_size) {
    throw new TypeError("workset read response exceeds the requested page size");
  }
  if (new Set(items.map((item) => item.ref)).size !== items.length) {
    throw new TypeError("workset read response contains duplicate refs");
  }
  const payload: ReadPagePayload = {
    protocol: "context.indexer.workset-read-response/v1",
    request_digest: request.request_digest,
    workset_digest: request.workset_digest,
    read_kind: request.read_kind,
    items,
  };
  return indexerWorksetReadResponseSchema.parse({
    ...payload,
    page_payload_digest: indexerWorksetReadPagePayloadDigest(payload),
    transport: {
      ...(input.request_cursor === undefined
        ? {}
        : { request_cursor: input.request_cursor }),
      ...(input.next_cursor === undefined ? {} : { next_cursor: input.next_cursor }),
      complete: input.next_cursor === undefined,
    },
  });
}

export function validateIndexerWorksetReadResponse(input: {
  response: unknown;
  request: IndexerWorksetReadRequest;
}): IndexerWorksetReadResponse {
  const request = parseCanonicalReadRequest(input.request);
  const response = indexerWorksetReadResponseSchema.parse(input.response);
  if (
    response.request_digest !== request.request_digest ||
    response.workset_digest !== request.workset_digest ||
    response.read_kind !== request.read_kind ||
    response.transport.request_cursor !== request.transport.cursor
  ) {
    throw new TypeError("workset read response does not match its exact request");
  }
  const allowed = new Set(request.requested_refs);
  if (response.items.length > request.transport.page_size) {
    throw new TypeError("workset read response exceeds the requested page size");
  }
  for (const item of response.items) {
    if (!allowed.has(item.ref)) {
      throw new TypeError(`workset read response ref was not requested: ${item.ref}`);
    }
    if (indexerWorksetReadItemDigest(item) !== item.item_digest) {
      throw new TypeError(`workset read item digest is invalid: ${item.ref}`);
    }
  }
  const canonicalRefs = [...response.items]
    .map((item) => item.ref)
    .sort(compareIndexerCanonicalText);
  if (canonicalRefs.some((ref, index) => ref !== response.items[index]?.ref)) {
    throw new TypeError("workset read response items must use canonical ordering");
  }
  if (
    indexerWorksetReadPagePayloadDigest(response) !== response.page_payload_digest
  ) {
    throw new TypeError("workset read page payload digest is invalid");
  }
  return response;
}

const readSetEntrySchema = z.object({
  ref: z.string().min(1),
  item_digest: indexerDigestSchema,
}).strict();

export const indexerWorksetReadReceiptSchema = z.object({
  protocol: z.literal("context.indexer.workset-read-receipt/v1"),
  workset_digest: indexerDigestSchema,
  request_digest: indexerDigestSchema,
  read_kind: z.enum(["source", "evidence"]),
  read_set: z.array(readSetEntrySchema).min(1),
  read_set_digest: indexerDigestSchema,
  page_payload_digests: z.array(indexerDigestSchema).min(1),
  receipt_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.read_set.map((item) => item.ref), context, "read_set.ref");
  addDuplicateIssues(value.page_payload_digests, context, "page_payload_digests");
});

export type IndexerWorksetReadReceipt = z.infer<
  typeof indexerWorksetReadReceiptSchema
>;

type ReadReceiptPayload = Omit<IndexerWorksetReadReceipt, "receipt_digest">;

function readReceiptPayload(value: ReadReceiptPayload): ReadReceiptPayload {
  return {
    protocol: value.protocol,
    workset_digest: value.workset_digest,
    request_digest: value.request_digest,
    read_kind: value.read_kind,
    read_set: value.read_set,
    read_set_digest: value.read_set_digest,
    page_payload_digests: value.page_payload_digests,
  };
}

export function indexerWorksetReadSetDigest(
  value: readonly z.infer<typeof readSetEntrySchema>[],
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.workset-read-set/v1",
    items: value,
  });
}

export function indexerWorksetReadReceiptDigest(
  value: ReadReceiptPayload,
): string {
  return indexerProtocolDigest(readReceiptPayload(value));
}

export function buildIndexerCompleteWorksetReadReceipt(input: {
  workset_digest: string;
  read_kind: IndexerWorksetReadRequest["read_kind"];
  items: readonly ReadItemPayload[];
  page_size: number;
}): IndexerWorksetReadReceipt {
  const sortedItems = [...input.items]
    .sort((left, right) => compareIndexerCanonicalText(left.ref, right.ref));
  const refs = sortedUnique(
    sortedItems.map((item) => item.ref),
    "complete workset read items",
  );
  if (refs.length === 0) {
    throw new TypeError("complete workset read receipt requires at least one item");
  }
  const request = buildIndexerWorksetReadRequest({
    workset_digest: input.workset_digest,
    read_kind: input.read_kind,
    requested_refs: refs,
    allowed_refs: refs,
    page_size: input.page_size,
  });
  const readSet: z.infer<typeof readSetEntrySchema>[] = [];
  const pagePayloadDigests: string[] = [];
  for (let offset = 0; offset < sortedItems.length; offset += input.page_size) {
    const items = sortedItems.slice(offset, offset + input.page_size).map((item) => {
      const payload = readItemPayloadSchema.parse(item);
      const projected = {
        ...payload,
        item_digest: indexerWorksetReadItemDigest(payload),
      };
      readSet.push({ ref: projected.ref, item_digest: projected.item_digest });
      return projected;
    });
    const page: ReadPagePayload = {
      protocol: "context.indexer.workset-read-response/v1",
      request_digest: request.request_digest,
      workset_digest: request.workset_digest,
      read_kind: request.read_kind,
      items,
    };
    pagePayloadDigests.push(indexerWorksetReadPagePayloadDigest(page));
  }
  const payload: ReadReceiptPayload = {
    protocol: "context.indexer.workset-read-receipt/v1",
    workset_digest: request.workset_digest,
    request_digest: request.request_digest,
    read_kind: request.read_kind,
    read_set: readSet,
    read_set_digest: indexerWorksetReadSetDigest(readSet),
    page_payload_digests: pagePayloadDigests,
  };
  return indexerWorksetReadReceiptSchema.parse({
    ...payload,
    receipt_digest: indexerWorksetReadReceiptDigest(payload),
  });
}

export function buildIndexerWorksetReadReceipt(input: {
  request: IndexerWorksetReadRequest;
  responses: readonly unknown[];
}): IndexerWorksetReadReceipt {
  const request = parseCanonicalReadRequest(input.request);
  if (input.responses.length === 0) {
    throw new TypeError("workset read receipt requires at least one response page");
  }
  let expectedCursor = request.transport.cursor;
  const seenCursors = new Set<string>();
  if (expectedCursor !== undefined) seenCursors.add(expectedCursor);
  const readSet: z.infer<typeof readSetEntrySchema>[] = [];
  const pagePayloadDigests: string[] = [];
  for (const candidate of input.responses) {
    const pageRequest: IndexerWorksetReadRequest = {
      ...request,
      transport: {
        ...(expectedCursor === undefined ? {} : { cursor: expectedCursor }),
        page_size: request.transport.page_size,
      },
    };
    const response = validateIndexerWorksetReadResponse({
      response: candidate,
      request: pageRequest,
    });
    readSet.push(...response.items.map((item) => ({
      ref: item.ref,
      item_digest: item.item_digest,
    })));
    pagePayloadDigests.push(response.page_payload_digest);
    expectedCursor = response.transport.next_cursor;
    if (expectedCursor !== undefined) {
      if (seenCursors.has(expectedCursor)) {
        throw new TypeError("workset read cursor chain contains a cycle");
      }
      seenCursors.add(expectedCursor);
    }
  }
  const finalResponse = indexerWorksetReadResponseSchema.parse(
    input.responses[input.responses.length - 1],
  );
  if (!finalResponse.transport.complete || expectedCursor !== undefined) {
    throw new TypeError("workset read receipt requires a complete cursor chain");
  }
  const sortedReadSet = [...readSet].sort((left, right) =>
    compareIndexerCanonicalText(left.ref, right.ref)
  );
  if (new Set(sortedReadSet.map((item) => item.ref)).size !== sortedReadSet.length) {
    throw new TypeError("workset read pages contain duplicate refs");
  }
  if (
    sortedReadSet.length !== request.requested_refs.length ||
    sortedReadSet.some((item, index) => item.ref !== request.requested_refs[index])
  ) {
    throw new TypeError("workset read pages do not cover the exact requested ref set");
  }
  const payload: ReadReceiptPayload = {
    protocol: "context.indexer.workset-read-receipt/v1",
    workset_digest: request.workset_digest,
    request_digest: request.request_digest,
    read_kind: request.read_kind,
    read_set: sortedReadSet,
    read_set_digest: indexerWorksetReadSetDigest(sortedReadSet),
    page_payload_digests: pagePayloadDigests,
  };
  return indexerWorksetReadReceiptSchema.parse({
    ...payload,
    receipt_digest: indexerWorksetReadReceiptDigest(payload),
  });
}

export function validateIndexerWorksetReadReceipt(
  value: unknown,
): IndexerWorksetReadReceipt {
  const receipt = indexerWorksetReadReceiptSchema.parse(value);
  if (indexerWorksetReadSetDigest(receipt.read_set) !== receipt.read_set_digest) {
    throw new TypeError("workset read set digest is invalid");
  }
  if (indexerWorksetReadReceiptDigest(receipt) !== receipt.receipt_digest) {
    throw new TypeError("workset read receipt digest is invalid");
  }
  const sortedReadSet = [...receipt.read_set].sort((left, right) =>
    compareIndexerCanonicalText(left.ref, right.ref)
  );
  if (sortedReadSet.some((item, index) => item.ref !== receipt.read_set[index]?.ref)) {
    throw new TypeError("workset read receipt read_set must use canonical ordering");
  }
  return receipt;
}
