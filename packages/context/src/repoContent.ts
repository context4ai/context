import { z } from "zod";

export const repoContentPathSchema = z.string().min(1).refine(value =>
  !/[\\\u0000-\u001f\u007f:]/u.test(value) && value.split("/").every(part =>
    part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git"),
"Use a repository-relative path without traversal or .git components");
const segment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
export const repoContentEntrySchema = z.object({
  kind: z.enum(["docs", "skills", "document", "skill"]),
  path: repoContentPathSchema,
  exclude: z.array(z.string().min(1)).optional(),
  group: segment.optional(),
  mount: repoContentPathSchema.optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
}).strict();
export const repoContentRegistrySchema = z.object({
  protocol: z.literal("context.repo-content/v1"),
  entries: z.record(segment, repoContentEntrySchema),
}).strict();
export type RepoContentEntry = z.infer<typeof repoContentEntrySchema>;
export type RepoContentRegistry = z.infer<typeof repoContentRegistrySchema>;

export function repoContentMount(entry: RepoContentEntry): string {
  return entry.mount ?? [entry.group, entry.path.split("/").at(-1)].filter(Boolean).join("/");
}

/** Scope selectors omit a revision; evidence references always include one. */
export function parseRepoContentRef(value: string): { id: string; commit?: string; worktree: boolean } | undefined {
  const match = /^repo-content:([A-Za-z0-9][A-Za-z0-9._-]*)(?:@([a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?)(\+worktree)?)?$/u.exec(value);
  if (!match) return undefined;
  return { id: match[1]!, ...(match[2] ? { commit: match[2] } : {}), worktree: !!match[3] };
}

export function repoContentScopeMatches(scope: string, reference: string): boolean {
  if (scope === reference) return true;
  const selected = parseRepoContentRef(scope);
  const cited = parseRepoContentRef(reference);
  return !!selected && !selected.commit && !!cited && selected.id === cited.id;
}
