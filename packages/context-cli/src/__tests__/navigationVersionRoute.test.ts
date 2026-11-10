import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { applyKnowledgeMapUpdate, inspectKnowledgeMap } from "../project/knowledgeMap.js";
import { collectProjectStatus } from "../project/status.js";
import { inspectWorkspaceVersion, recordWorkspaceVersion } from "../project/workspaceChangelog.js";
import { buildProjectPackages } from "../project/packageBuilder.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("a navigation-only change after delivery routes to version recording and build, not a new task", async () => {
  const root = await initialRevisionKnowledge(roots);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "ignore" });
  const node = async () => (await collectProjectStatus(root)).workflow.current?.node;
  const record = async (version: string, kind: "initial" | "navigation") => recordWorkspaceVersion(root, { version, title: version,
    changes: [version], triggers: [{ kind, description: version }], expected_digest: (await inspectWorkspaceVersion(root)).expected_digest });
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "init");
  await record("0.1.0", "initial"); await buildProjectPackages(root);
  git("add", "-A"); git("commit", "-qm", "0.1.0");
  expect(await node()).toBe("reopen-cleared-task");
  const map = await inspectKnowledgeMap(root);
  await applyKnowledgeMapUpdate(root, { expected_revision: map.revision, upsert: [{ ...map.entries[0]!, title: "Renamed overview" }], remove: [] });
  expect(await node()).toBe("record-workspace-version");
  await record("0.1.1", "navigation");
  expect(await node()).toBe("build-next");
  await buildProjectPackages(root);
  expect(await node()).toBeUndefined();
  git("add", "-A"); git("commit", "-qm", "0.1.1");
  expect(await node()).toBe("reopen-cleared-task");
}, 60_000);

test("committing the navigation change before recording or building keeps the route", async () => {
  const root = await initialRevisionKnowledge(roots);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "ignore" });
  const node = async () => (await collectProjectStatus(root)).workflow.current?.node;
  const record = async (version: string, kind: "initial" | "navigation") => recordWorkspaceVersion(root, { version, title: version,
    changes: [version], triggers: [{ kind, description: version }], expected_digest: (await inspectWorkspaceVersion(root)).expected_digest });
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "init");
  await record("0.1.0", "initial"); await buildProjectPackages(root);
  git("add", "-A"); git("commit", "-qm", "0.1.0");
  const map = await inspectKnowledgeMap(root);
  await applyKnowledgeMapUpdate(root, { expected_revision: map.revision, upsert: [{ ...map.entries[0]!, title: "Renamed overview" }], remove: [] });
  git("add", "-A"); git("commit", "-qm", "navigation");
  // A working note committed beside it does not need production either.
  await writeFile(join(root, "TODO.md"), "Follow-ups\n");
  git("add", "-A"); git("commit", "-qm", "note");
  expect(await node()).toBe("record-workspace-version");
  await record("0.1.1", "navigation");
  git("add", "-A"); git("commit", "-qm", "0.1.1");
  expect(await node()).toBe("build-next");
  // Without a local build record (a fresh clone or cleared .tmp), the build is not confirmed either.
  await rm(join(root, ".tmp/context-runtime/packages"), { recursive: true, force: true });
  expect(await node()).toBe("build-next");
  await buildProjectPackages(root);
  expect(await node()).toBe("reopen-cleared-task");
}, 60_000);
