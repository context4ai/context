import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAlignInputPayload } from "../project/proseAlignPayloadInput.js";

describe("prose align payload input", () => {
  test("explains how to recover from a reserved YAML indicator", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-align-payload-"));
    const payloadPath = join(root, "structure.yaml");
    await writeFile(payloadPath, "summary: @scope/package knowledge\n", "utf8");

    try {
      await expect(readAlignInputPayload(payloadPath)).rejects.toMatchObject({
        message: expect.stringContaining("structure payload is invalid YAML/JSON"),
        detail: expect.objectContaining({
          path: payloadPath,
          next: expect.stringContaining("Quote YAML strings that begin with reserved indicators such as @, or provide JSON"),
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
