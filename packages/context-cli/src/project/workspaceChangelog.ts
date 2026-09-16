import { atomicWriteFile } from "../lib/atomicWrite.js";
import { workspaceVersionComparison } from "./workspaceVersionComparison.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { withProjectWriteLock } from "./writeLock.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { recoverDurableMultiFileTransactions, runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";

const exec = promisify(execFile);
const semver = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
const text = z.string().trim().min(1);
export const changelogEntrySchema = z.object({
  version: semver, date: z.string().datetime(), title: text, changes: z.array(text).min(1),
  triggers: z.array(z.object({ kind: z.enum(["initial", "note", "sessions", "mr", "module", "document", "navigation", "repair", "dist", "other"]), description: text }).strict()).min(1),
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
function excluded(path: string) {
  return /(?:^|\/)(?:\.tmp|\.git|node_modules)(?:\/|$)/u.test(path) || /^dist(?:\/|$)/u.test(path) ||
    ["changelog.yaml", "CHANGELOG.md", ".context-version.json", ".context-builds.json", ".context-published.json"].includes(path);
}
export async function workspaceContentSnapshot(root: string) {
  let paths: string[] | undefined;
  try {
    paths = (await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout.split("\0").filter(Boolean);
    // An independent workspace may live in an ignored directory of a parent
    // repository. Its empty parent Git listing is not an empty knowledge base.
    // Nonempty listings keep the usual Git ignore behavior without another call.
    if (paths.length === 0) {
      const gitRoot = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root })).stdout.trim();
      if (await realpath(gitRoot) !== await realpath(root)) paths = undefined;
    }
  } catch { paths = undefined; }
  if (paths === undefined) {
    const discovered: string[] = [];
    const visit = async (dir: string) => {
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (excluded(path)) continue;
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) discovered.push(path);
      }
    };
    await visit("");
    paths = discovered;
  }
  const files: Record<string, string> = {};
  for (const path of [...new Set(paths)].filter(path => !excluded(path)).sort()) {
    let bytes: Buffer;
    try { if (!(await lstat(join(root, path))).isFile()) continue; bytes = await readFile(join(root, path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (path === "package.json") { const value = JSON.parse(bytes.toString()); delete value.version; bytes = Buffer.from(JSON.stringify(value)); }
    files[path] = createHash("sha256").update(bytes).digest("hex");
  }
  return files;
}
export async function inspectWorkspaceVersion(root: string, baseRef?: string) {
  const files = await workspaceContentSnapshot(root);
  const entries = await readWorkspaceChangelog(root);
  const version = await workspaceVersion(root);
  const comparison = await workspaceVersionComparison(root, version, Object.keys(files), baseRef);
  comparison.removed = comparison.removed.filter(path => !excluded(path));
  const digest = hash(files);
  let checkpoint: { version?: string; digest?: string } | undefined;
  try { checkpoint = JSON.parse(await optionalWorkspaceText(root, VERSION_CHECKPOINT) ?? "null") ?? undefined; }
  catch { /* A disposable checkpoint never prevents inspection or recovery. */ }
  const recorded = entries[0]?.version === version;
  const matches = checkpoint?.version === version && checkpoint.digest === digest;
  const changed = checkpoint?.version === version ? !matches
    : comparison.added.length + comparison.updated.length + comparison.removed.length > 0 || !recorded;
  return { version, previous_version: version, changed,
    reusable_version: recorded && !comparison.tagged ? version : null,
    // Reconstruct from Git when the cache is missing; non-Git workspaces retain their recorded version.
    current: recorded && (matches || checkpoint?.version !== version && (comparison.base_commit === null || !changed)),
    expected_digest: hash({ files, version, entries, base: comparison.base_commit }),
    ...comparison, files, content_digest: digest };
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
    if (status.expected_digest !== input.expected_digest) throw new TypeError("Version diff changed; run context version inspect --format json and review the new diff.");
    if (!status.changed && !input.triggers.some(trigger => trigger.kind === "dist")) throw new TypeError("No formal content changed; build or temporary progress does not require a new version.");
    const previous = status.previous_version ?? status.version;
    const a = previous.split(".").map(Number), b = input.version.split(".").map(Number);
    const amend = status.reusable_version === input.version;
    if (!amend && !(b[0]! > a[0]! || b[0] === a[0] && (b[1]! > a[1]! || b[1] === a[1] && b[2]! > a[2]!))) throw new TypeError("The new SemVer must be greater than the previous workspace version; only an untagged current entry may be amended after checking the publication target.");
    const previousEntries = await readWorkspaceChangelog(root);
    let actor = input.actor ?? (amend ? previousEntries[0]?.actor : undefined);
    if (!actor) { try { const name = (await exec("git", ["config", "user.name"], { cwd: root })).stdout.trim(); if (name) actor = { name, kind: "git" }; } catch { /* Identity is optional. */ } }
    const { expected_digest: _, base_ref: _base, ...fields } = input;
    void _base;
    void _;
    const entry = changelogEntrySchema.parse({ ...fields, date: new Date().toISOString(), ...(actor ? { actor } : {}) });
    const entries = [entry, ...(amend ? previousEntries.slice(1) : previousEntries)];
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")); manifest.version = entry.version;
    const writes = { "package.json": JSON.stringify(manifest, null, 2) + "\n", "changelog.yaml": stringify({ entries }),
      "CHANGELOG.md": renderChangelog(entries) };
    const targets = await Promise.all(Object.entries(writes).map(async ([path, content]) => {
      const before = await optionalWorkspaceText(root, path);
      return { path, content, operation: "write" as const, base_digest: before === undefined ? null : durableContentDigest(before), target_digest: durableContentDigest(content) };
    }));
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    await runDurableMultiFileTransaction({ projectRoot: root, kind: "record-workspace-version", proposal_digest: hash(writes), targets });
    try { await atomicWriteFile(join(root, VERSION_CHECKPOINT), JSON.stringify({ version: entry.version, digest: status.content_digest }) + "\n"); }
    catch { /* The durable version is committed; a disposable cache cannot undo it. */ }
    return { version: entry.version, next_action: { command: "context status --format json" } };
  });
}
