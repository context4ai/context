import { createHash } from "node:crypto";
import { posix, relative } from "node:path";
import YAML from "yaml";
import { articleSourceRegion, articleSourceRegionDigest, locateArticleRegion, parseRepoContentRef, repoContentPathSchema,
  repoContentScopeMatches, type ArticleSourceReference, type ArticleStructureEntry } from "@c4a/context";
import { optionalRepoGit, readRepoContentAt, repoContentGit } from "./repoContentGit.js";
import { readRepoContentRegistry, repoContentContains, repoContentExcluded,
  type RepoContentRegistration, type RegisteredRepoContent } from "./repoContentRegistry.js";

export interface RepoContentChange {
  status: string;
  path: string;
  old_path?: string;
}
export interface RepoContentImpact {
  state: "unchanged" | "changed" | "moved" | "unavailable" | "worktree";
  changes: RepoContentChange[];
  current_path?: string;
  message?: string;
}
function parseChanges(value: string): RepoContentChange[] {
  const fields = value.split("\0");
  const changes: RepoContentChange[] = [];
  for (let i = 0; fields[i];) {
    const status = fields[i++]!;
    const old = fields[i++];
    if (!old) break;
    const renamed = /^[RC]/u.test(status);
    const path = renamed ? fields[i++] : old;
    if (path) changes.push({ status, path, ...(renamed ? { old_path: old } : {}) });
  }
  return changes;
}
export async function repoContentWorkingVersion(projectRoot: string, sourceRef: string): Promise<string> {
  const parsed = parseRepoContentRef(sourceRef);
  const registry = await readRepoContentRegistry(projectRoot);
  const entry = registry?.entries.find(item => item.id === parsed?.id);
  if (!registry || !entry) throw new TypeError(`Register ${sourceRef} in repo-content.yaml before updating it`);
  const head = await optionalRepoGit(registry.repoRoot, ["rev-parse", "HEAD"]);
  if (!head) throw new TypeError("Commit the repository before starting a source-bound knowledge update");
  const tracked = await repoContentGit(registry.repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", entry.path]);
  const portableEntry = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "absolutePath"));
  const hash = createHash("sha256").update(JSON.stringify(portableEntry));
  for (const path of [...new Set(tracked.split("\0").filter(Boolean))].sort()) {
    if (repoContentExcluded(entry, path)) continue;
    hash.update(path).update("\0");
    try { hash.update(await readRepoContentAt(registry.repoRoot, path)); }
    catch { hash.update("\0unavailable"); }
  }
  // One scope digest binds a pending update to the actual worktree. No per-file
  // digest registry or source snapshot is written.
  return `${head}+content:${hash.digest("hex")}`;
}

export async function repoContentReferenceReader(projectRoot: string) {
  const registry = await readRepoContentRegistry(projectRoot);
  const root = registry?.repoRoot ?? await optionalRepoGit(projectRoot, ["rev-parse", "--show-toplevel"]);
  return async (sourceRef: string, path: string, captured = false): Promise<string> => {
    const ref = parseRepoContentRef(sourceRef);
    if (!root || !ref?.commit) throw new TypeError("Repository evidence requires its original full commit and real path");
    repoContentPathSchema.parse(path);
    if (ref.worktree || !captured) {
      const entry = registry?.entries.find(item => item.id === ref.id);
      if (!entry || !repoContentContains(entry.path, path) || repoContentExcluded(entry, path)) {
        throw new TypeError("Current repository evidence is outside its registered entry");
      }
      if (ref.worktree && captured && await optionalRepoGit(root, ["rev-parse", "HEAD"]) !== ref.commit) {
        throw new TypeError("Working-tree evidence HEAD changed; reread and recalculate its reference");
      }
      return readRepoContentAt(root, path);
    }
    // Historical path is repository-relative; never prepend today's entry path.
    return readRepoContentAt(root, path, ref.commit);
  };
}

