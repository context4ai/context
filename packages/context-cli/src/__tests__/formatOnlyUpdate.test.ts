import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import { beginFormatOnlyUpdate, approveFormatOnlyUpdate, recordFormatOnlyCapture, settleFormatOnlyUpdate } from "../project/formatOnlyUpdate.js";
import { inspectWorkspaceVersion, writeWorkspaceVersionCheckpoint } from "../project/workspaceChangelog.js";
import { mapReferenceRange } from "../project/referenceRangeMap.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function put(root: string, path: string, content: string) {
  await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), content);
}
async function fixture() {
  const parent = resolve(import.meta.dir, "../../../.tmp/format-only-tests");
  await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, "case-")); roots.push(root);
  await put(root, "package.json", '{"version":"1.0.0"}');
  await put(root, "changelog.yaml", YAML.stringify({ entries: [{ version: "1.0.0", date: "2026-01-01T00:00:00.000Z", title: "Initial", changes: ["Initial"], triggers: [{ kind: "initial", description: "Initial" }] }] }));
  await put(root, "knowledge/structure.yaml", YAML.stringify({ articles: [], processed_scopes: [] }));
  const status = await inspectWorkspaceVersion(root);
  await writeWorkspaceVersionCheckpoint(root, status.version, status.content_digest, status.snapshot_format);
  await beginFormatOnlyUpdate(root);
  return root;
}
async function capture(root: string, name: string) {
  const body = `# ${name}\n\nA formatted link.\n`;
  const path = `sources/lark/${name}/body.md`, manifestPath = `sources/lark/${name}/manifest.json`;
  const snapshot = createDocumentSnapshotManifest({ sourceType: "lark", sourceName: name,
    capturedAt: "2026-01-01T00:00:00.000Z", files: [{ path: "body.md", bytes: body, title: name }] });
  await put(root, path, body); await put(root, manifestPath, JSON.stringify(snapshot));
  await recordFormatOnlyCapture(root, { source: `lark:${name}`, manifestPath, snapshot,
    files: { [path]: `sha256:${createHash("sha256").update(body).digest("hex")}` } });
}
async function approve(root: string, name: string) {
  await approveFormatOnlyUpdate(root, { source: `lark:${name}`, reason: "Only the link rendering changed", references: [], scopes: [] });
}

test("a refresh accumulates approvals without exempting another unreviewed document", async () => {
  const root = await fixture(); await capture(root, "a"); await capture(root, "b");
  await approve(root, "a"); expect(await settleFormatOnlyUpdate(root)).toBe(false);
  expect((await inspectWorkspaceVersion(root)).changed).toBe(true);
  await approve(root, "b"); expect(await settleFormatOnlyUpdate(root)).toBe(true);
  expect((await inspectWorkspaceVersion(root)).current).toBe(true);
});

test("shared structure changes and unrelated files cannot be hidden by format approval", async () => {
  const root = await fixture(); await capture(root, "a"); await approve(root, "a");
  const path = join(root, "knowledge/structure.yaml"), before = await readFile(path, "utf8");
  await writeFile(path, YAML.stringify({ ...YAML.parse(before), unrelated_setting: "changed" }));
  expect(await settleFormatOnlyUpdate(root)).toBe(false);
  await writeFile(path, before); await put(root, "knowledge/another.md", "An unrelated edit");
  expect(await settleFormatOnlyUpdate(root)).toBe(false);
  expect((await inspectWorkspaceVersion(root)).changed).toBe(true);
});

test("a capture modified after approval cannot be exempted", async () => {
  const root = await fixture(); await capture(root, "a"); await approve(root, "a");
  await put(root, "sources/lark/a/body.md", "A different fact");
  expect(await settleFormatOnlyUpdate(root)).toBe(false);
});

test("line alignment proposes changed regions but never invents a replacement for deletion", () => {
  expect(mapReferenceRange({ path: "body.md", start_line: 5, end_line: 6 }, [{ old: 2, oldCount: 1, next: 2, nextCount: 3 }]))
    .toEqual({ path: "body.md", start_line: 7, end_line: 8 });
  expect(mapReferenceRange({ path: "body.md", start_line: 5, end_line: 6 }, [{ old: 5, oldCount: 2, next: 5, nextCount: 0 }])).toBeUndefined();
});
