import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { articleSourceRegionDigest } from "@c4a/context";
import { initContextProject } from "../project/workspace.js";
import { validateProductionRequirements } from "../project/productionRequirements.js";
import { originalRevisionReviewHtml } from "../project/originalRevisions.js";
import { invokeCliInDir, makeTmp, runCliInDir } from "./projectCaptureFileV062Helpers.js";

const CODE = "export const limit = 5;\nexport const mode = \"fast\";\n";

async function workspaceWithCode() {
  const root = makeTmp();
  const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  const code = join(projectRoot, "..", "code");
  await mkdir(code, { recursive: true });
  writeFileSync(join(code, "limits.md"), CODE, "utf8");
  await runCliInDir(projectRoot, ["source", "add", "file", "code", "--local", code, "--configure", "--format", "json"]);
  await runCliInDir(projectRoot, ["run", "capture:file:code", "--format", "json"]);
  return { root, projectRoot, code };
}

function revision(id: string, status: string, digest: string) {
  return {
    id, article: "guides/limits.md", section: "limits",
    original: { source_ref: "file:wiki", locator: { path: "limits.md", start_line: 3, end_line: 3 }, text: "The limit is 3." },
    revised: "The limit is 5.", reason: "stale",
    evidence: [{ source_ref: "file:code", locator: { path: "limits.md", start_line: 1, end_line: 1 }, content_digest: digest }],
    status,
  };
}

describe("revisions to pages kept as written", () => {
  test("requirements accept preserve_original", () => {
    const parsed = validateProductionRequirements({ requirements: [{ id: "wiki", purpose: "Keep the team wiki",
      preserve_original: true, target_scope: { targets: [{ source_ref: "file:wiki" }] } }] });
    expect(parsed.requirements[0]?.preserve_original).toBe(true);
  });

  test("proposals are listed, decided, and kept originals reopen only when their code changes", async () => {
    const { root, projectRoot, code } = await workspaceWithCode();
    try {
      const digest = articleSourceRegionDigest(CODE, { path: "limits.md", start_line: 1, end_line: 1 });
      writeFileSync(join(projectRoot, "src", "original-revisions.yaml"), YAML.stringify({ revisions: [
        revision("limit-proposed", "proposed", digest),
        revision("limit-kept", "kept", digest),
      ] }), "utf8");

      const first = JSON.parse(await runCliInDir(projectRoot, ["review", "original-revisions", "--format", "json"])) as Record<string, unknown>;
      expect(first).toMatchObject({ proposed: 1, kept: 1, reopened: 0 });
      expect(first.next_action).toBeDefined();

      const decided = JSON.parse(await runCliInDir(projectRoot, [
        "review", "original-revisions", "--decide", "limit-proposed=upstream", "--upstream", "limit-proposed=suggested to the wiki owner", "--format", "json",
      ])) as { proposed: number; upstream: number; next_action?: unknown };
      expect(decided).toMatchObject({ proposed: 0, upstream: 1 });
      expect(decided.next_action).toBeUndefined();
      const stored = YAML.parse(readFileSync(join(projectRoot, "src", "original-revisions.yaml"), "utf8")) as { revisions: Array<Record<string, unknown>> };
      expect(stored.revisions[0]).toMatchObject({ status: "upstream", upstream: "suggested to the wiki owner" });

      writeFileSync(join(code, "limits.md"), CODE.replace("5", "8"), "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:code", "--format", "json"]);
      const reopened = JSON.parse(await runCliInDir(projectRoot, ["review", "original-revisions", "--format", "json"])) as {
        reopened: number; revisions: Array<{ id: string; reopened?: boolean }>; next_action?: unknown;
      };
      expect(reopened.reopened).toBe(1);
      expect(reopened.revisions.find((item) => item.id === "limit-kept")?.reopened).toBe(true);
      expect(reopened.next_action).toBeDefined();

      // Deciding "kept" again settles it against the current code.
      const settled = JSON.parse(await runCliInDir(projectRoot, ["review", "original-revisions", "--decide", "limit-kept=kept", "--format", "json"])) as { reopened: number };
      expect(settled.reopened).toBe(0);
      const local = JSON.parse(await runCliInDir(projectRoot, ["review", "original-revisions", "--decide", "limit-proposed=local", "--format", "json"])) as {
        revisions: Array<{ id: string; upstream?: string }>;
      };
      expect(local.revisions.find((item) => item.id === "limit-proposed")?.upstream).toBeUndefined();

      const bad = await invokeCliInDir(projectRoot, ["review", "original-revisions", "--decide", "missing=local", "--format", "json"]);
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain("Unknown original revision id");
      const wrong = await invokeCliInDir(projectRoot, ["review", "original-revisions", "--decide", "limit-kept=maybe", "--format", "json"]);
      expect(wrong.stderr).toContain("must be one of upstream, local, kept");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the review block escapes text and shows original, revision and evidence", () => {
    const html = originalRevisionReviewHtml([{ ...revision("x", "proposed", `sha256:${"a".repeat(64)}`),
      original: { source_ref: "file:wiki", locator: { path: "limits.md", start_line: 3, end_line: 3 }, text: "<b>3</b>" } } as never]);
    expect(html).toContain("&#60;b&#62;3&#60;/b&#62;");
    expect(html).toContain("The limit is 5.");
    expect(html).toContain("file:code limits.md L1-L1");
  });
});
