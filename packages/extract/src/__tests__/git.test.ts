import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getGitCommitHash } from "../git.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("getGitCommitHash", () => {
  test("returns commit hash for git repository", () => {
    const hash = getGitCommitHash(repoRoot);
    expect(hash).not.toBeNull();
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  test("returns null for non-git directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "c4a-extract-"));
    try {
      const hash = getGitCommitHash(tempDir);
      expect(hash).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
