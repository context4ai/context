import { atomicWriteFile } from "../lib/atomicWrite.js";
import { workspaceVersionComparison } from "./workspaceVersionComparison.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { withProjectWriteLock } from "./writeLock.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { recoverDurableMultiFileTransactions, runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";

import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { excludedWorkspaceContent, observeWorkspaceContent, type WorkspaceSnapshotFormat } from "./workspaceContentSnapshot.js";
export { workspaceContentSnapshot } from "./workspaceContentSnapshot.js";

const exec = promisify(execFile);
const semver = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
const text = z.string().trim().min(1);
export const changelogEntrySchema = z.object({
  version: semver, date: z.string().datetime(), title: text, changes: z.array(text).min(1),
  triggers: z.array(z.object({ kind: z.enum(["initial", "note", "sessions", "mr", "module", "document", "navigation", "repair", "dist", "translation", "other"]), description: text }).strict()).min(1),
  actor: z.object({ name: text, kind: z.enum(["git", "lark", "user"]) }).strict().optional(),
}).strict();
export const changelogInputSchema = changelogEntrySchema.omit({ date: true }).extend({ expected_digest: text, base_ref: text.optional() });
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;
const ledgerSchema = z.object({ entries: z.array(changelogEntrySchema) }).strict();
const VERSION_CHECKPOINT = ".tmp/context-runtime/version-checkpoint.json";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function optionalWorkspaceText(root: string, path: string) {
  try { return await readFile(join(root, path), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function readWorkspaceChangelog(root: string): Promise<ChangelogEntry[]> {
  const value = await optionalWorkspaceText(root, "changelog.yaml");
  return value === undefined ? [] : ledgerSchema.parse(parse(value)).entries;
}
export async function workspaceVersion(root: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  return semver.parse(manifest.version ?? "0.0.0");
}
interface VersionCheckpoint { version?: string; digest?: string; format?: WorkspaceSnapshotFormat; checked?: string }

/** Existing disposable checkpoint, also used after an explicitly accepted
 * presentation-only update. The caller holds the workspace write lock. */
export async function writeWorkspaceVersionCheckpoint(root: string, version: string, digest: string,
  format: WorkspaceSnapshotFormat = "git-blob-v1"): Promise<void> {
  await atomicWriteFile(join(root, VERSION_CHECKPOINT), JSON.stringify({ version, digest, format }) + "\n");
}

async function migrateCheckpoint(root: string, original: string | undefined, value: VersionCheckpoint): Promise<void> {
  try {
    await withProjectWriteLock(root, "migrate-version-checkpoint", async () => {
      // An observation must not overwrite a newer record from another command.
      if (await optionalWorkspaceText(root, VERSION_CHECKPOINT) !== original) return;
      await atomicWriteFile(join(root, VERSION_CHECKPOINT), JSON.stringify(value) + "\n");
    });
  } catch { /* Checkpoints are disposable; inspection can use its verified result. */ }
}
/** The remote default branch (as last fetched) when its changelog already records
 * this version: a merged version may already be published, so it is not reused.
 * Reads only local remote-tracking refs; no network. */
async function versionMergedTo(root: string, version: string): Promise<string | undefined> {
  const git = (args: string[]) => exec("git", args, { cwd: root, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 })
    .then(value => value.stdout.trim(), () => undefined);
  const prefix = await git(["rev-parse", "--show-prefix"]);
  if (prefix === undefined) return undefined;
  const head = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  for (const ref of [...(head ? [head] : []), "origin/main", "origin/master"]) {
    const text = await git(["show", `${ref}:${prefix}changelog.yaml`]);
    if (text === undefined) continue;
    try { if (ledgerSchema.parse(parse(text)).entries.some(entry => entry.version === version)) return ref; }
    catch { /* An unreadable remote changelog proves nothing. */ }
    return undefined;
  }
  return undefined;
}
export async function inspectWorkspaceVersion(root: string, baseRef?: string) {
  const snapshot = await observeWorkspaceContent(root);
  const { files } = snapshot;
  const entries = await readWorkspaceChangelog(root);
  const version = await workspaceVersion(root);
  const comparison = await workspaceVersionComparison(root, version, Object.keys(files), baseRef);
  comparison.removed = comparison.removed.filter(path => !excludedWorkspaceContent(path));
  const digest = hash(files);
  const checkpointText = await optionalWorkspaceText(root, VERSION_CHECKPOINT);
  let checkpoint: VersionCheckpoint | undefined;
  try { checkpoint = JSON.parse(checkpointText ?? "null") ?? undefined; }
  catch { /* A disposable checkpoint never prevents inspection or recovery. */ }
  if (checkpoint?.version === version && checkpoint.digest !== digest && (!checkpoint.format || checkpoint.format === "sha256-v1" && snapshot.format === "git-blob-v1")) {
    // Keep the old inclusion rules for the failure key as well: restoring a
    // formerly included PLAN file must invalidate a failed migration attempt.
    const fast = await observeWorkspaceContent(root, { legacy: !checkpoint.format });
    const checked = hash(fast.files);
    if (checkpoint.checked !== checked) {
      const legacy = await observeWorkspaceContent(root, { legacy: !checkpoint.format, raw: true });
      checkpoint = hash(legacy.files) === checkpoint.digest
        ? { version, digest, format: snapshot.format }
        : { ...checkpoint, checked };
      await migrateCheckpoint(root, checkpointText, checkpoint);
    }
  }
  const recorded = entries[0]?.version === version;
  const matches = checkpoint?.version === version && checkpoint.digest === digest;
  const changed = checkpoint?.version === version ? !matches
    : comparison.added.length + comparison.updated.length + comparison.removed.length > 0 || !recorded;
  const mergedTo = recorded && !comparison.tagged ? await versionMergedTo(root, version) : undefined;
  return { version, previous_version: version, changed,
    reusable_version: recorded && !comparison.tagged && !mergedTo ? version : null,
    ...(mergedTo ? { merged_to: mergedTo } : {}),
    // Reconstruct from Git when the cache is missing; non-Git workspaces retain their recorded version.
    current: recorded && (matches || checkpoint?.version !== version && (comparison.base_commit === null || !changed)),
    expected_digest: hash({ files, version, entries, base: comparison.base_commit }),
    ...comparison, files, content_digest: digest, snapshot_format: snapshot.format };
}
export function renderChangelog(entries: readonly ChangelogEntry[]) {
  const escape = (value: string) => value.replace(/[\\<>\[\]`*_{}]/gu, "\\$&").replace(/[\r\n]/gu, " ");
  return ["# Changelog", "", ...entries.flatMap(entry => [
    `## ${entry.version} — ${entry.date.slice(0, 10)}`, "", `### ${escape(entry.title)}`, "",
    ...entry.changes.map(change => `- ${escape(change)}`), "",
    `Trigger: ${entry.triggers.map(trigger => `${trigger.kind}: ${escape(trigger.description)}`).join("; ")}`,
    ...(entry.actor ? [`User: ${escape(entry.actor.name)} (${entry.actor.kind})`] : []), "",
  ])].join("\n") + "\n";
}
export async function recordWorkspaceVersion(root: string, value: unknown) {
  const input = changelogInputSchema.parse(value);
  return withProjectWriteLock(root, "record-workspace-version", async () => {
    await recoverDurableMultiFileTransactions(root);
    const status = await inspectWorkspaceVersion(root, input.base_ref);
    const previousEntries = await readWorkspaceChangelog(root);
    const latest = previousEntries[0];
    const descriptionOnly = input.version === status.version && latest?.version === input.version && status.current && !status.changed;
    if (descriptionOnly) {
      const unchanged = input.title === latest.title && hash(input.changes) === hash(latest.changes) &&
        hash(input.triggers) === hash(latest.triggers) && (input.actor === undefined || hash(input.actor) === hash(latest.actor));
      if (unchanged) return { version: input.version, outcome: "already-recorded" as const,
        next_action: { command: "context status --format json" } };
      if (status.tagged) throw new ContextError(ExitCode.UserError, "A tagged version description cannot be changed.", {
        category: ErrorCategory.UserInputInvalid, reason_code: "version-tagged", next: "Record a new version for a published update.",
      });
    } else {
      if (status.expected_digest !== input.expected_digest) throw new TypeError("Version diff changed; run context version inspect --format json and review the new diff.");
      if (!status.changed && !input.triggers.some(trigger => trigger.kind === "dist")) throw new TypeError("No formal content changed; build or temporary progress does not require a new version.");
    }
    const previous = status.previous_version ?? status.version;
    const a = previous.split(".").map(Number), b = input.version.split(".").map(Number);
    const amend = status.reusable_version === input.version;
    if (!amend && !(b[0]! > a[0]! || b[0] === a[0] && (b[1]! > a[1]! || b[1] === a[1] && b[2]! > a[2]!))) throw new TypeError("The new SemVer must be greater than the previous workspace version; only an untagged current entry that is not yet on the remote default branch may be amended.");
    let actor = input.actor ?? (amend ? previousEntries[0]?.actor : undefined);
    if (!actor) { try { const name = (await exec("git", ["config", "user.name"], { cwd: root })).stdout.trim(); if (name) actor = { name, kind: "git" }; } catch { /* Identity is optional. */ } }
    const { expected_digest: _, base_ref: _base, ...fields } = input;
    void _base;
    void _;
    const entry = changelogEntrySchema.parse({ ...fields, date: new Date().toISOString(), ...(actor ? { actor } : {}) });
    const entries = [entry, ...(amend ? previousEntries.slice(1) : previousEntries)];
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")); manifest.version = entry.version;
    const writes: Record<string, string> = { ...(!descriptionOnly ? { "package.json": JSON.stringify(manifest, null, 2) + "\n" } : {}),
      "changelog.yaml": stringify({ entries }), "CHANGELOG.md": renderChangelog(entries) };
    const targets = await Promise.all(Object.entries(writes).map(async ([path, content]) => {
      const before = await optionalWorkspaceText(root, path);
      return { path, content, operation: "write" as const, base_digest: before === undefined ? null : durableContentDigest(before), target_digest: durableContentDigest(content) };
    }));
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    await runDurableMultiFileTransaction({ projectRoot: root, kind: "record-workspace-version", proposal_digest: hash(writes), targets });
    try { if (!descriptionOnly) await writeWorkspaceVersionCheckpoint(root, entry.version, status.content_digest, status.snapshot_format); }
    catch { /* The durable version is committed; a disposable cache cannot undo it. */ }
    if (!descriptionOnly) await rm(join(root, ".tmp/context-runtime/format-only-update.json"), { force: true }).catch(() => undefined);
    return { version: entry.version, ...(descriptionOnly ? { outcome: "description-updated" as const } : {}), next_action: { command: "context status --format json" } };
  });
}
