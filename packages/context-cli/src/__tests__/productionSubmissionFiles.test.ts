import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { productionAgentDirectory, readProductionFile, readProductionSubmission } from "../project/productionSubmissionFiles.js";

const roots: string[] = [];
async function fixture() {
  const temporary = resolve(".tmp", "production-file-tests");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(join(temporary, "case-"));
  roots.push(root);
  const stage = "writing-01";
  const directory = join(root, productionAgentDirectory(stage));
  await mkdir(join(directory, "submissions"), { recursive: true });
  const save = async (path: string, value: string | Uint8Array) => {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), value);
  };
  return { root, directory, stage, save };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("stage-local fixed submission files", () => {
  test("dispatch and acceptance use the same fixed manifest even if its draft is replaced", async () => {
    const f = await fixture();
    await f.save("submissions/ready.yaml", YAML.stringify({ stage: f.stage,
      tasks: [{ task: "a", input: "input-a", content: "a.md", references: "refs.yaml" }] }));
    await f.save("a.md", "# Original article\n");
    await f.save("refs.yaml", "sections: []\n");
    const input = { projectRoot: f.root, stage: f.stage, path: "submissions/ready.yaml" };
    const manifest = await readProductionFile(input);
    await f.save(input.path, "not: the selected manifest\n");
    const accepted = await readProductionSubmission({ ...input, manifest });
    expect(accepted.tasks.map(task => task.task)).toEqual(["a"]);
    expect(accepted.tasks[0]!.content!.text).toBe("# Original article\n");
  });
  test("resolves drafts from the stage root and freezes cross-batch content", async () => {
    const f = await fixture();
    const tasks = ["a", "b"].map((task) => ({ task, input: `input-${task}`,
      content: `batches/${task}/article.md`, references: `batches/${task}/references.yaml` }));
    for (const task of tasks) {
      await f.save(task.content, `# Article ${task.task}\n`);
      await f.save(task.references, "sections: []\n");
    }
    await f.save("submissions/ready.yaml", YAML.stringify({ stage: f.stage, tasks }));
    const read = await readProductionSubmission({ projectRoot: f.root, stage: f.stage, path: "submissions/ready.yaml" });
    await f.save(tasks[0]!.content, "# Later edit\n");
    expect(read.tasks.map(task => task.content?.text)).toEqual(["# Article a\n", "# Article b\n"]);
    expect(read.tasks[0]!.content?.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(read.bytes).toBeGreaterThan(0);
  });

  test("rejects traversal, absolute and platform-specific paths", async () => {
    const f = await fixture();
    for (const path of ["../secret.md", "/secret.md", "C:/secret.md", "a\\secret.md", "a/../secret.md", "a//b.md"]) {
      await expect(readProductionFile({ projectRoot: f.root, stage: f.stage, path })).rejects.toThrow("stage-relative");
    }
  });

  test("rejects symlink leaves, symlink ancestors and non-files", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "outside.md"), "not authorized");
    await symlink(join(f.root, "outside.md"), join(f.directory, "linked.md"));
    await symlink(f.root, join(f.directory, "linked-directory"));
    for (const path of ["linked.md", "linked-directory/outside.md", "submissions"]) {
      await expect(readProductionFile({ projectRoot: f.root, stage: f.stage, path })).rejects.toThrow();
    }
  });

  test("enforces encoding and byte budgets without truncation", async () => {
    const f = await fixture();
    await f.save("invalid.md", new Uint8Array([0xc3, 0x28]));
    await f.save("nul.md", "a\0b");
    await f.save("large.md", "123456");
    await expect(readProductionFile({ projectRoot: f.root, stage: f.stage, path: "invalid.md" })).rejects.toThrow("UTF-8");
    await expect(readProductionFile({ projectRoot: f.root, stage: f.stage, path: "nul.md" })).rejects.toThrow("NUL");
    await expect(readProductionFile({ projectRoot: f.root, stage: f.stage, path: "large.md", maxBytes: 5 })).rejects.toThrow("budget");
    expect((await readProductionFile({ projectRoot: f.root, stage: f.stage, path: "large.md", maxBytes: 6 })).text).toBe("123456");
  });

  test("rejects malformed whole manifests before returning any task input", async () => {
    const f = await fixture();
    const task = { task: "one", input: "i", content: "one.md", references: "refs.yaml" };
    await f.save("one.md", "# One");
    await f.save("refs.yaml", "sections: []");
    for (const value of [
      { stage: "other", tasks: [task] },
      { stage: f.stage, tasks: [task, task] },
      { stage: f.stage, tasks: [task, { ...task, task: "two" }] },
      { stage: f.stage, tasks: [{ ...task, edits: "edits.yaml" }] },
      { stage: f.stage, tasks: [{ task: "one", input: "i" }] },
      { stage: f.stage, tasks: [{ ...task, indexer_hash: "unnecessary" }] },
    ]) {
      await f.save("submissions/ready.yaml", YAML.stringify(value));
      await expect(readProductionSubmission({ projectRoot: f.root, stage: f.stage, path: "submissions/ready.yaml" })).rejects.toThrow();
    }
  });

  test("reads fragment edits and bounds the aggregate submission", async () => {
    const f = await fixture();
    await f.save("edits.yaml", "sections: []\n");
    const manifest = YAML.stringify({ stage: f.stage, tasks: [{ task: "one", input: "i", edits: "edits.yaml" }] });
    await f.save("submissions/ready.yaml", manifest);
    const input = { projectRoot: f.root, stage: f.stage, path: "submissions/ready.yaml" };
    expect((await readProductionSubmission(input)).tasks[0]!.edits?.text).toBe("sections: []\n");
    await expect(readProductionSubmission({ ...input, limits: {
      file_bytes: 1024, submission_bytes: Buffer.byteLength(manifest) + 2,
    } })).rejects.toThrow("budget");
  });
});


test("missing drafts report the Agent base and exact expected path without accepting runtime files", async () => {
  const f = await fixture();
  const path = "batches/first/article.md";
  await mkdir(join(f.root, ".tmp/context-runtime/production-stages", f.stage, "batches/first"), { recursive: true });
  await writeFile(join(f.root, ".tmp/context-runtime/production-stages", f.stage, path), "Wrong directory");
  await expect(readProductionFile({ projectRoot: f.root, stage: f.stage, path })).rejects.toMatchObject({ detail: {
    reason_code: "invalid-production-file", base_directory: productionAgentDirectory(f.stage),
    expected_path: join(productionAgentDirectory(f.stage), path),
  } });
});
