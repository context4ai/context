import { z } from "zod";
import { indexerProtocolDigest } from "./indexerProtocolCommon.js";

const normalizedSubjectFieldSchema = z.string().min(1).refine(
  (value) => value.normalize("NFC") === value,
  "SubjectKey fields must use Unicode NFC normalization",
);

export const indexerSubjectKeySchema = z.object({
  protocol: z.literal("context.subject-key/v1"),
  namespace: normalizedSubjectFieldSchema,
  kind: normalizedSubjectFieldSchema,
  local_key: normalizedSubjectFieldSchema,
}).strict();

export type IndexerSubjectKey = z.infer<typeof indexerSubjectKeySchema>;

export function canonicalIndexerNodeRef(value: unknown): string {
  const subjectKey = indexerSubjectKeySchema.parse(value);
  return `node:subject:${indexerProtocolDigest(subjectKey)}`;
}
