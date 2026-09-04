import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli_main } from "../cli.js";


export const REPO_NAMESPACE = "20260712";

export function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-v060-"));
}

export async function runCliInDir(dir: string, args: string[]): Promise<string> {
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

export function initGitRepo(path: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  writeFileSync(join(path, "README.md"), "# fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: path });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: path });
  return readGitHead(path);
}

export function commitAll(path: string, message: string): string {
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", message], { cwd: path });
  return readGitHead(path);
}

export function readGitHead(path: string): string {
  const headRaw = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
  if (/^[a-f0-9]{40}$/iu.test(headRaw)) return headRaw.toLowerCase();
  const match = /^ref:\s*(.+)\s*$/iu.exec(headRaw);
  const refPath = match?.[1];
  const head = refPath === undefined ? "" : readFileSync(join(path, ".git", refPath), "utf8").trim();
  if (!/^[a-f0-9]{40}$/iu.test(head)) {
    throw new Error(`expected git HEAD sha for ${path}, got ${JSON.stringify(headRaw)}`);
  }
  return head.toLowerCase();
}

export function initTsMonorepoFixture(path: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  for (const name of ["button", "link"]) {
    const moduleRoot = join(path, "packages", name);
    execFileSync("mkdir", ["-p", join("packages", name, "src")], { cwd: path });
    writeFileSync(join(moduleRoot, "package.json"), `${JSON.stringify({
      name: `@demo/${name}`,
      version: "1.0.0",
      type: "module",
      exports: "./src/index.ts",
    }, null, 2)}\n`, "utf8");
    writeFileSync(join(moduleRoot, "src", "index.ts"), `export const ${name} = "${name}";\n`, "utf8");
  }
  return commitAll(path, "add monorepo fixture");
}

export async function writeSampleLibProjectEntry(project: string): Promise<void> {
  await writeFile(join(project, "src", "index.ts"), [
    'import { defineProject, source } from "@c4a/context";',
    "",
    'const sampleLib = source("20260712", "sample-lib");',
    "",
    "export default defineProject({",
    "  sources: [sampleLib],",
    "  phases: [],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}
