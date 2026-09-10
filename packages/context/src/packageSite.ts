import { z } from "zod";

/** Static website in a sibling dist/<name-without-trailing-kb>-site directory. */
export const packageSiteSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  lang: z.string().min(1).default("en-US"),
  base: z.string().regex(/^\/(?:[a-zA-Z0-9_-]+\/)*$/, "Use / or a slash-delimited deployment path, such as /docs/").default("/"),
}).strict();
export type PackageSiteDefinition = z.input<typeof packageSiteSchema>;

export function normalizePackageSite(value: PackageSiteDefinition | undefined) {
  return value === undefined ? undefined : packageSiteSchema.parse(value);
}
