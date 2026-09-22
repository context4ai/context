import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { downloadLarkMedia } from "../lib/larkMediaDownload.js";

describe("same-identity media representations", () => {
  test("successful downloads do not invoke preview", async () => {
    const seen: string[][] = [];
    const result = await downloadLarkMedia({ identity: "bot", token: "image", type: "media", cwd: ".", allowPreview: true,
      runner: async args => { seen.push(args); return { exitCode: 0, stdout: "", stderr: "" }; },
    });
    expect(result).toBe("original");
    expect(seen).toHaveLength(1);
  });

  test.each(["bot", "user"] as const)("permission denial previews once as %s and removes partial originals", async identity => {
    const cwd = await mkdtemp(join(tmpdir(), "context-media-test-"));
    const seen: string[][] = [];
    try {
      const result = await downloadLarkMedia({ identity, token: "image", type: "media", cwd, allowPreview: true,
        runner: async args => {
          seen.push(args);
          if (args[1] === "+media-download") {
            await writeFile(join(cwd, "partial"), "incomplete");
            return { exitCode: 4, stdout: "", stderr: JSON.stringify({ error: { type: "network", code: 403, message: "HTTP 403" } }) };
          }
          expect(await readdir(cwd)).toEqual([]);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });
      expect(result).toBe("preview");
      expect(seen.map(args => args[args.indexOf("--as") + 1])).toEqual([identity, identity]);
      expect(seen[1]).not.toContain("--type");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  test.each([400, 404, 429, 500])("does not preview or switch identity for HTTP %s", async code => {
    let calls = 0;
    await expect(downloadLarkMedia({ identity: "bot", token: "image", type: "media", cwd: ".", allowPreview: true,
      runner: async () => { calls++; return { exitCode: 1, stdout: JSON.stringify({ error: { code } }), stderr: "" }; },
    })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("non-image downloads do not use the image preview fallback", async () => {
    let calls = 0;
    await expect(downloadLarkMedia({ identity: "bot", token: "file", type: "media", cwd: ".",
      runner: async () => { calls++; return { exitCode: 3, stdout: "", stderr: JSON.stringify({ error: { code: 403 } }) }; },
    })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
