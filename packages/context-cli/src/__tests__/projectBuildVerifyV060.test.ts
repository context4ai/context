import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createApprovedProject,
  fileHash,
  invokeCliInDir,
  runCliInDir,
} from "./projectBuildVerifyV060Helpers.js";
import {
  configureKbNavigation,
  hydratedApprovedSource,
  writeApprovedFeature,
  writeApprovedGuide,
  writeApprovedRule,
} from "./projectBuildKnowledgeFixturesV060.js";

describe("0.6.0 project build, verify, and status", () => {
  test("complete summary closes progress and reports the completed scope", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedGuide(fixture.project, fixture.approvedId);
      await runCliInDir(fixture.project, ["close", "--format", "json"]);
      await runCliInDir(fixture.project, ["build", "--format", "json"]);
      const summary = JSON.parse(await runCliInDir(fixture.project, [
        "status",
        "--managed",
        "--format",
        "json",
      ])) as {
        workflow: { status: string; current: { node: string } };
        currentTarget?: unknown;
        counts: { approvedPages: number; packageCount: number };
        progress: { structureBatch: { state: string } };
      };
      expect(summary.workflow).toMatchObject({
        status: "actionable",
        current: { node: "run-indexer-lifecycle" },
      });
      expect(summary.progress.structureBatch.state).toBe("empty");
      expect(summary.counts).toMatchObject({ approvedPages: 2, packageCount: 2 });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("reports deterministic projection refresh as lifecycle work instead of verification failure", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedGuide(fixture.project, fixture.approvedId);
      const status = JSON.parse(await runCliInDir(fixture.project, [
        "status",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        state: string;
        verifyErrors: number;
        projectionRefreshIssues: number;
        workflow: {
          diagnostics: Array<{ code: string; severity: string; count?: number }>;
        };
      };
      expect(status.state).toBe("route.indexer.lifecycle-required");
      expect(status.verifyErrors).toBe(0);
      expect(status.projectionRefreshIssues).toBeGreaterThan(0);
      expect(status.workflow.diagnostics).toContainEqual(expect.objectContaining({
        code: "diagnostic.projection-stale",
        severity: "info",
        count: status.projectionRefreshIssues,
      }));
      expect(status.workflow.diagnostics).not.toContainEqual(expect.objectContaining({
        code: "diagnostic.verify-failed",
      }));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build receipt reports created, incremental, removed, and unchanged output files", async () => {
    const fixture = await createApprovedProject();
    try {
      const first = JSON.parse(await runCliInDir(fixture.project, ["build", "--format", "json", "--verbose"])) as {
        packages: Array<{
          name: string;
          state: string;
          changes: Record<"added" | "updated" | "removed", Array<{ path: string; kind: string; group?: string }>>;
        }>;
      };
      const createdKb = first.packages.find((pkg) => pkg.name === "sample-kb");
      expect(createdKb?.state).toBe("created");
      expect(createdKb?.changes.added).toContainEqual(expect.objectContaining({
        path: `wikis/${fixture.approvedId}.md`,
        kind: "knowledge-page",
        group: "wikis/codeindex",
      }));
      expect(createdKb?.changes.added.some((file) => file.kind === "index")).toBe(true);
      expect(createdKb?.changes.updated).toEqual([]);
      expect(createdKb?.changes.removed).toEqual([]);

      const kbTemplate = join(fixture.project, "src", "package-templates", "kb");
      writeFileSync(join(kbTemplate, "AGENTS.md"), "# {{packageName}}\n\nreceipt fixture changed\n", "utf8");
      writeFileSync(join(kbTemplate, "NEW.md"), "# New package file\n", "utf8");
      rmSync(join(kbTemplate, "meta", "{{packageName}}.txt"));

      const second = JSON.parse(await runCliInDir(fixture.project, ["build", "--format", "json", "--verbose"])) as typeof first;
      const updatedKb = second.packages.find((pkg) => pkg.name === "sample-kb");
      expect(updatedKb?.state).toBe("updated");
      expect(updatedKb?.changes.added).toContainEqual({ path: "NEW.md", kind: "file" });
      expect(updatedKb?.changes.updated).toContainEqual({ path: "AGENTS.md", kind: "file" });
      expect(updatedKb?.changes.removed).toContainEqual({ path: "meta/sample-kb.txt", kind: "file" });

      const third = JSON.parse(await runCliInDir(fixture.project, ["build", "--format", "json", "--verbose"])) as typeof first;
      const unchangedKb = third.packages.find((pkg) => pkg.name === "sample-kb");
      expect(unchangedKb?.state).toBe("unchanged");
      expect(unchangedKb?.changes).toEqual({ added: [], updated: [], removed: [] });

      const text = await runCliInDir(fixture.project, ["build"]);
      expect(text).toContain("sample-kb (kb, unchanged)");
      expect(text).toContain("changes: none");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build folds small knowledge directories into the OKF root index", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedGuide(fixture.project, fixture.approvedId);
      await runCliInDir(fixture.project, ["close", "--format", "json"]);

      await runCliInDir(fixture.project, ["build"]);

      const guidesIndex = readFileSync(join(fixture.project, "dist", "sample-kb", "guides", "index.md"), "utf8");
      const inventory = JSON.parse(readFileSync(join(fixture.project, "dist", "sample-kb", "context-build-inventory.json"), "utf8")) as {
        approved_knowledge: {
          files: Array<{ path: string; collection: string; path_within_collection: string }>;
          groups: Array<{ name: string; collection: string; internal_collection: string; okf_root: string; has_index: boolean; index_path: string | null }>;
        };
      };

      expect(guidesIndex).toContain("type: Knowledge Directory");
      expect(guidesIndex).toContain("Approved knowledge pages under guides.");
      expect(guidesIndex).toContain("### Sop / Domain");
      expect(guidesIndex).toContain("[Getting Started Guide](./sop/domain/getting-started.md) - Guide");
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "guides", "sop", "index.md"))).toBe(false);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "guides", "sop", "domain", "index.md"))).toBe(false);
      expect(inventory.approved_knowledge.files).toContainEqual(expect.objectContaining({
        path: "guides/sop/domain/getting-started.md",
        collection: "sop",
        internal_collection: "sop",
        okf_root: "guides",
        approved_path: "sop/domain/getting-started.md",
        dist_path: "guides/sop/domain/getting-started.md",
        path_within_collection: "sop/domain/getting-started.md",
        node_ref: "domain/getting-started",
        view_ref: "sop:domain/getting-started",
      }));
      expect(inventory.approved_knowledge.groups).toContainEqual(expect.objectContaining({
        name: "sop",
        collection: "sop",
        internal_collection: "sop",
        okf_root: "guides",
        has_index: false,
        index_path: null,
      }));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build keeps large leaf indexes while folding thin ancestor indexes", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedGuide(fixture.project, fixture.approvedId, "domain/a/first.md");
      await writeApprovedGuide(fixture.project, fixture.approvedId, "domain/a/second.md");
      await writeApprovedGuide(fixture.project, fixture.approvedId, "domain/a/third.md");
      await writeApprovedGuide(fixture.project, fixture.approvedId, "domain/b/first.md");
      await writeApprovedGuide(fixture.project, fixture.approvedId, "domain/b/second.md");
      await writeApprovedGuide(fixture.project, fixture.approvedId, "domain/b/third.md");
      configureKbNavigation(fixture.project, {
        foldDirectoryIndexes: true,
        maxInlineEntries: 2,
      });
      await runCliInDir(fixture.project, ["close", "--format", "json"]);

      await runCliInDir(fixture.project, ["build"]);

      const guidesIndex = readFileSync(join(fixture.project, "dist", "sample-kb", "guides", "index.md"), "utf8");
      const firstDomainIndex = readFileSync(join(fixture.project, "dist", "sample-kb", "guides", "sop", "domain", "a", "index.md"), "utf8");
      const secondDomainIndex = readFileSync(join(fixture.project, "dist", "sample-kb", "guides", "sop", "domain", "b", "index.md"), "utf8");
      expect(guidesIndex).toContain("[A](./sop/domain/a/index.md) - 3 item(s)");
      expect(guidesIndex).toContain("[B](./sop/domain/b/index.md) - 3 item(s)");
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "guides", "sop", "index.md"))).toBe(false);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "guides", "sop", "domain", "index.md"))).toBe(false);
      expect(firstDomainIndex).toContain("[Getting Started Guide](./first.md) - Guide");
      expect(firstDomainIndex).toContain("[Getting Started Guide](./second.md) - Guide");
      expect(firstDomainIndex).toContain("[Getting Started Guide](./third.md) - Guide");
      expect(secondDomainIndex).toContain("[Getting Started Guide](./first.md) - Guide");
      expect(secondDomainIndex).toContain("[Getting Started Guide](./second.md) - Guide");
      expect(secondDomainIndex).toContain("[Getting Started Guide](./third.md) - Guide");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("package select filters by internal collection, OKF root, then path globs", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedGuide(fixture.project, fixture.approvedId);
      await writeApprovedRule(fixture.project, fixture.approvedId);
      await runCliInDir(fixture.project, ["close", "--format", "json"]);
      const entryPath = join(fixture.project, "src", "index.ts");
      const entry = readFileSync(entryPath, "utf8");
      writeFileSync(entryPath, entry.replace(
        'template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
        'template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },\n      select: { collections: ["sop", "standards"], okfRoots: ["guides"], include: ["sop/**", "standards/**"] },',
      ), "utf8");

      await runCliInDir(fixture.project, ["build"]);

      expect(existsSync(join(fixture.project, "dist", "sample-kb", "guides", "sop", "domain", "getting-started.md"))).toBe(true);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "rules", "standards", "domain", "security.md"))).toBe(false);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "wikis", `${fixture.approvedId}.md`))).toBe(false);
      const inventory = JSON.parse(readFileSync(join(fixture.project, "dist", "sample-kb", "context-build-inventory.json"), "utf8")) as {
        package: { select: { collections: string[]; okfRoots: string[]; include: string[] } };
        approved_knowledge: {
          count: number;
          files: Array<{ internal_collection: string; okf_root: string; approved_path: string; dist_path: string; selected_by: Array<{ kind: string; value: string }> }>;
          groups: Array<{ selected_by: Array<{ kind: string; value: string }> }>;
        };
      };
      expect(inventory.package.select).toMatchObject({
        collections: ["sop", "standards"],
        okfRoots: ["guides"],
        include: ["sop/**", "standards/**"],
      });
      expect(inventory.approved_knowledge.count).toBe(1);
      expect(inventory.approved_knowledge.files).toEqual([expect.objectContaining({
        internal_collection: "sop",
        okf_root: "guides",
        approved_path: "sop/domain/getting-started.md",
        dist_path: "guides/sop/domain/getting-started.md",
        selected_by: [
          { kind: "collection", value: "sop" },
          { kind: "okf_root", value: "guides" },
          { kind: "include", value: "sop/**" },
        ],
      })]);
      expect(inventory.approved_knowledge.groups[0]?.selected_by).toEqual([
        { kind: "collection", value: "sop" },
        { kind: "okf_root", value: "guides" },
        { kind: "include", value: "sop/**" },
      ]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("package select includes the feats production namespace", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedFeature(fixture.project, fixture.approvedId);
      await runCliInDir(fixture.project, ["close", "--format", "json"]);
      const entryPath = join(fixture.project, "src", "index.ts");
      const entry = readFileSync(entryPath, "utf8");
      writeFileSync(entryPath, entry.replace(
        'template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
        'template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },\n      select: { collections: ["feats"] },',
      ), "utf8");

      await runCliInDir(fixture.project, ["build"]);

      expect(existsSync(join(fixture.project, "dist", "sample-kb", "feats", "feature", "experiments.md"))).toBe(true);
      expect(existsSync(join(fixture.project, "dist", "sample-kb", "wikis", `${fixture.approvedId}.md`))).toBe(false);
      const inventory = JSON.parse(readFileSync(join(fixture.project, "dist", "sample-kb", "context-build-inventory.json"), "utf8")) as {
        approved_knowledge: { count: number; files: Array<{ internal_collection: string; okf_root: string; dist_path: string }> };
      };
      expect(inventory.approved_knowledge.count).toBe(1);
      expect(inventory.approved_knowledge.files).toEqual([expect.objectContaining({
        internal_collection: "feats",
        okf_root: "feats",
        dist_path: "feats/feature/experiments.md",
      })]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects hollow kb templates without SKILL.md", async () => {
    const fixture = await createApprovedProject();
    try {
      rmSync(join(fixture.project, "src", "package-templates", "kb", "skills"), { recursive: true, force: true });
      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("kb package template is incomplete");
      expect(build.stderr).toContain("Add at least one SKILL.md");

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("kb package template is incomplete");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects kb templates without an OKF index page", async () => {
    const fixture = await createApprovedProject();
    try {
      rmSync(join(fixture.project, "src", "package-templates", "kb", "wikis", "index.md"), { force: true });
      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("kb package template is incomplete");
      expect(build.stderr).toContain("wikis/index.md");

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("wikis/index.md");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects package template paths that collide with copied knowledge", async () => {
    const fixture = await createApprovedProject();
    try {
      const collisionPath = join(fixture.project, "src", "package-templates", "kb", "wikis", `${fixture.approvedId}.md`);
      mkdirSync(dirname(collisionPath), { recursive: true });
      writeFileSync(collisionPath, "template collision\n", "utf8");

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package template path collides with copied knowledge");
      expect(build.stderr).toContain(`wikis/${fixture.approvedId}.md`);

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("package template path collides with copied knowledge");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects package template paths that collide with generated OKF directory indexes", async () => {
    const fixture = await createApprovedProject();
    try {
      configureKbNavigation(fixture.project, {
        foldDirectoryIndexes: false,
        maxInlineEntries: 50,
      });
      const collisionPath = join(fixture.project, "src", "package-templates", "kb", "wikis", "codeindex", "index.md");
      mkdirSync(dirname(collisionPath), { recursive: true });
      writeFileSync(collisionPath, "# Custom Source Index\n", "utf8");

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package template path collides with generated OKF directory index");
      expect(build.stderr).toContain("wikis/codeindex/index.md");

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("package template path collides with generated OKF directory index");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects package template paths that collide with generated non-wikis directory indexes", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedGuide(fixture.project, fixture.approvedId);
      configureKbNavigation(fixture.project, {
        foldDirectoryIndexes: false,
        maxInlineEntries: 50,
      });
      await runCliInDir(fixture.project, ["close", "--format", "json"]);
      const collisionPath = join(fixture.project, "src", "package-templates", "kb", "guides", "sop", "domain", "index.md");
      mkdirSync(dirname(collisionPath), { recursive: true });
      writeFileSync(collisionPath, "# Custom Guide Index\n", "utf8");

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package template path collides with generated OKF directory index");
      expect(build.stderr).toContain("guides/sop/domain/index.md");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects approved concept pages that occupy OKF directory index paths", async () => {
    const fixture = await createApprovedProject();
    try {
      const approved = await hydratedApprovedSource(fixture.project, fixture.approvedId);
      const reservedPath = join(fixture.project, "knowledge", "codeindex", "index.md");
      mkdirSync(dirname(reservedPath), { recursive: true });
      writeFileSync(reservedPath, approved
        .replace("title: Button", "title: Sample A Index")
        .replace(/^node_ref: .+$/mu, "node_ref: index")
        .replace(/^view_ref: .+$/mu, "view_ref: codeindex:index"), "utf8");
      await runCliInDir(fixture.project, ["close", "--format", "json"]);

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("approved knowledge path uses reserved OKF index path");
      expect(build.stderr).toContain("wikis/codeindex/index.md");

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("approved knowledge path uses reserved OKF index path");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects non-wikis approved concept pages that occupy OKF directory index paths", async () => {
    const fixture = await createApprovedProject();
    try {
      await writeApprovedGuide(fixture.project, fixture.approvedId, "domain/index.md");
      await runCliInDir(fixture.project, ["close", "--format", "json"]);
      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("approved knowledge path uses reserved OKF index path");
      expect(build.stderr).toContain("guides/sop/domain/index.md");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build and status reject broken kb index links", async () => {
    const fixture = await createApprovedProject();
    try {
      const indexTemplate = join(fixture.project, "src", "package-templates", "kb", "wikis", "index.md");
      writeFileSync(indexTemplate, `${readFileSync(indexTemplate, "utf8")}\n- [Broken](./missing.md)\n`, "utf8");

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package index link invalid");
      expect(build.stderr).toContain("package/index-link-invalid");
      expect(build.stderr).toContain("Fix the package template");

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("package index link invalid");
      expect(status).toContain("Fix the package template");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build validates feats index links as an OKF output root", async () => {
    const fixture = await createApprovedProject();
    try {
      const featsIndex = join(fixture.project, "src", "package-templates", "kb", "feats", "index.md");
      mkdirSync(dirname(featsIndex), { recursive: true });
      writeFileSync(featsIndex, "# Feature Index\n\n- [Broken](./missing.md)\n", "utf8");

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package index link invalid");
      expect(build.stderr).toContain("feats/index.md");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build accepts OKF bundle-root absolute links in kb indexes", async () => {
    const fixture = await createApprovedProject();
    try {
      const indexTemplate = join(fixture.project, "src", "package-templates", "kb", "wikis", "index.md");
      writeFileSync(indexTemplate, `${readFileSync(indexTemplate, "utf8")}\n- [Absolute](/wikis/${fixture.approvedId}.md)\n`, "utf8");

      await runCliInDir(fixture.project, ["build"]);
      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("package sample-kb: ready");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects kb index links that escape the package root", async () => {
    const fixture = await createApprovedProject();
    try {
      const indexTemplate = join(fixture.project, "src", "package-templates", "kb", "wikis", "index.md");
      writeFileSync(indexTemplate, `${readFileSync(indexTemplate, "utf8")}\n- [Escape](/wikis/../../../package.json)\n`, "utf8");

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package index link invalid");
      expect(build.stderr).toContain("package/index-link-invalid");
      expect(build.stderr).toContain("/wikis/../../../package.json");

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("package index link invalid");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build renders handlebars loops and strips template comments", async () => {
    const fixture = await createApprovedProject();
    try {
      writeFileSync(join(fixture.project, "src", "package-templates", "kb", "meta", "inventory.md"), [
        "<!-- context:template this line must not ship -->",
        "{{#each knowledgeGroups}}",
        "## {{title}} group={{collection}} root={{okf_root}}",
        "{{#each items}}",
        "{{inc @index}}. [{{title}}]({{href}}) collection={{collection}} root={{okf_root}} {{#if description}}- {{description}}{{/if}}",
        "{{/each}}",
        "{{/each}}",
        "",
      ].join("\n"), "utf8");

      await runCliInDir(fixture.project, ["build"]);
      const inventory = readFileSync(join(fixture.project, "dist", "sample-kb", "meta", "inventory.md"), "utf8");
      expect(inventory).not.toContain("context:template");
      expect(inventory).toContain("## codeindex group=codeindex root=wikis");
      expect(inventory).toContain(`1. [Button](../wikis/${fixture.approvedId}.md) collection=codeindex root=wikis`);
      expect(inventory).toContain("Exported function symbol from src/Button.ts");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build rejects ungrounded package template boundary claims", async () => {
    const fixture = await createApprovedProject();
    try {
      writeFileSync(
        join(fixture.project, "src", "package-templates", "kb", "meta", "coverage.md"),
        "Known gaps: none.\n",
        "utf8",
      );

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package template boundary claim is not grounded");
      expect(build.stderr).toContain("package/template-boundary-ungrounded");

      writeFileSync(
        join(fixture.project, "src", "package-templates", "kb", "meta", "coverage.md"),
        "Known gaps: none. Approved files: {{knowledgeCount}}.\n",
        "utf8",
      );
      const countOnly = await invokeCliInDir(fixture.project, ["build"]);
      expect(countOnly.status).not.toBe(0);
      expect(countOnly.stderr).toContain("package template boundary claim is not grounded");

      writeFileSync(
        join(fixture.project, "src", "package-templates", "kb", "meta", "coverage.md"),
        "Known gaps are derived from knowledge/structure.yaml.\n",
        "utf8",
      );
      const workspaceStructurePathOnly = await invokeCliInDir(fixture.project, ["build"]);
      expect(workspaceStructurePathOnly.status).not.toBe(0);
      expect(workspaceStructurePathOnly.stderr).toContain("package template boundary claim is not grounded");

      writeFileSync(
        join(fixture.project, "src", "package-templates", "kb", "meta", "coverage.md"),
        "Known gaps are derived from {{knowledgeStructurePath}}.\n",
        "utf8",
      );
      const structurePathVariableOnly = await invokeCliInDir(fixture.project, ["build"]);
      expect(structurePathVariableOnly.status).not.toBe(0);
      expect(structurePathVariableOnly.stderr).toContain("package template boundary claim is not grounded");

      writeFileSync(
        join(fixture.project, "src", "package-templates", "kb", "meta", "coverage.md"),
        "Known gaps are derived from {{buildInventoryPath}} and approved wiki files: {{knowledgeCount}}.\n",
        "utf8",
      );
      await runCliInDir(fixture.project, ["build"]);
      const rendered = readFileSync(join(fixture.project, "dist", "sample-kb", "meta", "coverage.md"), "utf8");
      expect(rendered).toContain("context-build-inventory.json");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("package template boundary claims avoid broad word false positives", async () => {
    const fixture = await createApprovedProject();
    try {
      writeFileSync(
        join(fixture.project, "src", "package-templates", "kb", "meta", "usage.md"),
        [
          "This skill covers how to query the package.",
          "The search scope is selected by the user.",
          "If a result is missing, retry after a rate limit window.",
          "",
        ].join("\n"),
        "utf8",
      );

      await runCliInDir(fixture.project, ["build"]);
      const rendered = readFileSync(join(fixture.project, "dist", "sample-kb", "meta", "usage.md"), "utf8");
      expect(rendered).toContain("This skill covers how to query");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("llms package templates also reject ungrounded boundary claims", async () => {
    const fixture = await createApprovedProject();
    try {
      const llmsTemplate = join(fixture.project, "src", "package-templates", "llms", "llms.txt");
      writeFileSync(llmsTemplate, "Known gaps: none.\n", "utf8");

      const build = await invokeCliInDir(fixture.project, ["build"]);
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("package template boundary claim is not grounded");
      expect(build.stderr).toContain("package/template-boundary-ungrounded");

      writeFileSync(llmsTemplate, "Known gaps are derived from {{buildInventoryPath}}.\n\n{{knowledge}}\n", "utf8");
      await runCliInDir(fixture.project, ["build"]);
      const rendered = readFileSync(join(fixture.project, "dist", "sample-llms", "llms.txt"), "utf8");
      expect(rendered).toContain("context-build-inventory.json");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("template edits rebuild dist without changing approved knowledge", async () => {
    const fixture = await createApprovedProject();
    try {
      const approvedPath = join(fixture.project, "knowledge", `${fixture.approvedId}.md`);
      const before = fileHash(approvedPath);
      await runCliInDir(fixture.project, ["build"]);
      const templatePath = join(fixture.project, "src", "package-templates", "kb", "AGENTS.md");
      writeFileSync(templatePath, `${readFileSync(templatePath, "utf8")}\ncustom-route=true\n`, "utf8");

      await runCliInDir(fixture.project, ["build"]);
      const after = fileHash(approvedPath);
      expect(after).toBe(before);
      expect(readFileSync(join(fixture.project, "dist", "sample-kb", "AGENTS.md"), "utf8")).toContain("custom-route=true");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("build provides a default display name for package templates", async () => {
    const fixture = await createApprovedProject();
    try {
      const projectEntry = join(fixture.project, "src", "index.ts");
      const originalEntry = readFileSync(projectEntry, "utf8");
      writeFileSync(projectEntry, originalEntry.replace(
        'template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
        'template: "src/package-templates/kb",',
      ), "utf8");
      writeFileSync(join(fixture.project, "src", "package-templates", "kb", "AGENTS.md"), "# {{displayName}}\n", "utf8");

      await runCliInDir(fixture.project, ["build"]);
      const kbAgent = readFileSync(join(fixture.project, "dist", "sample-kb", "AGENTS.md"), "utf8");
      const kbIndex = readFileSync(join(fixture.project, "dist", "sample-kb", "wikis", "index.md"), "utf8");
      expect(kbAgent).toContain("# Sample KB");
      expect(kbIndex).toContain("title: \"Sample KB\"");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

});
