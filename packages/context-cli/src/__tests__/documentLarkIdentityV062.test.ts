import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  fetchFeishuDocSnapshot,
  LarkCliError,
  type LarkRunner,
} from "../lib/feishu.js";

function argument(args: readonly string[], name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (value === undefined) throw new Error(`missing test argument ${name}`);
  return value;
}

describe("Lark capture identity selection", () => {
  test("falls back to bot when user credentials cannot be refreshed and keeps that identity for resources", async () => {
    const identities: string[] = [];
    const runner: LarkRunner = async (args, options) => {
      if (args.includes("--help")) {
        return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
      }
      const identity = argument(args, "--as");
      identities.push(`${args[0]}:${args[1]}:${identity}`);
      if (args[0] === "docs" && args[1] === "+fetch" && identity === "user") {
        return {
          stdout: JSON.stringify({
            ok: false,
            identity: "user",
            error: {
              type: "authorization",
              subtype: "need_user_authorization",
              message: "user credential refresh failed",
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "docs" && args[1] === "+fetch") {
        return {
          stdout: JSON.stringify({
            ok: true,
            identity: "bot",
            data: {
              title: "Shared handbook",
              document: {
                content: '<title>Shared handbook</title><p>Body</p><img token="image-token" alt="Diagram"/>',
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "docs" && args[1] === "+media-download") {
        const output = argument(args, "--output");
        await writeFile(resolve(options?.cwd ?? process.cwd(), `${output}.png`), "image", "utf8");
        return { stdout: JSON.stringify({ ok: true, identity: "bot" }), stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    };

    const result = await fetchFeishuDocSnapshot({ url: "https://example.test/wiki/shared" }, runner);

    expect(result.accessIdentity).toBe("bot");
    expect(result.identityFallback).toBe(true);
    expect(result.markdown).toContain("Body");
    expect(result.markdown).toContain("assets/materialized/image/");
    expect(identities).toEqual([
      "docs:+fetch:user",
      "docs:+fetch:bot",
      "docs:+media-download:bot",
    ]);
  });

  test("does not switch identity after a permission denial", async () => {
    const identities: string[] = [];
    const runner: LarkRunner = async (args) => {
      if (args.includes("--help")) {
        return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
      }
      identities.push(argument(args, "--as"));
      return {
        stdout: "",
        stderr: JSON.stringify({
          ok: false,
          identity: "user",
          error: {
            type: "authorization",
            subtype: "permission_denied",
            message: "document access denied",
          },
        }),
        exitCode: 1,
      };
    };

    await expect(fetchFeishuDocSnapshot({ url: "https://example.test/wiki/private" }, runner))
      .rejects.toBeInstanceOf(LarkCliError);
    expect(identities).toEqual(["user"]);
  });

  test("reports the missing XML capability before capture", async () => {
    const runner: LarkRunner = async () => ({
      stdout: "Flags:\n      --api-version string\n",
      stderr: "",
      exitCode: 0,
    });

    await expect(fetchFeishuDocSnapshot({ url: "https://example.test/wiki/legacy" }, runner))
      .rejects.toMatchObject({
        message: expect.stringContaining("does not support --doc-format xml"),
      });
  });
});
