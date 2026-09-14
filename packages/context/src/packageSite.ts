import { z } from "zod";

const siteHrefSchema = z.string().trim().min(1).refine(value =>
  /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/u.test(value),
  "Use an https URL, mailto URL, root-relative path, or page anchor",
);

const packageSiteHomeActionSchema = z.object({
  text: z.string().trim().min(1),
  link: siteHrefSchema,
  theme: z.enum(["brand", "alt"]).optional(),
}).strict();

const packageSiteHomeResourceSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  href: siteHrefSchema.optional(),
  action: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1).optional(),
  featured: z.boolean().optional(),
}).strict().refine(value => value.href !== undefined || value.command !== undefined, {
  message: "A homepage resource requires href or command",
});

const packageSiteHomeSchema = z.object({
  title: z.string().trim().min(1).optional(),
  slogan: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  actions: z.array(packageSiteHomeActionSchema).optional(),
  resources: z.array(packageSiteHomeResourceSchema).optional(),
}).strict();

/** Static website in a sibling dist/<name-without-trailing-kb>-site directory. */
export const packageSiteSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  lang: z.string().min(1).default("en-US"),
  base: z.string().regex(/^\/(?:[a-zA-Z0-9_-]+\/)*$/, "Use / or a slash-delimited deployment path, such as /docs/").default("/"),
  home: packageSiteHomeSchema.optional(),
}).strict();
export type PackageSiteDefinition = z.input<typeof packageSiteSchema>;

export function normalizePackageSite(value: PackageSiteDefinition | undefined) {
  return value === undefined ? undefined : packageSiteSchema.parse(value);
}
