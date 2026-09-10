import { z } from "zod";
import { parseDocument, stringify } from "yaml";

/** Associations are supplied by the caller, not proof of implementation or approval. */
export const sessionChangeSchema = z.object({
  repository: z.string().trim().min(1).optional(),
  commit: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u).optional(),
  mr: z.string().url().refine((value) => /^https?:\/\//u.test(value), "MR/PR must be an HTTP(S) URL").optional(),
}).strict().refine((value) => value.commit !== undefined || value.mr !== undefined,
  "A session change needs a commit or MR/PR reference");
export const sessionChangesSchema = z.array(sessionChangeSchema);
export type SessionChange = z.infer<typeof sessionChangeSchema>;

function sourceHeader(markdown: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  if (!match) return undefined;
  const document = parseDocument(match[1]!, { uniqueKeys: true });
  if (document.errors.length) throw new TypeError(`Invalid sessions frontmatter: ${document.errors[0]!.message}`);
  const value: unknown = document.toJS();
  if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw new TypeError("Sessions frontmatter must be a mapping");
  }
  return { value: (value ?? {}) as Record<string, unknown>, body: markdown.slice(match[0].length) };
}

export function readSessionChanges(markdown: string): SessionChange[] | undefined {
  const value = sourceHeader(markdown)?.value.changes;
  return value === undefined ? undefined : sessionChangesSchema.parse(value);
}

/** Omitted changes preserve inline metadata. Explicit [] removes associations.
 * Only the source header is serialized; the summary body is never rewritten. */
export function writeSessionChanges(markdown: string, changes?: readonly SessionChange[]): string {
  if (changes === undefined) { readSessionChanges(markdown); return markdown; }
  const parsed = sessionChangesSchema.parse(changes);
  const header = sourceHeader(markdown);
  const metadata = { ...(header?.value ?? {}) };
  if (parsed.length) metadata.changes = parsed;
  else delete metadata.changes;
  const body = header?.body ?? markdown;
  if (!Object.keys(metadata).length) return body;
  return `---\n${stringify(metadata)}---\n${body}`;
}
