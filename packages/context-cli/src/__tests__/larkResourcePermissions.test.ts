import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE } from "@c4a/extract";
import { LarkCliError } from "../lib/feishu.js";
import type { LarkExternalResource } from "../lib/larkDocxXml.js";
import {
  isLarkResourcePermissionDenied,
  runLarkResourceCommand,
  type LarkResourceCommandRunner,
} from "../lib/larkResourceCommand.js";
import { materializeLarkResources } from "../lib/larkResourceMaterialization.js";

const policy = { videos: "reference-only" as const, maxBytesPerResource: 4096, maxTotalBytes: 8192 };
const scopeError = JSON.stringify({
  ok: false,
  error: {
    type: "network",
    code: 400,
    message: `HTTP 400: ${JSON.stringify({
      code: 99991672,
      msg: "Access denied. Required application scope is missing.",
      error: { permission_violations: [{ type: "action_scope_required", subject: "board:whiteboard:node:read" }] },
    })}`,
  },
});

const denied: LarkResourceCommandRunner = async () => ({ exitCode: 1, stdout: "", stderr: scopeError });

test.each(["stderr", "stdout", "ok-false"])("recognizes nested scope denial from %s", async channel => {
  const runner: LarkResourceCommandRunner = async () => ({
    exitCode: channel === "ok-false" ? 0 : 1,
    stdout: channel === "stderr" ? "" : scopeError,
    stderr: channel === "stderr" ? scopeError : "",
  });
  let failure: unknown;
  try { await runLarkResourceCommand(runner, ["whiteboard", "+export"]); } catch (error) { failure = error; }
  expect(isLarkResourcePermissionDenied(failure)).toBe(true);
});

test("retains outer service scope code when stdout contains the direct API envelope", async () => {
  let failure: unknown;
  try {
    await runLarkResourceCommand(async () => ({
      exitCode: 1, stderr: "",
      stdout: JSON.stringify({ code: 99991672, error: { message: "Required application scope is missing" } }),
    }), ["whiteboard", "+export"]);
  } catch (error) { failure = error; }
  expect(isLarkResourcePermissionDenied(failure)).toBe(true);
});

test.each([
  { code: 400, message: "Malformed request" },
  { code: 500, message: "Service unavailable" },
  { code: 400, message: "permission denied", subtype: "invalid_parameter" },
  { code: 400, message: "HTTP 400: {not valid JSON}" },
])("does not classify unrelated failure as permission denial: %j", async detail => {
  let failure: unknown;
  try {
    await runLarkResourceCommand(async () => ({
      exitCode: 1, stdout: "", stderr: JSON.stringify({ error: detail }),
    }), ["whiteboard", "+export"]);
  } catch (error) { failure = error; }
  expect(isLarkResourcePermissionDenied(failure)).toBe(false);
});

test("all unavailable embedded resource kinds keep auditable references without changing identity", async () => {
  const kinds: LarkExternalResource["kind"][] = ["image", "file", "whiteboard", "diagram", "sheet", "base", "synced-reference"];
  const resources = kinds.map(kind => ({
    kind,
    locator: `lark:${kind}:restricted`,
    attributes: { token: "restricted", "table-id": "table", "sheet-id": "sheet" },
  }));
  const calls: string[][] = [];
  const result = await materializeLarkResources({
    identity: "bot", policy, resources,
    runner: async (args, options) => { calls.push(args); return denied(args, options); },
    resolveSyncedReference: async () => { throw new LarkCliError("Document fetch failed", 1, scopeError); },
  });
  expect(result.report.status).toBe("warning");
  expect(result.assets).toEqual([]);
  expect(result.report.items).toHaveLength(kinds.length);
  for (const item of result.report.items) {
    expect(item).toMatchObject({ status: "failed", asset_paths: [], reason_code: DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE });
    expect(result.replacements.get(item.locator)).toContain("Resource unavailable:");
  }
  expect(calls.every(args => args[args.indexOf("--as") + 1] === "bot")).toBe(true);
  expect(calls.filter(args => args[1] === "+media-preview")).toHaveLength(1);
});

test.each(["whiteboard", "diagram"] as const)("retains %s preview when same-identity structured export is denied", async kind => {
  const calls: string[][] = [];
  const result = await materializeLarkResources({
    identity: "bot", policy,
    resources: [{ kind, locator: `lark:${kind}:board`, attributes: { token: "board" } }],
    runner: async (args, options) => {
      calls.push(args);
      if (args[1] === "+media-download") {
        await writeFile(resolve(options!.cwd!, `${args[args.indexOf("--output") + 1]}.svg`), "<svg />");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return denied(args, options);
    },
  });
  expect(result.report.status).toBe("warning");
  expect(result.assets).toHaveLength(1);
  expect(result.assets[0]).toMatchObject({ role: "presentation", source: { identity: "bot", representation: "preview" } });
  expect(result.report.items[0]).toMatchObject({ status: "materialized", reason_code: "document.resource.preview" });
  expect(result.report.items[0]?.asset_paths).toEqual([result.assets[0]!.path]);
  expect(result.replacements.get(`lark:${kind}:board`)).not.toContain("Raw snapshot");
  expect(calls.map(args => args[args.indexOf("--as") + 1])).toEqual(["bot", "bot"]);
});

test.each(["bad-request", "invalid-json"])("keeps whiteboard raw %s failures visible", async mode => {
  const result = await materializeLarkResources({
    identity: "bot", policy,
    resources: [{ kind: "whiteboard", locator: "lark:whiteboard:board", attributes: { token: "board" } }],
    runner: async (args, options) => {
      const output = resolve(options!.cwd!, args[args.indexOf("--output") + 1]!);
      if (args[1] === "+media-download") await writeFile(`${output}.svg`, "<svg />");
      else if (mode === "bad-request") return { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code: 400 } }) };
      else await writeFile(output, "not JSON");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(result.report.status).toBe("error");
  expect(result.report.items[0]?.reason_code).toBeUndefined();
});
