import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveContextEntry } from "../project/entryCommand.js";
import { initContextProject } from "../project/workspace.js";

describe("single Context agent entry", () => {
  test("plans default initialization outside a workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-entry-init-"));
    try {
      const entry = resolveContextEntry({ cwd: root, language: "zh-CN" });
      expect(entry.state).toBe("workspace-initialization-required");
      expect(entry.workspace.root).toBe(join(root, "context"));
      expect(entry.next_action).toEqual({
        kind: "initialize-workspace",
        command: "context init context --language zh-CN --optimize-docs",
        effect: "write",
        confirmation: "required-unless-explicitly-requested",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("routes an initialized workspace to the Agent Graph status", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-entry-ready-"));
    try {
      await initContextProject({ cwd: root, projectDir: "context", language: "en", dev: true });
      const workspace = join(root, "context");
      const entry = resolveContextEntry({ cwd: workspace, language: "en" });
      expect(entry.state).toBe("workspace-ready");
      expect(entry.workspace.root).toBe(workspace);
      expect(entry.next_action.command).toBe("context status --format json");
      expect(entry.next_action.effect).toBe("read");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relocates from a host root to an initialized default child workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-entry-default-child-"));
    try {
      await initContextProject({ cwd: root, projectDir: "context", language: "en", dev: true });
      const workspace = join(root, "context");
      const entry = resolveContextEntry({ cwd: root, language: "en" });
      expect(entry.state).toBe("workspace-relocation-required");
      expect(entry.workspace).toEqual({ root: workspace, exists: true });
      expect(entry.next_action).toEqual({
        kind: "enter-workspace",
        command: `cd ${workspace} && context status --format json`,
        effect: "read",
        confirmation: "not-required",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns an exact relocation command for a configured child workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-entry-relocate-"));
    try {
      await initContextProject({ cwd: root, projectDir: "knowledge", language: "en", dev: true });
      await writeFile(join(root, "package.json"), `${JSON.stringify({
        name: "host",
        private: true,
        context: { workspaceDir: "knowledge" },
      }, null, 2)}\n`, "utf8");
      const entry = resolveContextEntry({ cwd: root, language: "en", managed: true });
      expect(entry.state).toBe("workspace-relocation-required");
      expect(entry.next_action.command).toBe(
        `cd ${join(root, "knowledge")} && context run --managed --until blocked-or-complete --format json`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preserves explicit initialization options without mutating the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-entry-options-"));
    try {
      await mkdir(join(root, "custom"));
      const entry = resolveContextEntry({
        cwd: root,
        projectDir: "custom",
        name: "Docs KB",
        language: "zh-CN",
        dev: true,
        debug: true,
        optimizeDocs: true,
      });
      expect(entry.state).toBe("workspace-initialization-required");
      expect(entry.next_action.command).toBe(
        "context init custom --language zh-CN --name 'Docs KB' --dev --debug --optimize-docs",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("can explicitly disable document optimization for a new workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-entry-no-optimize-docs-"));
    try {
      const entry = resolveContextEntry({
        cwd: root,
        language: "en",
        optimizeDocs: false,
      });
      expect(entry.next_action.command).toBe(
        "context init context --language en --no-optimize-docs",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
