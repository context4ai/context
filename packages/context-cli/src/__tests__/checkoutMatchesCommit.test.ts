import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutMatchesCommit } from "../project/productionPlanningMaterials.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("only a real difference counts as differs; a failed check is unchecked, not a missing source", async () => {
  const root = await mkdtemp(join(tmpdir(), "checkout-check-")); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.email", "t@example.test"); git("config", "user.name", "T");
  await writeFile(join(root, "a.txt"), "one\n");
  git("add", "a.txt"); git("commit", "-qm", "init");
  const ref = git("rev-parse", "HEAD");
  expect(await checkoutMatchesCommit(root, ref, 1)).toEqual({ state: "same" });
  await writeFile(join(root, "a.txt"), "changed\n");
  expect(await checkoutMatchesCommit(root, ref, 1)).toEqual({ state: "differs" });
  // A broken index makes git fail for another reason: retried, then reported as unchecked.
  await writeFile(join(root, ".git/index"), "not an index");
  const unchecked = await checkoutMatchesCommit(root, ref, 1);
  expect(unchecked.state).toBe("unchecked");
  expect("reason" in unchecked && unchecked.reason.length).toBeGreaterThan(0);
});
