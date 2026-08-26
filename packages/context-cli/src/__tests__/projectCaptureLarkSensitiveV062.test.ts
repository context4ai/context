import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ContextError } from "../lib/errors.js";
import type { LarkRunner } from "../lib/feishu.js";
import {
  createLarkCaptureProject as createLarkProject,
  makeLarkCaptureTmp as makeTmp,
  runLarkCapturePhase as runPhase,
} from "./projectCaptureLarkV062.fixtures.js";

function sensitiveLarkRunner(): LarkRunner {
  return async (args) => {
    if (args.includes("--help")) {
      return {
        stdout: "Flags:\n      --api-version string\n      --doc-format string\n",
        stderr: "",
        exitCode: 0,
      };
    }
    return {
      stdout: JSON.stringify({
        ok: true,
        data: {
          title: "Credential Example",
          document: {
            content: "<title>Credential Example</title><p>Access Key: AbCdEf0123456789AbCdEf0123456789</p>",
          },
          revision_id: "rev-sensitive",
          assets: [],
        },
      }),
      stderr: "",
      exitCode: 0,
    };
  };
}

describe("0.6.2 Lark sensitive source capture", () => {
  test("rejects likely credential literals before persisting a source snapshot", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createLarkProject(root);
      try {
        await runPhase({
          cwd: projectRoot,
          phaseId: "capture:lark:handbook",
          format: "json",
          larkRunner: sensitiveLarkRunner(),
        });
        throw new Error("expected sensitive source capture to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).detail).toMatchObject({
          code: "lark.capture.sensitive-source-content",
          sourceName: "handbook",
        });
        const candidates = (error as ContextError).detail?.candidates as Array<Record<string, unknown>>;
        expect(candidates).toContainEqual({
          path: "index.md",
          line: 3,
          label: "access-key",
          value_length: 32,
        });
      }
      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "index.md"))).toBe(false);
      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "manifest.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
