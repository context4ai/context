import { z } from "zod";

/* ── Zod Schema ─────────────────────────────────────────── */

export const PathFilterConfigSchema = z.object({
  package: z
    .object({ include: z.array(z.string()).default([]) })
    .default({}),
  code: z
    .object({
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([]),
    })
    .default({}),
  doc: z
    .object({
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([]),
    })
    .default({}),
});

export type PathFilterConfig = z.infer<typeof PathFilterConfigSchema>;

/* ── Default values (aligned with existing hardcoded rules) ── */

export const DEFAULT_PATH_FILTER: PathFilterConfig = {
  package: {
    include: [
      "**/{package.json,pyproject.toml,setup.py,go.mod,Cargo.toml,pom.xml,build.gradle}",
    ],
  },
  code: {
    include: ["**/*.{ts,tsx}"],
    exclude: [
      "**/__{tests,test,e2e,mocks,fixtures,snapshots}__/**",
      "**/*.{test,spec,d}.{ts,tsx}",
    ],
  },
  doc: {
    include: ["*.md", "docs/**/*.md"],
    exclude: ["**/CHANGELOG.md"],
  },
};

/* ── Resolver ───────────────────────────────────────────── */

/**
 * Read path_filter from source metadata, falling back to DEFAULT_PATH_FILTER.
 * Returns the config and whether it's the default.
 */
export function resolvePathFilter(
  metadata?: Record<string, unknown> | null,
): { config: PathFilterConfig; isDefault: boolean } {
  const raw = metadata?.path_filter;
  if (raw == null) return { config: DEFAULT_PATH_FILTER, isDefault: true };
  const parsed = PathFilterConfigSchema.safeParse(raw);
  if (!parsed.success) return { config: DEFAULT_PATH_FILTER, isDefault: true };
  return { config: parsed.data, isDefault: false };
}
