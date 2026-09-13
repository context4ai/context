import { expect, test } from "bun:test";
import { z } from "zod";
import YAML from "yaml";
import { withProductionFeedback } from "../project/productionFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

test("production feedback preserves specific recovery, exit code and successful results without retries", async () => {
  let calls = 0;
  const result = { accepted: ["one"], failed: [] };
  expect(await withProductionFeedback({ operation: "action" }, async () => { calls++; return result; })).toBe(result);
  expect(calls).toBe(1);
  const detail = { category: "workspace-state-invalid", reason_code: "source-changed",
    next_action: { command: "context action prepare-current --revision current --format json" }, task: "one" };
  await expect(withProductionFeedback({ operation: "action", file: "submit.yaml" }, async () => {
    throw new ContextError(ExitCode.UserError, "Changed source", detail);
  })).rejects.toMatchObject({ code: ExitCode.UserError, detail: { ...detail, file: "submit.yaml" } });
});

test("schema and YAML failures identify the file and actual input fields; I/O retains its cause", async () => {
  const schema = z.object({ articles: z.array(z.object({ question: z.string() })) });
  await expect(withProductionFeedback({ operation: "plan", file: "plan.yaml", schema }, async () => {
    return schema.parse({ articles: [{ question: false }] });
  })).rejects.toMatchObject({ detail: { file: "plan.yaml", reason_code: "production-plan-failed",
    issues: [{ path: ["articles", 0, "question"] }], input_schema: { properties: { articles: { type: "array" } } },
    next_action: { command: "context status --format json" } } });
  await expect(withProductionFeedback({ operation: "action", file: "broken.yaml" }, async () => YAML.parse("a: [")))
    .rejects.toMatchObject({ detail: { file: "broken.yaml", location: expect.arrayContaining([{ line: 1, col: 5 }]) } });
  await expect(withProductionFeedback({ operation: "prepare" }, async () => {
    throw Object.assign(new Error("Read failed"), { code: "EACCES" });
  })).rejects.toMatchObject({ code: ExitCode.WorkspaceStateError,
    detail: { io_code: "EACCES", reason_code: "production-prepare-failed" } });
});
