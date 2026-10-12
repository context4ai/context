import { siteThemeSchema } from "./siteTheme.js";
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

const localeTagSchema = z.string().regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u, "Use a BCP 47 language tag, such as zh-CN");
const localizedTextSchema = z.record(localeTagSchema, z.string().trim().min(1));

/** Every page keeps one URL; the reader's language selects which translation is shown. */
const packageSiteLocaleSchema = z.object({
  label: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  home: packageSiteHomeSchema.optional(),
}).strict();

const packageSiteNavLinkSchema = z.object({
  text: z.string().trim().min(1),
  link: siteHrefSchema,
  locales: localizedTextSchema.optional(),
}).strict();

const packageSiteMoreItemSchema = z.object({
  text: z.string().trim().min(1),
  link: siteHrefSchema.optional(),
  /** Approved article shown only through this menu, outside the knowledge map. */
  target: z.object({ artifact_ref: z.string().trim().min(1) }).strict().optional(),
  locales: localizedTextSchema.optional(),
}).strict().refine(value => (value.link === undefined) !== (value.target === undefined), {
  message: "A More menu item requires exactly one of link or target",
});

const packageSiteSocialLinkSchema = z.object({
  icon: z.enum(["github", "discord", "x", "youtube", "slack", "linkedin", "mastodon", "npm"]),
  link: z.string().regex(/^https:\/\//u, "Use an https URL"),
  ariaLabel: z.string().trim().min(1).optional(),
}).strict();

/** Static website in a sibling dist/<name-without-trailing-kb>-site directory. */
export const packageSiteSchema = z.object({
  theme: siteThemeSchema.optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  lang: z.string().min(1).default("en-US"),
  base: z.string().regex(/^\/(?:[a-zA-Z0-9_-]+\/)*$/, "Use / or a slash-delimited deployment path, such as /docs/").default("/"),
  home: packageSiteHomeSchema.optional(),
  /** Additional reader languages; translations are optional and never reviewed knowledge. */
  locales: z.record(localeTagSchema, packageSiteLocaleSchema).optional(),
  /** Target of the top-bar title; defaults to the site home. Root-relative links address the site origin. */
  titleLink: siteHrefSchema.optional(),
  /** Top navigation links after the knowledge sections. Root-relative links address the site origin. */
  nav: z.array(packageSiteNavLinkSchema).optional(),
  /** Items appended to the More menu after LLM Docs and Changelog. */
  more: z.array(packageSiteMoreItemSchema).optional(),
  socialLinks: z.array(packageSiteSocialLinkSchema).optional(),
  /** Shared localStorage key so sites on one origin keep the same reader language. */
  localePreferenceKey: z.string().regex(/^[a-zA-Z0-9:._-]+$/u).optional(),
  /** Trusted presentation code, relative to the workspace; never captured knowledge. */
  extensions: z.object({
    root: z.string().regex(/^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/).default("src/site"),
    slots: z.object({
      /** Replaces the site title at the start of the top bar, for example with a logo. */
      brand: z.string().min(1).optional(),
      banner: z.union([z.string().min(1), z.literal(false)]).optional(),
      knowledge: z.union([z.string().min(1), z.literal(false)]).optional(),
      resources: z.union([z.string().min(1), z.literal(false)]).optional(),
      footer: z.union([z.string().min(1), z.literal(false)]).optional(),
      floating: z.union([z.string().min(1), z.literal(false)]).optional(),
    }).strict().optional(),
    pages: z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), z.string().min(1)).optional(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  for (const tag of Object.keys(value.locales ?? {})) {
    if (tag.toLowerCase() === value.lang.toLowerCase()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["locales", tag], message: "An additional locale must differ from the primary site lang" });
    }
  }
});
export type PackageSiteDefinition = z.input<typeof packageSiteSchema>;
export type PackageSiteLocale = z.output<typeof packageSiteLocaleSchema>;

export function normalizePackageSite(value: PackageSiteDefinition | undefined) {
  return value === undefined ? undefined : packageSiteSchema.parse(value);
}
