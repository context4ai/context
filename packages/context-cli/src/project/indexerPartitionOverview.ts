import { compactReadingMembers } from "./indexerReadingMemberRows.js";
import { createHash } from "node:crypto";
import type { IndexerAuthorizedWorksetViewItem } from "@c4a/context";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Navigation only: the complete, unchanged Fact remains in an addressed file.
 * Unknown Fact kinds retain their original required reading. */
export function partitionOverview(item: IndexerAuthorizedWorksetViewItem, full: string) {
  const carrier = object(item.value);
  const payload = object(carrier?.payload);
  if (item.category !== "consumer-anchor" || carrier?.fact_ref !== item.ref ||
      carrier.kind !== "code-symbol" || !payload) return undefined;
  const overview = { ...payload };
  const details: string[] = [];
  for (const field of ["typeAnnotation", "initializer"]) {
    if (typeof overview[field] !== "string") continue;
    delete overview[field]; details.push(field);
  }
  for (const field of ["members", "parameters"]) {
    if (!Array.isArray(overview[field])) continue;
    const entries = overview[field] as unknown[];
    if (!entries.every(entry => object(entry) && typeof object(entry)!.name === "string")) continue;
    overview[field] = entries.map(entry => Object.fromEntries(Object.entries(object(entry)!)
      .filter(([key]) => ["name", "kind", "visibility", "static", "readonly", "optional", "parent", "deprecated"].includes(key))));
    details.push(field);
  }
  if (!details.length) return undefined;
  const digest = `sha256:${createHash("sha256").update(full).digest("hex")}`;
  const { fact_ref: _ref, payload_digest: _digest, ...rest } = carrier;
  void _ref; void _digest;
  const locator = object(rest.locator);
  if (locator) {
    const { signature_digest: _signature, ...readableLocator } = locator; void _signature;
    rest.locator = readableLocator;
  }
  return { value: { ...rest, payload: overview }, details,
    file: { digest, markdown: full },
    path: `./${digest.slice(7)}.md`, bytes: Buffer.byteLength(full) };
}

/** Lossless navigation layout: keep every task and extension, sharing only
 * equal fields. Different shapes keep missing and null fields distinct. */
export function compactPartitionNavigation(value: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(value.tasks)) return value;
  const packed = compactReadingMembers({ members: value.tasks }) as { members: unknown };
  if (packed.members === value.tasks) return value;
  return { ...value, tasks: packed.members };
}
