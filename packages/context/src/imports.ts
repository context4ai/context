import { z } from "zod";
import { repoContentPathSchema } from "./repoContent.js";

/** Validate a portable reader entrance, never contact its provider. */
export const importUrlSchema = z.string().min(1).refine(value => {
  // URL() also accepts special-scheme relative spellings such as https:host.
  // Keep the authored entrance, but require an explicit, unambiguous authority.
  if (!/^https?:\/\/[^/?#\\]/iu.test(value) || /[\s\u0000-\u001f\u007f<>\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}, "Use an absolute http:// or https:// entrance without credentials, whitespace or backslashes");
export const importIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
export const importEntrySchema = z.object({
  url: importUrlSchema,
  kind: z.string().min(1).optional(),
  format: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  path: repoContentPathSchema.optional(),
  version: z.string().min(1).optional(),
}).strict();
export const importsRegistrySchema = z.object({
  protocol: z.literal("context.imports/v1"),
  imports: z.record(importIdSchema, importEntrySchema),
}).strict();
export type ImportEntry = z.infer<typeof importEntrySchema>;
export type ImportsRegistry = z.infer<typeof importsRegistrySchema>;
