import { isAbsolute, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE,
  DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE,
} from "@c4a/extract";
import type { LarkExternalResource } from "../lib/larkDocxXml.js";
import {
  applyLarkResourceReplacements,
  materializeLarkResources,
  type LarkResourceCommandRunner,
} from "../lib/larkResourceMaterialization.js";

function argument(args: readonly string[], name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (value === undefined) throw new Error(`missing test argument ${name}`);
  return value;
}

const outputCalls: Array<{ flag: string; output: string; cwd: string | undefined }> = [];
const mediaTokens: string[] = [];

const runner: LarkResourceCommandRunner = async (args, options) => {
  if (args[0] === "docs" && args[1] === "+media-download") {
    const token = argument(args, "--token");
    mediaTokens.push(token);
    const output = argument(args, "--output");
    outputCalls.push({ flag: "--output", output, cwd: options?.cwd });
    const extension = argument(args, "--type") === "whiteboard" ? ".svg" : token.includes("video") ? ".mp4" : ".png";
    await writeFile(resolve(options?.cwd ?? process.cwd(), `${output}${extension}`), token, "utf8");
    return { stdout: JSON.stringify({ ok: true }), stderr: "", exitCode: 0 };
  }
  if (args[0] === "sheets" && args[1] === "+csv-get") {
    const output = argument(args, "--output-path");
    outputCalls.push({ flag: "--output-path", output, cwd: options?.cwd });
    await writeFile(resolve(options?.cwd ?? process.cwd(), output), JSON.stringify({
      actual_range: "A1:B2",
      annotated_csv: "Name,Value\nAlpha,1\n",
      has_more: false,
    }), "utf8");
    return { stdout: JSON.stringify({ data: { complete: true, truncated: false } }), stderr: "", exitCode: 0 };
  }
  if (args[0] === "base" && args[1] === "+record-list") {
    return {
      stdout: JSON.stringify({
        data: {
          fields: ["Name", "Enabled"],
          data: [["Alpha", true]],
          has_more: false,
        },
      }),
      stderr: "",
      exitCode: 0,
    };
  }
  if (args[0] === "whiteboard" && args[1] === "+export") {
    const output = argument(args, "--output");
    outputCalls.push({ flag: "--output", output, cwd: options?.cwd });
    await writeFile(resolve(options?.cwd ?? process.cwd(), output), JSON.stringify({ nodes: [{ id: "node-1", type: "text" }] }), "utf8");
    return { stdout: JSON.stringify({ data: { output_path: output } }), stderr: "", exitCode: 0 };
  }
  throw new Error(`unexpected test command: ${args.join(" ")}`);
};

function resource(
  kind: LarkExternalResource["kind"],
  locator: string,
  attributes: Record<string, string>,
  title?: string,
): LarkExternalResource {
  return { kind, locator, attributes, ...(title === undefined ? {} : { title }) };
}

const policy = {
  videos: "reference-only" as const,
  maxBytesPerResource: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
};

