import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { checkLarkCli, fetchFeishuDocSnapshot, type LarkRunner } from "../lib/feishu.js";
import { createLarkReadSession, resolveLarkReadIdentity } from "../lib/larkReadIdentity.js";
import { createLarkCaptureProject, makeLarkCaptureTmp, runLarkCapturePhase } from "./projectCaptureLarkV062.fixtures.js";

const previous = process.env.CONTEXT_LARK_IDENTITY;
afterEach(() => {
  if (previous === undefined) delete process.env.CONTEXT_LARK_IDENTITY;
  else process.env.CONTEXT_LARK_IDENTITY = previous;
});
const denied = {
  exitCode: 3, stderr: "", stdout: JSON.stringify({ ok: false,
    error: { type: "authorization", subtype: "missing_scope" } }),
};
const success = { exitCode: 0, stderr: "", stdout: JSON.stringify({ ok: true }) };
const as = (args: string[]) => args[args.indexOf("--as") + 1];

describe("configured Lark read identity", () => {
  test("defaults to user and rejects an invalid mode with recovery", () => {
    delete process.env.CONTEXT_LARK_IDENTITY;
    expect(resolveLarkReadIdentity()).toBe("user");
    process.env.CONTEXT_LARK_IDENTITY = "auto";
    expect(resolveLarkReadIdentity).toThrow("must be user or bot");
  });

  test("user mode does not retry a denied request with bot", async () => {
    const seen: string[] = [];
    const session = createLarkReadSession(async args => { seen.push(as(args)!); return denied; }, "user");
    expect(await session.run(["docs", "+fetch"])).toEqual(denied);
    expect(seen).toEqual(["user"]);
  });

  test("bot falls back once and keeps user for subsequent pages/resources", async () => {
    const seen: string[] = [];
    const session = createLarkReadSession(async args => {
      seen.push(as(args)!);
      return as(args) === "bot" ? denied : success;
    }, "bot");
    await session.run(["docs", "+fetch", "--as", "bot"]);
    await session.run(["docs", "+fetch", "--offset", "1", "--as", "bot"]);
    await session.run(["docs", "+media-download", "--as", "bot"]);
    expect(seen).toEqual(["bot", "user", "user", "user"]);
    expect(session.usedFallback).toBe(true);
  });

  test.each(["rate_limit", "network", "validation", "parse"])("does not switch on %s errors", async type => {
    const seen: string[] = [];
    const session = createLarkReadSession(async args => {
      seen.push(as(args)!);
      return { exitCode: 1, stdout: JSON.stringify({ ok: false, error: { type } }), stderr: "" };
    }, "bot");
    await session.run(["docs", "+fetch"]);
    expect(seen).toEqual(["bot"]);
  });

  test("does not request user credentials for local help failures", async () => {
    const seen: string[] = [];
    const session = createLarkReadSession(async args => { seen.push(as(args)!); return denied; }, "bot");
    await session.run(["docs", "+fetch", "--help"]);
    expect(seen).toEqual(["bot"]);
  });

  test("capture uses the configured identity for discovery, body and media fallback", async () => {
    process.env.CONTEXT_LARK_IDENTITY = "bot";
    const seen: string[] = [];
    const runner: LarkRunner = async (args, options) => {
      seen.push(`${args[0]}:${args[1]}:${as(args)}`);
      if (args.includes("--version")) return { ...success, stdout: "1.0.0" };
      if (args.includes("--help")) return { ...success, stdout: "Flags:\n --doc-format string\n --api-version string\n" };
      if (args[1] === "+fetch") return { ...success, stdout: JSON.stringify({ ok: true, identity: as(args), data: {
        document: { content: '<title>Handbook</title><p>Body</p><img token="image"/>' },
      } }) };
      if (args[1] === "+media-download" && as(args) === "bot") return denied;
      if (args[1] === "+media-download") {
        await writeFile(resolve(options!.cwd!, `${args[args.indexOf("--output") + 1]}.png`), "image");
        return success;
      }
      throw new Error(`unexpected command ${args}`);
    };
    await checkLarkCli(runner);
    const result = await fetchFeishuDocSnapshot({ url: "https://example.test/wiki/handbook" }, runner);
    expect(result.accessIdentity).toBe("bot");
    expect(result.identityFallback).toBe(true);
    expect(result.resourceMaterialization.status).toBe("complete");
    expect(seen).toEqual(["--version:--as:bot", "docs:+fetch:bot", "docs:+fetch:bot",
      "docs:+media-download:bot", "docs:+media-download:user"]);
  });

  test("body fallback records user identity", async () => {
    const runner: LarkRunner = async args => as(args) === "bot" ? denied : {
      ...success, stdout: JSON.stringify({ ok: true, identity: "user", data: { document: { content: "<p>Body</p>" } } }),
    };
    const result = await fetchFeishuDocSnapshot({ url: "https://example.test/docx/shared", identity: "bot", docsApiVersion: "v2" }, runner);
    expect(result.accessIdentity).toBe("user");
    expect(result.identityFallback).toBe(true);
  });

  test("the official capture phase honors the environment without an identity argument", async () => {
    process.env.CONTEXT_LARK_IDENTITY = "bot";
    const root = makeLarkCaptureTmp();
    const identities: string[] = [];
    try {
      const cwd = await createLarkCaptureProject(root);
      const output = await runLarkCapturePhase({ cwd, phaseId: "capture:lark:handbook", format: "json",
        larkRunner: async args => {
          identities.push(as(args)!);
          if (args.includes("--help")) return { ...success, stdout: "Flags:\n --doc-format string\n --api-version string\n" };
          return { ...success, stdout: JSON.stringify({ ok: true, identity: "bot", data: {
            document: { content: "<title>Handbook</title><p>Body</p>" },
          } }) };
        },
      });
      expect(JSON.parse(output).result.snapshot.changed).toBe(true);
      expect(identities).toEqual(["bot", "bot"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns user error if both identities fail", async () => {
    const seen: string[] = [];
    const runner: LarkRunner = async args => {
      seen.push(as(args)!);
      return denied;
    };
    await expect(fetchFeishuDocSnapshot({ url: "https://example.test/docx/private", identity: "bot", docsApiVersion: "v2" }, runner))
      .rejects.toThrow();
    expect(seen).toEqual(["bot", "user"]);
  });
});
