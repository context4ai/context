import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticleSourceReference, type ArticleStructureEntry } from "@c4a/context";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { inspectSettledReferences } from "../project/settledReferenceRelocation.js";
import { approvedKnowledgeDependencyWarnings } from "../project/approvedKnowledgeDependencyWarnings.js";
import { collectProjectStatus } from "../project/status.js";
import * as verification from "../project/verify.js";
import { completeApprovedRevisionSubmission } from "../project/approvedRevisionSubmission.js";
import { inspectTaskRecovery, recoverTaskTransactions } from "../project/taskRecovery.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test("advisory reads retain unavailable sources while selected updates still block", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 }); roots.push(root);
  const reference = createArticleSourceReference(DOCUMENT_REVISION_SOURCE_REF, { path: "src/index.ts", start_line: 1, end_line: 1 }, "export const answer = 42;\n");
  const articles: ArticleStructureEntry[] = [{ article_id: "article:test", path: "architecture/test.md", collection: "architecture", visibility: "public", sections: [{ id: "entry", references: [reference] }] }];
  // A genuine missing path remains distinct from a missing checkout.
  const changed = structuredClone(articles[0]!); changed.path = "architecture/other.md"; changed.article_id = "article:other";
  changed.sections[0]!.references[0]!.locator.path = "src/absent.ts";
  const before = await approvedKnowledgeDependencyWarnings(root, { articles: [changed] });
  expect(before.some(issue => issue.code === "approved-source-region-changed")).toBe(true);
  await rm(join(root, "fixture-source"), { recursive: true, force: true });
  const observed = await inspectSettledReferences(root, articles, [DOCUMENT_REVISION_SOURCE_REF], [], { advisory: true });
  expect(observed.observations[0]).toMatchObject({ state: "unavailable", reason: expect.stringContaining("context source recovery-plan") });
  expect(observed.articles).toEqual(articles);
  await expect(inspectSettledReferences(root, articles, [DOCUMENT_REVISION_SOURCE_REF])).rejects.toMatchObject({ detail: { reason_code: "source-read-failed" } });
  const missing = structuredClone(changed); missing.article_id = "article:missing"; missing.path = "architecture/missing.md";
  missing.sections[0]!.references[0]!.source_ref = "note:unregistered";
  const warnings = await approvedKnowledgeDependencyWarnings(root, { articles: [...articles, changed, missing] });
  expect(warnings.some(issue => issue.code === "approved-source-region-changed")).toBe(true);
  // One warning per unreadable source, naming the pages it leaves unchecked.
  const unreadable = warnings.filter(issue => issue.code === "source-read-failed");
  expect(unreadable).toHaveLength(1);
  expect(unreadable[0]!.message).toContain("2 citation(s) in 2 page(s) were not checked (architecture/test.md, architecture/other.md)");
  expect(unreadable[0]!.message).toStartWith(`The registered source checkout of ${DOCUMENT_REVISION_SOURCE_REF} is not accessible.`);
});
test("unexpected verification failure is not reported as passing evidence", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 }); roots.push(root);
  const failure = spyOn(verification, "verifyProjectWorkspace").mockRejectedValue(new Error("verification interrupted"));
  try {
    const status = await collectProjectStatus(root);
    expect(status.evidenceStatus).toBe("not-checked");
    expect(JSON.stringify(status)).toContain("verification interrupted");
  } finally { failure.mockRestore(); }
});
test("early batch failures and transaction recovery retain managed continuation", async () => {
  await expect(completeApprovedRevisionSubmission({ projectRoot: ".", revision: "unused", value: {}, preview: true, managed: true }))
    .rejects.toMatchObject({ detail: { next_action: { command: "context status --managed --format json" } } });
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 }); roots.push(root);
  const preview = await recoverTaskTransactions({ projectRoot: root, managed: true });
  expect(preview.next).toContain("--managed");
  const done = await recoverTaskTransactions({ projectRoot: root, managed: true, apply: true, plan_digest: preview.revision! });
  expect(done.next).toBe("context status --managed --format json");
  const inspection = await inspectTaskRecovery(root, true);
  expect(inspection.actions.every(action => action.command.includes("--managed"))).toBe(true);
});

test("verify lists every failing citation of a page in its one warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "verify-citations-")); roots.push(root);
  await mkdir(join(root, "sources/note/20260912"), { recursive: true });
  const ref = (file: string, line: number, text: string) => createArticleSourceReference(`note:20260912/${file}`, { path: file, start_line: line, end_line: line }, text);
  const a = ref("a.md", 1, "Alpha\n"), b = ref("b.md", 1, "Beta\n"), c = ref("c.md", 1, "Gamma\n");
  await writeFile(join(root, "sources/note/20260912/a.md"), "Alpha changed\n");
  await writeFile(join(root, "sources/note/20260912/b.md"), "Beta changed\n");
  await writeFile(join(root, "sources/note/20260912/c.md"), "Intro\nGamma\n");
  const articles: ArticleStructureEntry[] = [{ article_id: "article:page", path: "architecture/page.md", collection: "architecture", visibility: "public",
    sections: [{ id: "goal", references: [a, b, c] }] }];
  const warnings = await approvedKnowledgeDependencyWarnings(root, { articles });
  const changed = warnings.filter(issue => issue.code === "approved-source-region-changed");
  expect(changed).toHaveLength(1);
  expect(changed[0]!.reference_states).toHaveLength(2);
  expect(changed[0]!.message).toContain("goal: note:20260912/a.md/a.md L1–L1 (not-found");
  expect(changed[0]!.message).toContain("goal: note:20260912/b.md/b.md L1–L1 (not-found");
  expect(warnings.filter(issue => issue.code === "approved-source-region-moved")[0]!.message).toContain("c.md L2–L2");
});