describe("0.6.2 Lark resource materialization", () => {
  test("canonicalizes unordered whiteboard nodes before hashing raw evidence", async () => {
    let exportCount = 0;
    const unorderedRunner: LarkResourceCommandRunner = async (args, options) => {
      if (args[0] === "docs" && args[1] === "+media-download") {
        const output = argument(args, "--output");
        await writeFile(resolve(options?.cwd ?? process.cwd(), `${output}.svg`), "preview", "utf8");
        return { stdout: JSON.stringify({ ok: true }), stderr: "", exitCode: 0 };
      }
      if (args[0] === "whiteboard" && args[1] === "+export") {
        const output = argument(args, "--output");
        const nodes = [{ id: "node-b", type: "text" }, { id: "node-a", type: "shape" }];
        if (exportCount++ % 2 === 1) nodes.reverse();
        await writeFile(resolve(options?.cwd ?? process.cwd(), output), JSON.stringify({ nodes }), "utf8");
        return { stdout: JSON.stringify({ ok: true }), stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected test command: ${args.join(" ")}`);
    };
    const board = resource("whiteboard", "lark:whiteboard:board-token", { token: "board-token" });
    const first = await materializeLarkResources({ resources: [board], runner: unorderedRunner, policy });
    const second = await materializeLarkResources({ resources: [board], runner: unorderedRunner, policy });
    const raw = (result: typeof first) => result.assets.find((asset) => asset.path.endsWith(".json"))?.bytes;

    expect(raw(first)).toEqual(raw(second));
    expect(raw(first) === undefined ? undefined : new TextDecoder().decode(raw(first))).toBe(
      '{"nodes":[{"id":"node-a","type":"shape"},{"id":"node-b","type":"text"}]}\n',
    );
  });

  test("materializes binary and structured resources with closed reporting", async () => {
    outputCalls.length = 0;
    mediaTokens.length = 0;
    const resources: LarkExternalResource[] = [
      resource("image", "lark:image:image-token", { token: "image-token" }, "Example image"),
      resource("sheet", "lark:sheet:sheet-token:sheet-1", { token: "sheet-token", "sheet-id": "sheet-1" }, "Example sheet"),
      resource("base", "lark:base:base-token:table-1:view-1", { token: "base-token", "table-id": "table-1", "view-id": "view-1" }, "Example base"),
      resource("whiteboard", "lark:whiteboard:board-token", { token: "board-token" }, "Example board"),
      {
        ...resource("diagram", "lark:diagram:inline-digest", { "content-hash": "digest" }, "Inline diagram"),
        inline_content: true,
      },
      resource("synced-reference", "lark:synced-reference:source-token:block-1", {
        "src-token": "source-token",
        "src-block-id": "block-1",
      }),
      { ...resource("poll", "lark:poll:poll-1", { id: "poll-1" }), inline_content: true },
    ];
    const result = await materializeLarkResources({
      resources,
      runner,
      policy,
      resolveSyncedReference: async () => ({
        markdown: "Synced body\n\n> Image: Nested image (lark:image:nested-image)",
        resources: [resource("image", "lark:image:nested-image", { token: "nested-image" }, "Nested image")],
      }),
    });

    expect(result.report.status).toBe("complete");
    expect(result.report.discovered).toEqual({
      base: 1,
      diagram: 1,
      image: 2,
      poll: 1,
      sheet: 1,
      "synced-reference": 1,
      whiteboard: 1,
    });
    expect(result.report.materialized).toEqual({
      base: 1,
      diagram: 1,
      image: 2,
      sheet: 1,
      "synced-reference": 1,
      whiteboard: 1,
    });
    expect(result.report.reference_only).toEqual({ poll: 1 });
    expect(result.assets.map((asset) => asset.role).sort()).toEqual(([
      "evidence",
      "evidence",
      "evidence",
      "evidence",
      "evidence",
      "presentation",
      "evidence",
    ] as const).slice().sort());
    expect(result.assets.some((asset) => asset.path.endsWith(".csv"))).toBe(true);
    expect(result.assets.some((asset) => asset.path.includes("/whiteboard/") && asset.path.endsWith(".json"))).toBe(true);

    const markdown = applyLarkResourceReplacements([
      "> Image: Example image (lark:image:image-token)",
      "> Embedded Sheet (lark:sheet:sheet-token:sheet-1)",
      "> Embedded Base (lark:base:base-token:table-1:view-1)",
      "> Whiteboard: lark:whiteboard:board-token",
      "> Diagram: lark:diagram:inline-digest",
      "> Synced reference <!-- lark:synced-reference:source-token:block-1 -->",
    ].join("\n\n"), resources, result.replacements);
    expect(markdown).toContain("![Example image](assets/materialized/image/");
    expect(markdown).toContain("| Name | Value |");
    expect(markdown).toContain("| Alpha | true |");
    expect(markdown).toContain("[Raw snapshot](assets/materialized/whiteboard/");
    expect(markdown).not.toContain("> Diagram: lark:diagram:inline-digest");
    expect(markdown).toContain("Synced body");
    expect(markdown).toContain("![Nested image](assets/materialized/image/");
    expect(outputCalls.length).toBeGreaterThan(0);
    for (const call of outputCalls) {
      expect(call.cwd).toBeDefined();
      expect(isAbsolute(call.cwd ?? "")).toBe(true);
      expect(isAbsolute(call.output)).toBe(false);
      expect(call.output.startsWith("./")).toBe(true);
    }
  });

  test("downloads an image with its XML src token while preserving the block id as locator identity", async () => {
    mediaTokens.length = 0;
    const image = resource("image", "lark:image:stable-block-id", {
      id: "stable-block-id",
      src: "media-file-token",
    });

    const result = await materializeLarkResources({ resources: [image], runner, policy });

    expect(result.report.status).toBe("complete");
    expect(result.report.items[0]).toMatchObject({
      locator: "lark:image:stable-block-id",
      status: "materialized",
    });
    expect(mediaTokens).toEqual(["media-file-token"]);
  });

  test("fails closed when lark-cli returns ok=false with a zero exit code", async () => {
    const failedRunner: LarkResourceCommandRunner = async () => ({
      stdout: JSON.stringify({
        ok: false,
        error: {
          message: "keychain Get failed",
          hint: "run outside the sandbox",
        },
      }),
      stderr: "",
      exitCode: 0,
    });

    const result = await materializeLarkResources({
      resources: [resource("file", "lark:file:file-token", { token: "file-token" })],
      runner: failedRunner,
      policy,
    });

    expect(result.report.status).toBe("error");
    expect(result.report.items[0]?.reason).toContain("keychain Get failed");
    expect(result.report.items[0]?.reason).toContain("run outside the sandbox");
  });

  test("keeps navigation and interactive references offline without invoking lark-cli", async () => {
    const offlineRunner: LarkResourceCommandRunner = async () => {
      throw new Error("reference-only resources must not invoke lark-cli");
    };
    const resources: LarkExternalResource[] = [
      resource("bookmark", "https://example.test/reference", { href: "https://example.test/reference" }),
      resource("cite", "lark:cite:document-token", { "doc-id": "document-token" }),
      resource("document", "lark:document:document-token", { "doc-id": "document-token" }),
      resource("chat", "lark:chat:chat-id", { "chat-id": "chat-id" }),
      resource("embed", "lark:block:embed-id", {}),
      { ...resource("poll", "lark:poll:poll-id", { id: "poll-id" }), inline_content: true },
      resource("video", "lark:video:video-token", { token: "video-token" }),
    ];

    const result = await materializeLarkResources({ resources, runner: offlineRunner, policy });

    expect(result.report.status).toBe("complete");
    expect(result.report.reference_only).toEqual({
      bookmark: 1,
      chat: 1,
      cite: 1,
      document: 1,
      embed: 1,
      poll: 1,
      video: 1,
    });
    expect(result.assets).toEqual([]);
  });

  test("keeps a confirmed missing diagram as an auditable warning", async () => {
    const missingRunner: LarkResourceCommandRunner = async (args, options) => {
      if (args.includes("+media-download")) {
        return {
          stdout: "",
          stderr: JSON.stringify({ error: { code: 2890003, message: "The whiteboard Not Exists" } }),
          exitCode: 1,
        };
      }
      return runner(args, options);
    };
    const diagram = resource("diagram", "lark:diagram:missing-board", { id: "missing-board" });

    const result = await materializeLarkResources({ resources: [diagram], runner: missingRunner, policy });

    expect(result.report.status).toBe("warning");
    expect(result.report.failed).toEqual({ diagram: 1 });
    expect(result.report.items[0]).toMatchObject({
      locator: "lark:diagram:missing-board",
      status: "failed",
      required: true,
      reason_code: DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE,
    });
    const projected = applyLarkResourceReplacements(
      "> Diagram: lark:diagram:missing-board",
      [diagram],
      result.replacements,
    );
    expect(projected).toContain("Resource unavailable:");
    expect(projected).toContain("source no longer exists");
    expect(projected).not.toContain("> Diagram:");

    const retryableRunner: LarkResourceCommandRunner = async (args, options) => {
      if (args.includes("+media-download")) {
        return {
          stdout: "",
          stderr: JSON.stringify({ error: { code: 500, message: "temporary upstream failure" } }),
          exitCode: 1,
        };
      }
      return runner(args, options);
    };
    const retryable = await materializeLarkResources({ resources: [diagram], runner: retryableRunner, policy });
    expect(retryable.report.status).toBe("error");
    expect(retryable.report.items[0]?.reason_code).toBeUndefined();
  });

  test("preserves permission-denied media as an auditable warning without hiding other failures", async () => {
    const permissionRunner: LarkResourceCommandRunner = async () => ({
      stdout: "",
      stderr: JSON.stringify({
        ok: false,
        error: {
          type: "authorization",
          subtype: "permission_denied",
          message: "current identity does not have export permission for this document media",
        },
      }),
      exitCode: 1,
    });
    const image = resource("image", "lark:image:restricted", { token: "restricted" }, "Restricted image");

    const result = await materializeLarkResources({ resources: [image], runner: permissionRunner, policy });

    expect(result.report.status).toBe("warning");
    expect(result.report.items[0]).toMatchObject({
      status: "failed",
      required: true,
      reason_code: DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE,
    });
    const projected = applyLarkResourceReplacements(
      "> Image: Restricted image (lark:image:restricted)",
      [image],
      result.replacements,
    );
    expect(projected).toContain("Resource unavailable:");
    expect(projected).toContain("export permission denied");
    expect(projected).toContain("<!-- lark:image:restricted -->");
    expect(projected).not.toContain("> Image:");
  });

  test("keeps videos reference-only by default and bundles them only by policy", async () => {
    const video = resource("video", "lark:video:video-token", { token: "video-token" }, "Example video");
    const referenced = await materializeLarkResources({ resources: [video], runner, policy });
    expect(referenced.report.reference_only).toEqual({ video: 1 });
    expect(referenced.assets).toEqual([]);

    const bundled = await materializeLarkResources({
      resources: [video],
      runner,
      policy: { ...policy, videos: "bundle" },
    });
    expect(bundled.report.materialized).toEqual({ video: 1 });
    expect(bundled.assets[0]?.mediaType).toBe("video/mp4");
  });

  test("fails closed for missing required resources and resource budgets", async () => {
    const unresolved = resource("image", "lark:image:unresolved", {});
    const missing = await materializeLarkResources({ resources: [unresolved], runner, policy });
    expect(missing.report.status).toBe("error");
    expect(missing.report.items[0]).toMatchObject({ status: "failed", required: true });

    const oversized = await materializeLarkResources({
      resources: [resource("image", "lark:image:image-token", { token: "image-token" })],
      runner,
      policy: { ...policy, maxBytesPerResource: 1 },
    });
    expect(oversized.report.status).toBe("error");
    expect(oversized.report.items[0]?.reason).toContain("maxBytesPerResource=1");
  });
});
