import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { inspectWorkspaceVersion, recordWorkspaceVersion, readWorkspaceChangelog, workspaceContentSnapshot } from "../project/workspaceChangelog.js";

test("formal changes require increasing versions and typed history; temporary progress does not", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-versions-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "config", "user.name", "Workspace Author"]);
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.0.0" }));
    await writeFile(join(root, "guide.md"), "First content");
    const initial = await inspectWorkspaceVersion(root);
    const input = { expected_digest: initial.expected_digest, version: "0.1.0", title: "Initial knowledge", changes: ["Added a guide"], triggers: [{ kind: "initial", description: "Initial user request" }] };
    await recordWorkspaceVersion(root, input);
    expect((await readWorkspaceChangelog(root))[0]?.actor).toEqual({ kind: "git", name: "Workspace Author" });
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version).toBe("0.1.0");
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    await mkdir(join(root, ".tmp"), { recursive: true }); await writeFile(join(root, ".tmp/progress"), "next");
    await mkdir(join(root, "dist")); await writeFile(join(root, "dist/output"), "build");
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    await expect(recordWorkspaceVersion(root, input)).rejects.toThrow("diff changed");
    await writeFile(join(root, ".context-builds.json"), JSON.stringify({version: "0.1.0", packages: []}));
    await writeFile(join(root, "guide.md"), "Corrected content");
    const changed = await inspectWorkspaceVersion(root);
    expect(changed.updated).toEqual(["guide.md"]);
    await expect(recordWorkspaceVersion(root, { ...input, expected_digest: changed.expected_digest })).rejects.toThrow("greater");
    await recordWorkspaceVersion(root, { ...input, expected_digest: changed.expected_digest, version: "0.1.1", actor: { name: "Known Lark User", kind: "lark" } });
    expect((await readWorkspaceChangelog(root)).map(entry => entry.version)).toEqual(["0.1.1", "0.1.0"]);
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    const noChange = await inspectWorkspaceVersion(root);
    await expect(recordWorkspaceVersion(root, { ...input, expected_digest: noChange.expected_digest, version: "0.1.2" })).rejects.toThrow("No formal content");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an independent workspace ignored by its parent Git still versions formal content, not nested Git or temporary files", async () => {
  const parent = resolve(".tmp/workspace-version-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "ignored-"));
  try {
    execFileSync("git", ["init", "-q", outer]);
    await writeFile(join(outer, ".gitignore"), "workspace/\n");
    const root = join(outer, "workspace");
    await mkdir(join(root, "knowledge"), { recursive: true });
    await mkdir(join(root, "sources/repo/sample/.git"), { recursive: true });
    await mkdir(join(root, "sources/repo/sample/.tmp"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.0.0" }));
    await writeFile(join(root, "knowledge/answer.md"), "Answer");
    await writeFile(join(root, "sources/repo/sample/source.ts"), "export const answer = 42;");
    await writeFile(join(root, "sources/repo/sample/.git/config"), "Process metadata");
    await writeFile(join(root, "sources/repo/sample/.tmp/task.md"), "Temporary task");
    expect(Object.keys(await workspaceContentSnapshot(root))).toEqual(["knowledge/answer.md", "package.json", "sources/repo/sample/source.ts"]);
    const initial = await inspectWorkspaceVersion(root);
    expect(initial.changed).toBe(true);
    await recordWorkspaceVersion(root, { expected_digest: initial.expected_digest, version: "0.0.1", title: "Initial delivery",
      changes: ["Add the answer"], triggers: [{ kind: "initial", description: "Fixture" }], actor: { kind: "user", name: "Fixture" } });
    expect((await inspectWorkspaceVersion(root)).current).toBe(true);
    await writeFile(join(root, "knowledge/answer.md"), "Corrected answer");
    expect((await inspectWorkspaceVersion(root)).updated).toEqual(["knowledge/answer.md"]);
  } finally { await rm(outer, { recursive: true, force: true }); }
});

test("unbuilt delivery repairs amend one entry; successful build or publish seals it", async () => {
  const parent = resolve(".tmp/workspace-version-tests");
  await mkdir(parent, { recursive: true });
  for (const receipt of [".context-builds.json", ".context-published.json"]) {
    const root = await mkdtemp(join(parent, "pending-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({version: "0.0.0"}));
      await writeFile(join(root, "guide.md"), "Initial content");
      const fields = {version: "0.1.0", title: "Initial delivery", changes: ["Added guide"],
        triggers: [{kind: "initial", description: "User request"}], actor: {kind: "user" as const, name: "Reader"}};
      await recordWorkspaceVersion(root, {...fields, expected_digest: (await inspectWorkspaceVersion(root)).expected_digest});
      for (const content of ["Navigation fixed", "Literal code fixed"]) {
        await writeFile(join(root, "guide.md"), content);
        const status = await inspectWorkspaceVersion(root);
        expect(status.reusable_version).toBe("0.1.0");
        await recordWorkspaceVersion(root, {...fields, actor: undefined, changes: ["Added guide", content], expected_digest: status.expected_digest});
        expect((await readWorkspaceChangelog(root))[0]?.actor).toEqual(fields.actor);
        expect((await readWorkspaceChangelog(root)).map(entry => entry.version)).toEqual(["0.1.0"]);
        expect((await inspectWorkspaceVersion(root)).current).toBe(true);
      }
      await writeFile(join(root, "guide.md"), "Next update");
      const beforeSeal = await inspectWorkspaceVersion(root);
      await writeFile(join(root, receipt), JSON.stringify({version: "0.1.0", packages: []}));
      await expect(recordWorkspaceVersion(root, {...fields, expected_digest: beforeSeal.expected_digest})).rejects.toThrow("diff changed");
      const sealed = await inspectWorkspaceVersion(root);
      expect(sealed.reusable_version).toBeNull();
      await expect(recordWorkspaceVersion(root, {...fields, expected_digest: sealed.expected_digest})).rejects.toThrow("greater");
      await recordWorkspaceVersion(root, {...fields, version: "0.1.1", expected_digest: sealed.expected_digest});
      expect((await readWorkspaceChangelog(root)).map(entry => entry.version)).toEqual(["0.1.1", "0.1.0"]);
    } finally { await rm(root, {recursive: true, force: true}); }
  }
});
