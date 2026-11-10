import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { initialRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { completeApprovedRevision, prepareApprovedRevision, readApprovedRevision } from "../project/approvedRevision.js";
import { readCandidateRecords } from "../project/candidateLedger.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const cli = (root: string, args: string[]) => {
  try {
    return { ok: true, out: execFileSync("node", [resolve(import.meta.dir, "../../dist/cli.js"), ...args],
      { cwd: root, encoding: "utf8", env: { ...process.env, CONTEXT_RUNTIME_EVENTS_DISABLED: "1" } }) };
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${output.stdout ?? ""}${output.stderr ?? ""}` };
  }
};

test("version record waits for drafts under review unless the workflow is at its record step", async () => {
  const root = await initialRevisionKnowledge(roots);
  await prepareApprovedRevision({ projectRoot: root, selector: "architecture/overview.md", instruction: "Clarify." });
  const request = (await readApprovedRevision(root))!;
  await completeApprovedRevision({ projectRoot: root, revision: request.revision,
    markdown: request.target.markdown.replace("value 42.", "value 42. Clarified.") });
  expect((await readCandidateRecords(root)).map(candidate => candidate.status)).toEqual(["draft"]);
  const inspected = JSON.parse(cli(root, ["version", "inspect"]).out);
  await writeFile(join(root, ".tmp/version.json"), JSON.stringify({ ...inspected.input_example, title: "Clarify", changes: ["Clarified"] }));
  const refused = cli(root, ["version", "record", "--input", ".tmp/version.json", "--format", "json"]);
  expect(refused.ok).toBe(false);
  expect(refused.out).toContain("version-review-pending");
  expect(refused.out).toContain("Drafts are still awaiting review; the current step is review-current-batch");
}, 60_000);
