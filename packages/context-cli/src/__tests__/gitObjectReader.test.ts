import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGitObjectReader, SourceReadError, SourceUnavailableError } from "../project/gitObjectReader.js";
import { registeredArticleSourceReader } from "../project/articleSourceReader.js";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "git-object-reader-")); roots.push(root);
  git(root, "init", "-q"); git(root, "config", "user.name", "Test"); git(root, "config", "user.email", "test@example.test");
  await Promise.all(Array.from({ length: 200 }, (_, index) => writeFile(join(root, `${index}.txt`), `file ${index}\n${"x".repeat(index)}\n`)));
  git(root, "add", "."); git(root, "commit", "-qm", "fixture");
  const commit = git(root, "rev-parse", "HEAD");
  return { root, commit };
}

test("hundreds of parallel files share one batch process and preserve exact bytes", async () => {
  const { root, commit } = await repository();
  const trace = join(root, "trace.log");
  const previous = process.env.GIT_TRACE; process.env.GIT_TRACE = trace;
  const reader = createGitObjectReader();
  try {
    const values = await Promise.all(Array.from({ length: 400 }, (_, index) => reader.read(root, commit, `${index % 200}.txt`)));
    for (let index = 0; index < values.length; index++) expect(values[index]!.toString()).toBe(`file ${index % 200}\n${"x".repeat(index % 200)}\n`);
    expect((await readFile(trace, "utf8")).split("\n").filter(line => line.includes("built-in: git cat-file --batch"))).toHaveLength(1);
    await expect(reader.read(root, commit, "missing.txt")).rejects.toBeInstanceOf(SourceUnavailableError);
  } finally { reader.close(); if (previous === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = previous; }
});

test("registered repository citations read pinned bytes despite modified or deleted checkout files", async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await writeFile(join(root, "fixture-source/src/index.ts"), "uncommitted replacement\n");
  await rm(join(root, "fixture-source/src/secondary.ts"));
  const read = await registeredArticleSourceReader(root);
  expect(await read(DOCUMENT_REVISION_SOURCE_REF, "src/index.ts")).toBe("export const answer = 42;\n");
  expect(await read(DOCUMENT_REVISION_SOURCE_REF, "src/secondary.ts", true)).toBe("export const secondaryAnswer = 84;\n");
});

test("incomplete batch output is a retried read error, not a missing citation", async () => {
  const { root, commit } = await repository();
  const bin = join(root, "bin"); await mkdir(bin);
  const executable = join(bin, "git");
  await writeFile(executable, `#!${process.execPath}\nif (process.argv.includes('-e')) process.exit(0); process.stdin.once('data', () => { process.stdout.write('${"a".repeat(40)} blob 100\\nshort'); process.exit(0); });\n`);
  await chmod(executable, 0o755);
  const previous = process.env.PATH; process.env.PATH = `${bin}:${previous}`;
  const reader = createGitObjectReader({ progressTimeoutMs: 1000 });
  try { await expect(reader.read(root, commit, "0.txt")).rejects.toBeInstanceOf(SourceReadError); }
  finally { reader.close(); process.env.PATH = previous; }
});

test("missing commit or checkout is a read failure, while a missing path is unavailable", async () => {
  const { root, commit } = await repository(); const reader = createGitObjectReader();
  try {
    await expect(reader.read(root, "f".repeat(40), "0.txt")).rejects.toBeInstanceOf(SourceReadError);
    await expect(reader.read(join(root, "absent"), commit, "0.txt")).rejects.toBeInstanceOf(SourceReadError);
    await expect(reader.read(root, commit, "absent.txt")).rejects.toBeInstanceOf(SourceUnavailableError);
  } finally { reader.close(); }
});
