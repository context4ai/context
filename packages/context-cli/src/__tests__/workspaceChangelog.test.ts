import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { inspectWorkspaceVersion, recordWorkspaceVersion, readWorkspaceChangelog } from "../project/workspaceChangelog.js";

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
