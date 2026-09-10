import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchFeishuDocSnapshot } from "../lib/feishu.js";
import { importLarkDocument } from "../project/larkDocumentImport.js";
import { createLarkCaptureProject } from "./projectCaptureLarkV062.fixtures.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const response = JSON.stringify({ data: { document: { title: "Guide", content: "<title>Guide</title><p>Current procedure.</p>" }, revision_id: 7 } });

test("saved host document responses are normalized without another tool call", async () => {
  const result = await fetchFeishuDocSnapshot({ url: "https://example.larkoffice.com/docx/guide",
    prefetched: { responsePages: [response], identity: "user" } }, async () => {
      throw new Error("A prefetched document must not call a host tool again");
    });
  expect(result.markdown).toContain("Current procedure.");
  expect(result.revisionId).toBe("7");
  expect(result.fidelity.evidence_status).toBe("complete");
  await expect(fetchFeishuDocSnapshot({ url: "https://example.larkoffice.com/docx/guide",
    prefetched: { responsePages: [JSON.stringify({ data: { document: { content: "<p>Part one</p>" }, has_more: true, next_offset: 1 } })], identity: "user" } }, async () => { throw new Error("Unexpected fetch"); })).rejects.toThrow("incomplete");
});

test("host response import uses the registered Lark snapshot and repeated bytes remain unchanged", async () => {
  const base = await mkdtemp(join(tmpdir(), "context-lark-import-")); roots.push(base);
  const root = await createLarkCaptureProject(base);
  await mkdir(join(root, ".tmp"), { recursive: true });
  await writeFile(join(root, ".tmp/response.json"), response);
  const input = { type: "lark", name: "handbook", access_identity: "user", response_files: [".tmp/response.json"] };
  const first = await importLarkDocument(root, input);
  const second = await importLarkDocument(root, input);
  expect(first).toMatchObject({ kind: "document.capture.lark.result" });
  expect(second).toMatchObject({ kind: "document.capture.lark.result" });
  expect(second.snapshot.changed).toBe(false);
  expect(second.snapshot.snapshot_hash).toBe(first.snapshot.snapshot_hash);
});
