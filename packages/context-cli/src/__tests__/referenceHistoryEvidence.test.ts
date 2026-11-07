import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticleSourceReference } from "@c4a/context";
import { articleReferenceHistoryReader, collectReferenceEvidence } from "../project/articleReferenceObservation.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("document history is digest verified and semantic evidence is deduplicated without local baselines", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-reference-history-")); roots.push(root);
  const path = "sources/note/20260912/guide.md";
  await mkdir(join(root, "sources/note/20260912"), { recursive: true });
  const source = "Introduction\nOriginal guidance\nFinal notes\n";
  await writeFile(join(root, path), source);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false"); git("add", "."); git("commit", "-qm", "Original capture");
  const commit = git("rev-parse", "HEAD");
  const reference = createArticleSourceReference("note:20260912/guide.md", { path: "guide.md", start_line: 2, end_line: 2 }, source);
  await writeFile(join(root, path), "Introduction\nCurrent guidance\nFinal notes\n");
  git("add", "."); git("commit", "-qm", "Changed capture");
  expect(await articleReferenceHistoryReader(root)(reference)).toEqual({ region: "Original guidance", text: source, commit });
  const evidence = await collectReferenceEvidence(root, [reference, reference]);
  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({ history: { status: "available", text: "Original guidance", commit },
    current: { status: "available", text: "Current guidance", start_line: 2, end_line: 2 } });
  const unknown = createArticleSourceReference("note:20260912/guide.md", { path: "guide.md", start_line: 5, end_line: 6 }, "one\ntwo\nthree\nfour\nnever committed\nlast line");
  const missing = (await collectReferenceEvidence(root, [unknown]))[0]!;
  expect(missing.history.status).toBe("unavailable");
  expect(missing.current).toMatchObject({ status: "original-range-unavailable", start_line: 3, end_line: 4, text: "Final notes\n" });
});
