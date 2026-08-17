import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { cli_main } from "../cli.js";
import { addRepoSource, ensureRepoSources, inspectRepoSources } from "../project/repoSources.js";

const REPO_NAMESPACE = "20260712";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-source-validation-v060-"));
}

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await cli_main(["node", "context", ...args]);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }
  return chunks.join("");
}

function readGitHead(path: string): string {
  const headRaw = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
  if (/^[a-f0-9]{40}$/iu.test(headRaw)) return headRaw.toLowerCase();
  const match = /^ref:\s*(.+)\s*$/iu.exec(headRaw);
  const refPath = match?.[1];
  const head = refPath === undefined ? "" : readFileSync(join(path, ".git", refPath), "utf8").trim();
  if (!/^[a-f0-9]{40}$/iu.test(head)) throw new Error(`expected git HEAD sha for ${path}`);
  return head.toLowerCase();
}

function initGitRepo(path: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  writeFileSync(join(path, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: path });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: path });
  return readGitHead(path);
}

describe("0.6.0 repo source validation", () => {
  test("source ensure reports missing or mismatched repos without git write operations", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initGitRepo(repo);
      const beforeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      await runCliInDir(root, ["init", "kb"]);
      const differentHead = head === "0".repeat(40) ? "1".repeat(40) : "0".repeat(40);
      await writeFile(join(project, "sources", "repo", "index.yaml"), YAML.stringify({
        sources: [{
          name: REPO_NAMESPACE,
          modules: [{
            name: "sample-lib",
            local: "../sample-lib",
            git: {
              remote: "https://git.example.com/sample-lib.git",
              ref: differentHead,
            },
          }],
        }],
      }), "utf8");

      const statuses = await ensureRepoSources({ projectRoot: project, name: "20260712/sample-lib" });
      const status = statuses[0];
      expect(status).toBeDefined();
      expect(status?.ready).toBe(false);
      expect(status?.diagnostics.join("\n")).toContain("source boundary . is missing at pinned ref");
      expect(status?.agent_hints).toContain("repo-pinned-boundary-invalid");
      const afterHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      expect(afterHead).toBe(beforeHead);

      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "short-ref-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/short-ref-lib.git",
        ref: head.slice(0, 12),
      });
      const shortRefStatuses = await ensureRepoSources({ projectRoot: project, name: "20260712/short-ref-lib" });
      expect(shortRefStatuses[0]?.ready).toBe(true);
      expect(shortRefStatuses[0]?.ref).toBe(head);
      const shortRefRegistry = YAML.parse(await readFile(join(project, "sources", "repo", "index.yaml"), "utf8")) as {
        sources: Array<{ name: string; modules: Array<{ name: string; git: { ref: string } }> }>;
      };
      expect(shortRefRegistry.sources[0]?.modules.find((module) => module.name === "short-ref-lib")?.git.ref).toBe(head);

      await expect(addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "missing-lib",
        local: "../missing-lib",
        remote: "https://git.example.com/missing-lib.git",
        ref: "abc123",
      })).rejects.toThrow("short repo source ref cannot be resolved because local path is missing");
      expect(readFileSync(join(project, "sources", "repo", "index.yaml"), "utf8")).not.toContain("missing-lib");
      expect(existsSync(join(project, "sources", "repo", REPO_NAMESPACE, "missing-lib"))).toBe(false);

      const missing = await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "missing-lib",
        local: "../missing-lib",
        remote: "https://git.example.com/missing-lib.git",
        ref: head,
      });
      expect(missing.source.name).toBe("20260712/missing-lib");
      expect(readFileSync(join(project, "sources", "repo", "index.yaml"), "utf8")).toContain("missing-lib");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source add validates registry shape and format before writing", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initGitRepo(repo);
      await runCliInDir(root, ["init", "kb"]);

      await expect(runCliInDir(project, [
        "source",
        "add",
        "repo",
        REPO_NAMESPACE,
        "--module",
        "sample-lib",
        "--local",
        "../sample-lib",
        "--remote",
        "https://git.example.com/sample-lib.git",
        "--ref",
        head,
        "--format",
        "xml",
      ])).rejects.toThrow("--format must be one of");
      expect(readFileSync(join(project, "sources", "repo", "index.yaml"), "utf8")).toBe("sources: []\n");

      await expect(addRepoSource({
        projectRoot: project,
        namespace: "20260230",
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      })).rejects.toThrow("repo source batch must be a valid YYYYMMDD date");
      expect(readFileSync(join(project, "sources", "repo", "index.yaml"), "utf8")).toBe("sources: []\n");
      expect(existsSync(join(project, "sources", "repo", REPO_NAMESPACE, "sample-lib"))).toBe(false);

      await expect(addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: "main",
      })).rejects.toThrow("repo source ref must be a commit sha");
      expect(readFileSync(join(project, "sources", "repo", "index.yaml"), "utf8")).toBe("sources: []\n");

      await writeFile(join(project, "sources", "repo", "index.yaml"), "sources:\n  - name: broken\n", "utf8");
      await expect(addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "other-lib",
        remote: "https://git.example.com/other-lib.git",
        ref: head,
      })).rejects.toThrow(/Invalid repo sources registry/);
      expect(readFileSync(join(project, "sources", "repo", "index.yaml"), "utf8")).toBe("sources:\n  - name: broken\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source updates preserve custom identity and materialization settings", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initGitRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "sources", "repo", "index.yaml"), YAML.stringify({
        sources: [{
          name: REPO_NAMESPACE,
          modules: [{
            name: "sample-lib",
            id: "sample",
            local: "../sample-lib",
            materializedAt: "sources/repo/custom/sample-lib",
            git: {
              remote: "https://git.example.com/sample-lib.git",
              ref: head,
            },
          }],
        }],
      }), "utf8");

      const result = await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        ref: head,
      });

      expect(result.source.id).toBe("20260712/sample");
      expect(result.source.materializedAt).toBe("sources/repo/custom/sample-lib");
      expect(result.status.materializedAt).toBe("sources/repo/custom/sample-lib");
      expect(existsSync(join(project, "sources", "repo", "custom", "sample-lib"))).toBe(true);
      expect(existsSync(join(project, "sources", "repo", REPO_NAMESPACE, "sample-lib"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("repo module names are project-wide knowledge identities across date batches", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initGitRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await addRepoSource({
        projectRoot: project,
        namespace: "20260712",
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });

      await expect(addRepoSource({
        projectRoot: project,
        namespace: "20260713",
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      })).rejects.toThrow("module names are project-wide codegraph identities");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("date selector operates on every repo module and coexists with a document source", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const docs = join(root, "docs");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      await mkdir(docs, { recursive: true });
      const head = initGitRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      for (const module of ["sample-a", "sample-b"]) {
        await addRepoSource({
          projectRoot: project,
          namespace: REPO_NAMESPACE,
          module,
          local: "../sample-lib",
          remote: `https://git.example.com/${module}.git`,
          ref: head,
        });
      }
      await writeFile(join(project, "sources", "file", "index.yaml"), YAML.stringify({
        sources: [{ name: REPO_NAMESPACE, local: "../docs" }],
      }), "utf8");

      const ensured = await ensureRepoSources({ projectRoot: project, name: REPO_NAMESPACE });
      expect(ensured.map((source) => source.name)).toEqual([
        "20260712/sample-a",
        "20260712/sample-b",
      ]);
      const inspected = await inspectRepoSources({ projectRoot: project, name: REPO_NAMESPACE });
      expect(inspected.map((source) => source.source.name)).toEqual([
        "20260712/sample-a",
        "20260712/sample-b",
      ]);

      const ensureOutput = await runCliInDir(project, ["source", "ensure", REPO_NAMESPACE, "--format", "json"]);
      const ensureRows = JSON.parse(ensureOutput) as Array<{ type?: string; name: string }>;
      expect(ensureRows.map((row) => row.name)).toEqual([
        "20260712/sample-a",
        "20260712/sample-b",
        REPO_NAMESPACE,
      ]);
      expect(ensureRows[2]?.type).toBe("file");

      const inspectOutput = await runCliInDir(project, ["source", "inspect", REPO_NAMESPACE, "--format", "json"]);
      const inspectRows = JSON.parse(inspectOutput) as Array<{ type?: string; source?: { name?: string }; name?: string }>;
      expect(inspectRows.map((row) => row.source?.name ?? row.name)).toEqual([
        "20260712/sample-a",
        "20260712/sample-b",
        REPO_NAMESPACE,
      ]);
      expect(inspectRows[2]?.type).toBe("file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