export async function repoContentImpactReader(projectRoot: string) {
  let registry;
  try { registry = await readRepoContentRegistry(projectRoot); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return async (): Promise<RepoContentImpact> => ({ state: "unavailable", changes: [], message });
  }
  const gitRoot = registry?.repoRoot ?? await optionalRepoGit(projectRoot, ["rev-parse", "--show-toplevel"]);
  const diffs = new Map<string, Promise<RepoContentChange[]>>();
  const untracked = new Map<string, Promise<RepoContentChange[]>>();
  async function changesFor(commit: string, oldScope: string, entry: RegisteredRepoContent) {
    const key = JSON.stringify([commit, oldScope, entry.path]);
    if (!diffs.has(key)) diffs.set(key, (async () => {
      let changes = parseChanges(await repoContentGit(gitRoot!, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "-M", commit, "--", oldScope, entry.path]));
      if (changes.some(item => item.status === "D" && repoContentContains(oldScope, item.path))) {
        // Unknown destination: recognize moves before filtering, not after.
        changes = parseChanges(await repoContentGit(gitRoot!, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "-M", commit]));
      }
      return changes;
    })());
    if (!untracked.has(entry.id)) untracked.set(entry.id, repoContentGit(gitRoot!, ["ls-files", "--others", "--exclude-standard", "-z", "--", entry.path])
      .then(value => value.split("\0").filter(Boolean).map(path => ({ status: "untracked", path }))));
    return [...await diffs.get(key)!, ...await untracked.get(entry.id)!];
  }
  async function oldEntryPath(commit: string, entry: RegisteredRepoContent): Promise<string> {
    try {
      const path = relative(gitRoot!, projectRoot).split("\\").join("/");
      const text = await readRepoContentAt(gitRoot!, posix.join(path, "repo-content.yaml"), commit);
      const old: unknown = YAML.parse(text)?.entries?.[entry.id]?.path;
      return repoContentPathSchema.parse(old);
    } catch { return entry.path; }
  }
  async function skillRoot(path: string, commit: string): Promise<string | undefined> {
    let directory = posix.dirname(path);
    while (directory !== ".") {
      try { await readRepoContentAt(gitRoot!, `${directory}/SKILL.md`, commit); return directory; }
      catch { directory = posix.dirname(directory); }
    }
    return undefined;
  }
  return async (reference: ArticleSourceReference): Promise<RepoContentImpact> => {
    const ref = parseRepoContentRef(reference.source_ref);
    const entry = registry?.entries.find(item => item.id === ref?.id);
    if (!ref?.commit || !gitRoot || !entry) return { state: "unavailable", changes: [], message: "Entry or fixed baseline is unavailable; assess current material before advancing the baseline." };
    try {
      repoContentPathSchema.parse(reference.locator.path);
      // A missing baseline is not equivalent to an empty diff.
      if (!ref.worktree || entry.kind === "skill" || entry.kind === "skills") {
        await readRepoContentAt(gitRoot, reference.locator.path, ref.commit);
      }
      const oldPath = await oldEntryPath(ref.commit, entry);
      const skill = entry.kind === "skill" || entry.kind === "skills" ? await skillRoot(reference.locator.path, ref.commit) : undefined;
      const oldScope = skill ?? reference.locator.path;
      const mapped = repoContentContains(oldPath, reference.locator.path)
        ? entry.path + reference.locator.path.slice(oldPath.length) : reference.locator.path;
      const currentScope = skill && repoContentContains(oldPath, skill) ? entry.path + skill.slice(oldPath.length) : skill ?? mapped;
      const changes = (await changesFor(ref.commit, oldScope, entry)).filter(change =>
        (repoContentContains(oldScope, change.old_path ?? change.path) || repoContentContains(currentScope, change.path)) &&
        !(repoContentContains(entry.path, change.path) && repoContentExcluded(entry, change.path)));
      const renamed = changes.find(change => change.old_path === reference.locator.path);
      const path = renamed?.path ?? mapped;
      if (entry.kind === "skill" || entry.kind === "skills") {
        if (!skill) return { state: "unavailable", changes, message: "Cannot recover the cited Skill directory; assess its current contents." };
        return { state: ref.worktree ? "worktree" : changes.length ? "changed" : "unchanged", changes, current_path: path };
      }
      const text = await readRepoContentAt(gitRoot, path);
      let unchanged = false;
      try { unchanged = articleSourceRegionDigest(text, { ...reference.locator, path }) === reference.content_digest; }
      catch (error) { if (!(error instanceof RangeError)) throw error; }
      if (!unchanged && !ref.worktree) {
        const baseline = await readRepoContentAt(gitRoot, reference.locator.path, ref.commit);
        // Verify the recorded baseline before relocating; a matching phrase alone
        // must not hide an invalid digest or an ambiguous repeated paragraph.
        if (articleSourceRegionDigest(baseline, reference.locator) === reference.content_digest &&
          locateArticleRegion(articleSourceRegion(baseline, reference.locator), text, path)) {
          return { state: "moved", changes, current_path: path };
        }
      }
      return { state: unchanged ? (changes.length ? "moved" : "unchanged") : "changed", changes, current_path: path };
    } catch (error) {
      return { state: "unavailable", changes: [], message: error instanceof Error ? error.message : String(error) };
    }
  };
}

