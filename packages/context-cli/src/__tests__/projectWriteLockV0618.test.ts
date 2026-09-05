import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ContextError } from "../lib/errors.js";
import { withProjectWriteLock } from "../project/writeLock.js";

const lockPath = (root: string) => join(root, ".tmp", "context-runtime", "locks", "project-write.lock");

describe("project write lock owner diagnostics", () => {
  test("reuses the outer lock for nested project store operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-write-lock-nested-"));
    try {
      const operations: string[] = [];
      await withProjectWriteLock(root, "outer", async () => {
        operations.push("outer-open");
        await withProjectWriteLock(root, "inner", async () => {
          operations.push("inner");
        });
        operations.push("outer-close");
      });
      expect(operations).toEqual(["outer-open", "inner", "outer-close"]);
      await expect(readFile(join(lockPath(root), "owner.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports the active owner and releases its metadata with the lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-write-lock-owner-"));
    let releaseOwner!: () => void;
    let ownerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      ownerStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });

    try {
      const ownerRun = withProjectWriteLock(root, "capture-lark", async () => {
        ownerStarted();
        await release;
      });
      await started;

      const owner = JSON.parse(await readFile(join(lockPath(root), "owner.json"), "utf8")) as Record<string, unknown>;
      expect(owner).toMatchObject({
        protocol: "context.project-write-lock.v1",
        pid: process.pid,
        operation: "capture-lark",
      });

      try {
        await withProjectWriteLock(root, "compile-prose", async () => undefined);
        throw new Error("expected the concurrent writer to be rejected");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        const contextError = error as ContextError;
        expect(contextError.detail).toMatchObject({
          reason_code: "project-write-in-progress",
          requested_operation: "compile-prose",
          owner: {
            process_state: "running",
            pid: process.pid,
            operation: "capture-lark",
          },
          next_action: { kind: "wait-for-active-context-command" },
        });
      }

      releaseOwner();
      await ownerRun;
      await expect(readFile(join(lockPath(root), "owner.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await withProjectWriteLock(root, "compile-prose", async () => undefined);
    } finally {
      releaseOwner?.();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not treat an unconfirmed stale owner as safe to delete", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-write-lock-stale-"));
    try {
      await mkdir(lockPath(root), { recursive: true });
      await writeFile(join(lockPath(root), "owner.json"), `${JSON.stringify({
        protocol: "context.project-write-lock.v1",
        pid: 2_147_483_647,
        operation: "capture-lark",
        started_at: "2026-08-24T00:00:00.000Z",
      })}\n`, "utf8");

      try {
        await withProjectWriteLock(root, "close-prose", async () => undefined);
        throw new Error("expected the existing lock to be preserved");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).detail).toMatchObject({
          reason_code: "project-write-in-progress",
          owner: {
            process_state: "not-running",
            pid: 2_147_483_647,
            operation: "capture-lark",
          },
          next_action: { kind: "inspect-project-write-lock" },
        });
      }
      expect(await readFile(join(lockPath(root), "owner.json"), "utf8")).toContain("capture-lark");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
