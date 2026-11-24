import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { validateProductionRequirements } from "../project/productionRequirements.js";
import { ORIGINAL_REVISION_PROPOSALS_PATH, originalRevisionReviewHtml } from "../project/originalRevisions.js";
import { reviewNavigationChanges } from "../project/reviewSiteModel.js";
import { invokeCliInDir, makeTmp, runCliInDir } from "./projectCaptureFileV062Helpers.js";

const CODE = "export const limit = 5;\nexport const mode = \"fast\";\n";

async function workspace() {
  const root = makeTmp();
  const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  for (const [name, content] of [["code", CODE], ["wiki", "# Limits\n\nThe limit is 3.\n"]] as const) {
    const dir = join(projectRoot, "..", name);
    await mkdir(dir, { recursive: true });
    writeFileSync(join(dir, "limits.md"), content, "utf8");
    await runCliInDir(projectRoot, ["source", "add", "file", name, "--local", dir, "--configure", "--format", "json"]);
    await runCliInDir(projectRoot, ["run", `capture:file:${name}`, "--format", "json"]);
  }
  return { root, projectRoot };
}

function proposal(id: string) {
  return {
    id, article: "guides/limits.md", section: "limits", reason: "stale", revised: "The limit is 5.",
    original: { source_ref: "file:wiki", locator: { path: "limits.md", start_line: 3, end_line: 3 } },
    evidence: [{ source_ref: "file:code", locator: { path: "limits.md", start_line: 1, end_line: 1 } }],
  };
}

describe("revisions proposed for pages kept as written", () => {
  test("requirements accept preserve_original", () => {
    const parsed = validateProductionRequirements({ requirements: [{ id: "wiki", purpose: "Keep the team wiki",
      preserve_original: true, target_scope: { targets: [{ source_ref: "file:wiki" }] } }] });
    expect(parsed.requirements[0]?.preserve_original).toBe(true);
  });

  test("proposals stay temporary: proposed by the CLI, reminded in status, resolved after the decision", async () => {
    const { root, projectRoot } = await workspace();
    try {
      const file = join(projectRoot, ".tmp", "proposals.yaml");
      await mkdir(join(projectRoot, ".tmp"), { recursive: true });
      writeFileSync(file, YAML.stringify({ revisions: [proposal("limit"), proposal("other")] }), "utf8");
      const proposed = JSON.parse(await runCliInDir(projectRoot, ["review", "original-revisions", "--propose", file, "--format", "json"])) as {
        proposed: number; revisions: Array<{ original: { text: string } }>; next_action?: unknown;
      };
      expect(proposed.proposed).toBe(2);
      expect(proposed.revisions[0]?.original.text).toBe("The limit is 3.");
      expect(proposed.next_action).toBeDefined();
      expect(existsSync(join(projectRoot, "src", "original-revisions.yaml"))).toBe(false);
      expect(existsSync(join(projectRoot, ORIGINAL_REVISION_PROPOSALS_PATH))).toBe(true);

      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json"])) as { original_revisions?: { proposed: number } };
      expect(status.original_revisions?.proposed).toBe(2);

      const one = JSON.parse(await runCliInDir(projectRoot, ["review", "original-revisions", "--resolve", "limit", "--format", "json"])) as { proposed: number };
      expect(one.proposed).toBe(1);
      const none = JSON.parse(await runCliInDir(projectRoot, ["review", "original-revisions", "--resolve", "all", "--format", "json"])) as { proposed: number; next_action?: unknown };
      expect(none).toMatchObject({ proposed: 0 });
      expect(none.next_action).toBeUndefined();
      expect(existsSync(join(projectRoot, ORIGINAL_REVISION_PROPOSALS_PATH))).toBe(false);
      const after = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json"])) as { original_revisions?: unknown };
      expect(after.original_revisions).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("invalid proposals are rejected with a clear reason", async () => {
    const { root, projectRoot } = await workspace();
    try {
      const file = join(projectRoot, "proposals.yaml");
      writeFileSync(file, YAML.stringify({ revisions: [proposal("dup"), proposal("dup")] }), "utf8");
      expect((await invokeCliInDir(projectRoot, ["review", "original-revisions", "--propose", file, "--format", "json"])).stderr).toContain("appears more than once");
      writeFileSync(file, YAML.stringify({ revisions: [{ ...proposal("far"), original: { source_ref: "file:wiki", locator: { path: "limits.md", start_line: 40, end_line: 41 } } }] }), "utf8");
      expect((await invokeCliInDir(projectRoot, ["review", "original-revisions", "--propose", file, "--format", "json"])).stderr).toContain("are outside");
      writeFileSync(file, YAML.stringify({ revisions: [{ ...proposal("gone"), evidence: [{ source_ref: "file:missing", locator: { path: "x.md", start_line: 1, end_line: 1 } }] }] }), "utf8");
      expect((await invokeCliInDir(projectRoot, ["review", "original-revisions", "--propose", file, "--format", "json"])).stderr).toContain("Cannot read");
      expect((await invokeCliInDir(projectRoot, ["review", "original-revisions", "--resolve", "nope", "--format", "json"])).stderr).toContain("Unknown original revision id");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the review block escapes text and shows original, revision and evidence", () => {
    const html = originalRevisionReviewHtml([{ ...proposal("x"),
      original: { source_ref: "file:wiki", locator: { path: "limits.md", start_line: 3, end_line: 3 }, text: "<b>3</b>" } } as never]);
    expect(html).toContain("&#60;b&#62;3&#60;/b&#62;");
    expect(html).toContain("The limit is 5.");
    expect(html).toContain("file:code limits.md L1-L1");
  });

  test("review navigation changes report hiding and showing entries", () => {
    const before = [{ key: "pkg", title: "Package only", parent: null }];
    const after = [{ key: "pkg", title: "Package only", parent: null, hidden: true }];
    expect(reviewNavigationChanges(before, after, [])).toEqual([{ key: "pkg", title: "Package only", changes: ["hidden"] }]);
    expect(reviewNavigationChanges(after, before, [])).toEqual([{ key: "pkg", title: "Package only", changes: ["shown"] }]);
  });
});