export async function inspectRepoContentChanges(projectRoot: string, registry?: RepoContentRegistration) {
  const registered = registry ?? await readRepoContentRegistry(projectRoot);
  if (!registered) return [];
  const head = await optionalRepoGit(registered.repoRoot, ["rev-parse", "HEAD"]);
  return Promise.all(registered.entries.map(async entry => ({ id: entry.id, path: entry.path,
    baseline: head ?? null,
    changes: head ? parseChanges(await repoContentGit(registered.repoRoot, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "-M", head, "--", entry.path]))
      .filter(change => !repoContentExcluded(entry, change.path)) : [],
    untracked: (await repoContentGit(registered.repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", entry.path]))
      .split("\0").filter(path => path && !repoContentExcluded(entry, path)) })));
}

/** Called only after a source scope is explicitly settled, never by inspect or
 * editing. Preserve unavailable evidence instead of manufacturing a new locator. */
export async function advanceRepoContentReferences(projectRoot: string, articles: ArticleStructureEntry[], scopes: readonly string[]) {
  if (!scopes.some(scope => scope.startsWith("repo-content:"))) return articles;
  const registry = await readRepoContentRegistry(projectRoot);
  if (!registry) return articles;
  const head = await optionalRepoGit(registry.repoRoot, ["rev-parse", "HEAD"]);
  if (!head) return articles;
  const impact = await repoContentImpactReader(projectRoot);
  return Promise.all(articles.map(async article => ({ ...article,
    sections: await Promise.all(article.sections.map(async section => ({ ...section,
      references: await Promise.all(section.references.map(async reference => {
        const parsed = parseRepoContentRef(reference.source_ref);
        const entry = registry.entries.find(item => item.id === parsed?.id);
        if (!parsed || !entry || !scopes.some(scope => repoContentScopeMatches(scope, reference.source_ref))) return reference;
        const result = await impact(reference);
        const path = result.current_path ?? reference.locator.path;
        if (!repoContentContains(entry.path, path) || repoContentExcluded(entry, path)) return reference;
        try {
          const text = await readRepoContentAt(registry.repoRoot, path);
          let locator = { ...reference.locator, path };
          if (!parsed.worktree && parsed.commit) {
            try {
              const original = await readRepoContentAt(registry.repoRoot, reference.locator.path, parsed.commit);
              const relocated = locateArticleRegion(articleSourceRegion(original, reference.locator), text, path);
              if (relocated) locator = relocated;
            } catch { /* Explicit scope assessment still controls settlement. */ }
          }
          let scope = path;
          if (entry.kind === "skill" || entry.kind === "skills") {
            scope = posix.dirname(path);
            while (repoContentContains(entry.path, scope)) {
              try { await readRepoContentAt(registry.repoRoot, `${scope}/SKILL.md`); break; }
              catch { scope = posix.dirname(scope); }
            }
            if (!repoContentContains(entry.path, scope)) return reference;
          }
          const dirty = (await repoContentGit(registry.repoRoot, ["status", "--porcelain", "--untracked-files=all", "--", scope])).trim();
          return { ...reference, source_ref: `repo-content:${parsed.id}@${head}${dirty ? "+worktree" : ""}`,
            locator, content_digest: articleSourceRegionDigest(text, locator) };
        } catch { return reference; }
      })),
    }))),
  })));
}
