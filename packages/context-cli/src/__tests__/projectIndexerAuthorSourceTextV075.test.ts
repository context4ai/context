import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndexerAuthorDependencyView } from "@c4a/context";
import { readIndexerAuthorSourceText } from "../project/indexerAuthorSourceText.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const fake = `sha256:${"a".repeat(64)}`;
async function fixture(text: string, ranges: [number, number][]) {
  const root = await mkdtemp(join(tmpdir(), "context-author-source-text-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/main.ts"), text);
  const view = buildIndexerAuthorDependencyView({
    source_ref: "repo:sample", module_ref: null, logical_unit_ref: "node:sample",
    positive_nodes: [...ranges.map(([start, end], i) => ({
      kind: "source-span" as const, evidence_ref: `evidence:range-${i}`,
      source_ref: "repo:sample", module_ref: null,
      locator: { path: "src/main.ts", start_line: start, end_line: end },
      content_digest: digest(text), targets: [],
    })), { kind: "logical-unit", logical_unit_ref: "node:sample", group_projection_digest: fake,
      targets: [{ level: "logical-unit" }] }],
    negative_nodes: [{ kind: "group-input-set", scope_ref: "node:sample", set_digest: fake,
      targets: [{ level: "logical-unit" }] }],
  });
  const spans = view.positive_nodes.filter((node) => node.kind === "source-span");
  return { source_root: root, path: "src/main.ts", content_digest: digest(text), spans, max_bytes: 1024 * 1024 };
}

describe("authorized Author source text", () => {
  test("merges overlaps and adjacency, preserving disjoint scopes and Unicode bytes", async () => {
    const input = await fixture("outside\r\nexport const label = '中文';\r\nline3\r\nline4\r\nprivate\r\nlast", [[2, 3], [3, 3], [4, 4], [6, 6]]);
    const read = await readIndexerAuthorSourceText(input);
    expect(read.spans).toHaveLength(2);
    expect(read.spans[0]).toMatchObject({ start_line: 2, end_line: 4, text: "export const label = '中文';\r\nline3\r\nline4\r\n" });
    expect(read.spans[0]!.source_span_refs).toHaveLength(3);
    expect(read.spans[1]!.text).toBe("last");
    expect(read.bytes).toBe(Buffer.byteLength(read.spans.map((span) => span.text).join("")));
    expect(JSON.stringify(read)).not.toContain("private");
    expect(await readIndexerAuthorSourceText({ ...input, spans: [...input.spans].reverse() })).toEqual(read);
  });

  test("rejects changed files and mismatched span identities", async () => {
    const input = await fixture("export const count = 1;\n", [[1, 1]]);
    await writeFile(join(input.source_root, input.path), "export const count = 2;\n");
    await expect(readIndexerAuthorSourceText(input)).rejects.toThrow("changed since Parser");
    await expect(readIndexerAuthorSourceText({ ...input, content_digest: fake })).rejects.toThrow("file identity");
  });

  test("does not truncate oversized material or silently clamp invalid ranges", async () => {
    const input = await fixture("export const count = 1;\n", [[1, 4]]);
    await expect(readIndexerAuthorSourceText(input)).rejects.toThrow("outside its pinned file");
    const valid = await fixture("export const count = 1;\n", [[1, 1]]);
    await expect(readIndexerAuthorSourceText({ ...valid, max_bytes: 5 })).rejects.toThrow("batch input budget");
  });

  test("rejects escaping paths and symlinked source files", async () => {
    const input = await fixture("export const count = 1;\n", [[1, 1]]);
    const outside = await fixture("export const hidden = 1;\n", [[1, 1]]);
    await rm(join(input.source_root, input.path));
    await symlink(join(outside.source_root, outside.path), join(input.source_root, input.path));
    await expect(readIndexerAuthorSourceText(input)).rejects.toThrow("escapes");
    await expect(readIndexerAuthorSourceText({ ...input, path: "../main.ts", spans: input.spans.map((span) => ({
      ...span, locator: { ...span.locator, path: "../main.ts" },
    })) })).rejects.toThrow("escapes");
  });

  test("keeps streaming boundaries intact and rejects binary material", async () => {
    const text = `ignored\n${"a".repeat(65520)}中文😀end\nignored\n`;
    const input = await fixture(text, [[2, 2]]);
    expect((await readIndexerAuthorSourceText(input)).spans[0]!.text).toBe(text.split("\n")[1]! + "\n");
    const binary = await fixture("prefix\0suffix", [[1, 1]]);
    await expect(readIndexerAuthorSourceText(binary)).rejects.toThrow("not UTF-8 text");
  });
});
