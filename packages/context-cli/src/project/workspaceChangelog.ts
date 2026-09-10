import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, lstat, readdir } from "node:fs/promises";
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
export const changelogInputSchema = changelogEntrySchema.omit({ date: true }).extend({ expected_digest: text });
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;
const ledgerSchema = z.object({ entries: z.array(changelogEntrySchema) }).strict();
const baselineSchema = z.object({ version: semver, files: z.record(z.string()) }).strict();
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
  return /^(?:\.tmp|\.git|node_modules|dist)(?:\/|$)/u.test(path) ||
    ["changelog.yaml", "CHANGELOG.md", ".context-version.json", ".context-builds.json", ".context-published.json"].includes(path);
}
export async function workspaceContentSnapshot(root: string) {
  let paths: string[];
  try { paths = (await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout.split("\0").filter(Boolean); }
  catch {
    paths = [];
    const visit = async (dir: string) => {
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (excluded(path)) continue;
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) paths.push(path);
      }
    };
    await visit("");
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
export async function inspectWorkspaceVersion(root: string, publishing = false) {
  const files = await workspaceContentSnapshot(root);
  const raw = await optionalWorkspaceText(root, ".context-version.json");
  const baseline = raw === undefined ? undefined : baselineSchema.parse(JSON.parse(raw));
  const entries = await readWorkspaceChangelog(root);
  const version = await workspaceVersion(root);
  const previous = baseline?.files ?? {};
  const added = Object.keys(files).filter(path => !(path in previous));
  const updated = Object.keys(files).filter(path => path in previous && files[path] !== previous[path]);
  const removed = Object.keys(previous).filter(path => !(path in files));
  const dist = publishing ? await (await import("./workspacePublishVersion.js")).inspectWorkspacePublish(root) : undefined;
  const changed = added.length + updated.length + removed.length > 0 || dist?.needs_version === true;
  return { version, previous_version: baseline?.version ?? null, changed,
    current: !changed && baseline?.version === version && entries[0]?.version === version,
    expected_digest: hash({ files, version, baseline, entries, dist }), added, updated, removed, files };
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
    const status = await inspectWorkspaceVersion(root, input.triggers.some(trigger => trigger.kind === "dist"));
    if (status.expected_digest !== input.expected_digest) throw new TypeError("Version diff changed; run context version inspect --format json and review the new diff.");
    if (!status.changed) throw new TypeError("No formal content changed; build or temporary progress does not require a new version.");
    const previous = status.previous_version ?? status.version;
    const a = previous.split(".").map(Number), b = input.version.split(".").map(Number);
    if (!(b[0]! > a[0]! || b[0] === a[0] && (b[1]! > a[1]! || b[1] === a[1] && b[2]! > a[2]!))) throw new TypeError("The new SemVer must be greater than the previous workspace version.");
    let actor = input.actor;
    if (!actor) { try { const name = (await exec("git", ["config", "user.name"], { cwd: root })).stdout.trim(); if (name) actor = { name, kind: "git" }; } catch { /* Identity is optional. */ } }
    const { expected_digest: _, ...fields } = input;
    void _;
    const entry = changelogEntrySchema.parse({ ...fields, date: new Date().toISOString(), ...(actor ? { actor } : {}) });
    const entries = [entry, ...await readWorkspaceChangelog(root)];
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")); manifest.version = entry.version;
    const writes = { "package.json": JSON.stringify(manifest, null, 2) + "\n", "changelog.yaml": stringify({ entries }),
      "CHANGELOG.md": renderChangelog(entries), ".context-version.json": JSON.stringify({ version: entry.version, files: status.files }) + "\n" };
    const targets = await Promise.all(Object.entries(writes).map(async ([path, content]) => {
      const before = await optionalWorkspaceText(root, path);
      return { path, content, operation: "write" as const, base_digest: before === undefined ? null : durableContentDigest(before), target_digest: durableContentDigest(content) };
    }));
    targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    await runDurableMultiFileTransaction({ projectRoot: root, kind: "record-workspace-version", proposal_digest: hash(writes), targets });
    return { version: entry.version, next_action: { command: "context status --format json" } };
  });
}
