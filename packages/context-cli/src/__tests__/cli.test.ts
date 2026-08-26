import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cli_main, createCliProgram, handleCliFailure, isDirectCliInvocation } from "../cli.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

const CLI_MODULE = resolve(import.meta.dir, "..", "cli.ts");

async function runShell(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const outPath = join(cwd, "stdout.log");
  const errPath = join(cwd, "stderr.log");
  const proc = Bun.spawn(
    [process.execPath, CLI_MODULE, ...args],
    {
      cwd,
      env,
      stdout: Bun.file(outPath),
      stderr: Bun.file(errPath),
    },
  );
  const code = await proc.exited;
  const stdout = await readFile(outPath, "utf8").catch(() => "");
  const stderr = await readFile(errPath, "utf8").catch(() => "");
  return { code, stdout, stderr };
}

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await cli_main(["node", "context", ...args]);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }
  return chunks.join("");
}

function writeInstallablePluginRoot(root: string, version = "1.2.3-test"): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, ".agents", "plugins"), { recursive: true });
  mkdirSync(join(root, "claude", ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "codex", ".codex-plugin"), { recursive: true });
  mkdirSync(join(root, "codex", "skills", "context"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "marketplace.json"), "{}\n", "utf8");
  writeFileSync(join(root, ".agents", "plugins", "marketplace.json"), "{}\n", "utf8");
  writeFileSync(join(root, "claude", ".claude-plugin", "plugin.json"), `${JSON.stringify({ version })}\n`, "utf8");
  writeFileSync(join(root, "codex", ".codex-plugin", "plugin.json"), `${JSON.stringify({ version })}\n`, "utf8");
  writeFileSync(join(root, "codex", "skills", "context", "SKILL.md"), "---\nname: context\ndescription: test\n---\n", "utf8");
}

describe("CLI error handling", () => {
  test("detects direct invocation through a symlinked bin path", () => {
    const dir = mkdtempSync(join(tmpdir(), "context-cli-direct-"));
    try {
      const realDir = join(dir, "real dist");
      mkdirSync(realDir, { recursive: true });
      const realPath = join(realDir, "cli.js");
      const linkPath = join(dir, "context");
      writeFileSync(realPath, "console.log('context')\n", "utf8");
      symlinkSync(realPath, linkPath);

      expect(isDirectCliInvocation(pathToFileURL(realpathSync(realPath)).href, linkPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("maps ContextError to its exit code and prints detail", () => {
    const chunks: string[] = [];
    let exitCode = -1;

    const code = handleCliFailure(new ContextError(ExitCode.UserError, "invalid input", {
      category: "user-input-invalid",
      field: "source_ref",
    }), {
      stderr: {
        write: (chunk: string) => {
          chunks.push(chunk);
          return true;
        },
      },
      exit: (nextCode: number) => {
        exitCode = nextCode;
      },
    });

    expect(code).toBe(ExitCode.UserError);
    expect(exitCode).toBe(ExitCode.UserError);
    const stderr = chunks.join("");
    expect(stderr).toContain("✗ failed: user-input-invalid");
    expect(stderr).toContain("invalid input");
    expect(stderr).toContain('"field": "source_ref"');
    expect(stderr).not.toContain('"category"');
  });

  test("falls back to exit code 1 for generic errors", () => {
    let exitCode = -1;

    const code = handleCliFailure(new Error("boom"), {
      stderr: { write: () => true },
      exit: (nextCode: number) => {
        exitCode = nextCode;
      },
    });

    expect(code).toBe(1);
    expect(exitCode).toBe(1);
  });

  test("prints stable machine codes for coded extraction errors", () => {
    const chunks: string[] = [];
    const error = Object.assign(new Error("no entries"), { code: "NO_ENTRY_DETECTED" });
    handleCliFailure(error, {
      stderr: { write: (chunk: string) => { chunks.push(chunk); return true; } },
      exit: () => undefined,
    });
    expect(chunks.join("")).toContain('"code":"NO_ENTRY_DETECTED"');
  });

  test("infers mount-matrix category for errors without detail", () => {
    const chunks: string[] = [];

    handleCliFailure(new ContextError(
      ExitCode.WorkspaceStateError,
      "section kind 'spec' cannot be mounted on node type 'domain'",
    ), {
      stderr: { write: (chunk: string) => { chunks.push(chunk); return true; } },
      exit: () => undefined,
    });

    expect(chunks.join("")).toContain("✗ failed: mount-matrix-violation");
  });

  test("top-level help exposes current project workflow commands only", () => {
    const help = createCliProgram().helpInformation();
    expect(help).toStartWith("\x1b[32m+");
    expect(help).toContain("| Local knowledge workspace CLI |");
    expect(help).toContain("status");
    expect(help).toContain("run");
    expect(help).toContain("review");
    expect(help).toContain("close");
    expect(help).toMatch(/deriving\s+structure and running final verification/u);
    expect(help).not.toContain("deterministic indexes");
    expect(help).toContain("verify");
    expect(help).toContain("Quick start manual:");
    expect(help).toContain("docs/quickstart.md");
    expect(help).toContain("plugin installation, project initialization, and agent workflow handoff");
    expect(help).not.toContain("  logs");
    for (const command of ["capture", "align", "compile", "workflow", "reconcile", "mdrive", "query", "drop", "purge", "extract", "schema", "protocol", "workspace", "config", "cache", "doctor"]) {
      expect(help).not.toMatch(new RegExp(`^  ${command}(?:\\s|$)`, "mu"));
    }
  });

  test("run help is the current phase entrypoint for prose align and compile payloads", () => {
    const run = createCliProgram().commands.find((cmd) => cmd.name() === "run")?.helpInformation() ?? "";
    expect(run).toContain("Inspect or run a declared project phase");
    expect(run).toContain("--view <view>");
    expect(run).toContain("--validate");
    expect(run).toContain("--stage");
    expect(run).toContain("--input <file>");
    expect(run).toContain("--auto-promote");
    expect(run).toContain("--managed");
  });

  test("managed session controls are explicit and discoverable", () => {
    const program = createCliProgram();
    const status = program.commands.find((cmd) => cmd.name() === "status")?.helpInformation() ?? "";
    const review = program.commands.find((cmd) => cmd.name() === "review");
    const approveAll = review?.commands.find((cmd) => cmd.name() === "approve-all")?.helpInformation() ?? "";

    expect(status).toContain("--managed");
    expect(approveAll).toContain("--managed");
    expect(approveAll).toContain("--force");
    expect(approveAll).toContain("--all");
    expect(approveAll).toContain("current-conversation");
  });

  test("removed workflow commands are not accepted, even as hidden aliases", async () => {
    for (const command of ["capture", "align", "compile", "workflow", "reconcile", "mdrive", "query", "drop", "purge", "extract", "schema", "protocol", "workspace", "config", "cache", "doctor"]) {
      let thrown: unknown;
      try {
        await cli_main(["node", "context", command]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, command).toBeInstanceOf(ContextError);
      expect((thrown as Error).message, command).toBe(`unknown command '${command}'`);
    }
  });

  test("removed workflow commands are rejected even when help is requested", async () => {
    for (const command of ["capture", "align", "compile", "workflow", "reconcile", "mdrive", "query", "drop", "purge"]) {
      let thrown: unknown;
      try {
        await cli_main(["node", "context", command, "--help"]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, command).toBeInstanceOf(ContextError);
      expect((thrown as Error).message, command).toBe(`unknown command '${command}'`);
    }
  });

  test("top-level --version still prints the CLI package version", async () => {
    const stdout: string[] = [];
    const program = createCliProgram()
      .exitOverride()
      .configureOutput({
        writeOut: (chunk: string) => {
          stdout.push(chunk);
        },
      });

    let thrown: unknown;
    try {
      await program.parseAsync(["node", "context", "--version"]);
    } catch (error) {
      thrown = error;
    }

    const packageJson = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8")) as { version: string };
    expect((thrown as { code?: string }).code).toBe("commander.version");
    expect(stdout.join("")).toBe(`${packageJson.version}\n`);
  });

  test("status stops at a host repository with a missing configured Context workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "ctx-cli-host-missing-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "index.ts"), "export default null;\n", "utf8");
      writeFileSync(join(root, "package.json"), `${JSON.stringify({
        name: "host-repo",
        private: true,
        type: "module",
        context: {
          project: true,
          entry: "src/index.ts",
          workspaceDir: "context",
        },
      }, null, 2)}\n`, "utf8");

      const result = await runShell(root, ["status"]);

      expect(result.code).toBe(ExitCode.WorkspaceStateError);
      expect(result.stderr).toContain("workspace-not-found");
      expect(result.stderr).toContain("configured Context workspace is missing");
      expect(result.stderr).toContain("context init");
      expect(result.stderr).toContain("use --dev only for local SDK link tests");
      expect(result.stderr).toContain("read AGENTS.md");
      expect(result.stderr).toContain("context status");
      expect(result.stderr).not.toContain("project-entry-invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("status refuses the host repository when the configured child workspace exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "ctx-cli-host-existing-"));
    try {
      await runCliInDir(root, ["init", "context", "--dev"]);
      writeFileSync(join(root, "package.json"), `${JSON.stringify({
        name: "host-repo",
        private: true,
        type: "module",
        context: {
          workspaceDir: "context",
        },
      }, null, 2)}\n`, "utf8");

      const hostResult = await runShell(root, ["status"]);
      expect(hostResult.code).toBe(ExitCode.WorkspaceStateError);
      expect(hostResult.stderr).toContain("workspace-not-found");
      expect(hostResult.stderr).toContain("status must run inside the configured Context workspace");
      expect(hostResult.stderr).toContain("cd");
      expect(hostResult.stderr).toContain("context status");

      const workspaceResult = await runShell(join(root, "context"), ["status"]);
      expect(workspaceResult.code).toBe(0);
      expect(workspaceResult.stdout).toContain("state: route.source.boundary-required");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("init parser creates a project-local skeleton without project agent adapters", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-parser-root-"));
    try {
      const stdout = await runCliInDir(cwd, [
        "init",
        "parser-kb",
        "--name",
        "Parser KB",
      ]);

      expect(stdout).toContain('✓ initialized "parser-kb"');
      expect(existsSync(join(cwd, ".context"))).toBe(false);
      expect(existsSync(join(cwd, "parser-kb", "src", "index.ts"))).toBe(true);
      expect(existsSync(join(cwd, "parser-kb", "sources", "repo", "index.yaml"))).toBe(true);
      expect(existsSync(join(cwd, "parser-kb", "unapproved"))).toBe(false);
      expect(existsSync(join(cwd, "parser-kb", ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);
      expect(existsSync(join(cwd, "parser-kb", "knowledge"))).toBe(true);
      expect(existsSync(join(cwd, "parser-kb", "dist"))).toBe(true);
      expect(existsSync(join(cwd, "parser-kb", ".tmp", "agent-payloads"))).toBe(true);
      expect(existsSync(join(cwd, "parser-kb", "README.md"))).toBe(true);
      expect(existsSync(join(cwd, "parser-kb", "AGENTS.md"))).toBe(true);
      expect(existsSync(join(cwd, "parser-kb", ".claude"))).toBe(false);
      expect(existsSync(join(cwd, "parser-kb", ".codex"))).toBe(false);
      const readme = await readFile(join(cwd, "parser-kb", "README.md"), "utf8");
      const agents = await readFile(join(cwd, "parser-kb", "AGENTS.md"), "utf8");
      expect(stdout).toContain("bun install");
      expect(stdout).toContain('TMPDIR="$PWD/.tmp/install" bun install');
      expect(stdout).toContain("read `AGENTS.md` before running `context status`");
      expect(stdout).not.toContain("bun install && context status");
      expect(readme).toContain("context status");
      expect(readme).toContain("context plugin install");
      expect(readme).toContain('TMPDIR="$PWD/.tmp/install" bun install');
      expect(readme).toContain("`.tmp/install/`: workspace-local temporary files");
      expect(readme).toContain("`.tmp/agent-payloads/`: optional Agent-owned command inputs");
      expect(readme).toContain("Initialization creates it");
      expect(readme).toContain("`.tmp/context-runtime/`: disposable runtime files");
      expect(agents).toContain("Treat `workflow.current` as the current-step authority");
      expect(agents).toContain("Read every `resources.required` item");
      expect(agents).toContain("do not run another status command");
      expect(agents).toContain(
        "Fully managed mode applies only when the user explicitly requests it in the current conversation",
      );
      expect(agents).toContain("use `context status --managed --format json` for every status evaluation");
      expect(agents).toContain("never store or reuse that authority");
      expect(agents).toContain("Managed approval still uses only the atomic command returned by managed status");
      expect(agents).toContain("exact phrase `强制批准`");
      expect(agents).toContain("Prefer `.tmp/agent-payloads/` for Agent-authored transient command inputs");
      expect(agents).toContain("Initialization creates the directory");
      expect(agents).toContain("not a CLI requirement");
      expect(readme).not.toContain("bun run context -- status");
      expect(agents).toContain("context status");
      expect(agents).toContain("context plugin install");
      expect(agents).not.toContain("## State Boundaries");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("init clearly reports when it reuses an existing workspace", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-existing-root-"));
    try {
      await runCliInDir(cwd, ["init", "existing-kb"]);
      const stdout = await runCliInDir(cwd, ["init", "existing-kb"]);

      expect(stdout).toContain("existing workspace reused");
      expect(stdout).toContain("created → 0");
      expect(stdout).toContain("preserved existing files →");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plugin install dry-run uses the bundled marketplace root", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-plugin-install-"));
    const pluginRoot = join(cwd, "plugins");
    const previous = process.env.C4A_CONTEXT_PLUGIN_ROOT;
    const previousCodexHome = process.env.CODEX_HOME;
    const previousClaudeHome = process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME;
    try {
      writeInstallablePluginRoot(pluginRoot);
      process.env.C4A_CONTEXT_PLUGIN_ROOT = pluginRoot;
      process.env.CODEX_HOME = join(cwd, "codex-home");
      process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME = join(cwd, "claude-home");
      const stdout = await runCliInDir(cwd, ["plugin", "install", "--dry-run"]);

      expect(stdout).toContain("planned context plugin");
      expect(stdout).toContain("marketplace:");
      expect(stdout).toContain("manual install: use the marketplace path above as the plugin marketplace root.");
      expect(stdout).toContain("✅ claude: planned");
      expect(stdout).toContain("✅ codex: planned");
      expect(stdout).toContain("details:");
      expect(stdout).toContain(pluginRoot);
      expect(stdout).toContain("claude 'plugin' 'marketplace' 'add'");
      expect(stdout).toContain("claude 'plugin' 'install'");
      expect(stdout).toContain("codex 'plugin' 'marketplace' 'add'");
      expect(stdout).toContain("config.toml");
      expect(stdout).toContain("materialize Codex plugin cache");
      expect(stdout).toContain(join("plugins", "cache", "c4a", "c4a", "1.2.3-test"));
    } finally {
      if (previous === undefined) delete process.env.C4A_CONTEXT_PLUGIN_ROOT;
      else process.env.C4A_CONTEXT_PLUGIN_ROOT = previous;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      if (previousClaudeHome === undefined) delete process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME;
      else process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME = previousClaudeHome;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plugin install dry-run reports stale global plugin state pruning", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-plugin-prune-"));
    const pluginRoot = join(cwd, "plugins");
    const codexHome = join(cwd, "codex-home");
    const claudeHome = join(cwd, "claude-home");
    const previousPluginRoot = process.env.C4A_CONTEXT_PLUGIN_ROOT;
    const previousCodexHome = process.env.CODEX_HOME;
    const previousClaudeHome = process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME;
    try {
      writeInstallablePluginRoot(pluginRoot);
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(join(codexHome, "config.toml"), [
        "[marketplaces.context]",
        'source = "/tmp/c4a-plugins"',
        "",
        "[marketplaces.c4a]",
        'source = "/tmp/c4a-plugins"',
        "",
        '[plugins."context@context"]',
        "enabled = true",
        "",
      ].join("\n"), "utf8");
      mkdirSync(join(codexHome, "plugins", "cache", "c4a", "context", "0.5.42-alpha.1"), { recursive: true });
      const orphanClaudeCache = join(claudeHome, ".claude", "plugins", "cache", "c4a", "c4a", "0.5.42-alpha.1");
      mkdirSync(orphanClaudeCache, { recursive: true });
      writeFileSync(join(orphanClaudeCache, ".orphaned_at"), "test\n", "utf8");

      process.env.C4A_CONTEXT_PLUGIN_ROOT = pluginRoot;
      process.env.CODEX_HOME = codexHome;
      process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME = claudeHome;
      const stdout = await runCliInDir(cwd, ["plugin", "install", "--dry-run"]);

      expect(stdout).toContain("prune stale Codex config blocks: marketplaces.context, marketplaces.c4a, plugins.\"context@context\"");
      expect(stdout).toContain("prune cached Codex c4a/context version(s): 0.5.42-alpha.1");
      expect(stdout).toContain("prune orphaned Claude context cache version(s): c4a/c4a/0.5.42-alpha.1");
      expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toContain("[marketplaces.context]");
      expect(existsSync(join(codexHome, "plugins", "cache", "c4a", "context", "0.5.42-alpha.1"))).toBe(true);
      expect(existsSync(orphanClaudeCache)).toBe(true);
    } finally {
      if (previousPluginRoot === undefined) delete process.env.C4A_CONTEXT_PLUGIN_ROOT;
      else process.env.C4A_CONTEXT_PLUGIN_ROOT = previousPluginRoot;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      if (previousClaudeHome === undefined) delete process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME;
      else process.env.C4A_CLAUDE_PLUGIN_CACHE_HOME = previousClaudeHome;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plugin install refreshes the manifest-version Codex cache before pruning old versions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-plugin-versioned-cache-"));
    const pluginRoot = join(cwd, "plugins");
    const codexHome = join(cwd, "codex-home");
    const binDir = join(cwd, "bin");
    const version = "0.6.0-dev.4";
    try {
      writeInstallablePluginRoot(pluginRoot, version);
      const cacheRoot = join(codexHome, "plugins", "cache", "c4a", "c4a");
      const currentCache = join(cacheRoot, version);
      mkdirSync(join(currentCache, "skills", "context"), { recursive: true });
      writeFileSync(join(currentCache, "stale.txt"), "remove me\n", "utf8");
      writeFileSync(join(currentCache, "skills", "context", "SKILL.md"), "old dev content\n", "utf8");
      mkdirSync(join(cacheRoot, "0.5.9"), { recursive: true });
      mkdirSync(join(cacheRoot, "local"), { recursive: true });
      mkdirSync(binDir, { recursive: true });
      const codexPath = join(binDir, "codex");
      writeFileSync(codexPath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(codexPath, 0o755);

      const result = await runShell(cwd, ["plugin", "install", "--agent", "codex"], {
        C4A_CONTEXT_PLUGIN_ROOT: pluginRoot,
        CODEX_HOME: codexHome,
        PATH: `${binDir}:/usr/bin:/bin`,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`materialize Codex plugin cache:`);
      expect(result.stdout).toContain(currentCache);
      expect(result.stdout).toContain("prune cached Codex c4a/c4a version(s): 0.5.9, local");
      expect(readFileSync(join(currentCache, "skills", "context", "SKILL.md"), "utf8")).toContain("name: context");
      expect(existsSync(join(currentCache, "stale.txt"))).toBe(false);
      expect(existsSync(join(cacheRoot, "0.5.9"))).toBe(false);
      expect(existsSync(join(cacheRoot, "local"))).toBe(false);
      expect(readdirSync(cacheRoot).sort()).toEqual([version]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plugin install continues available agents when codex is missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-plugin-partial-"));
    const pluginRoot = join(cwd, "plugins");
    const binDir = join(cwd, "bin");
    try {
      writeInstallablePluginRoot(pluginRoot);
      mkdirSync(binDir, { recursive: true });
      const claudePath = join(binDir, "claude");
      writeFileSync(claudePath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(claudePath, 0o755);

      const result = await runShell(cwd, ["plugin", "install"], {
        C4A_CONTEXT_PLUGIN_ROOT: pluginRoot,
        C4A_CLAUDE_PLUGIN_CACHE_HOME: join(cwd, "claude-home"),
        CODEX_HOME: join(cwd, "codex-home"),
        PATH: `${binDir}:/usr/bin:/bin`,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("⚠ installed context plugin");
      expect(result.stdout).toContain("✅ claude: installed");
      expect(result.stdout).toContain("⚠ codex: skipped — codex CLI was not found on PATH");
      expect(result.stdout).toContain("next: Install Codex CLI or rerun `context plugin install --agent claude`");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plugin install replaces an existing Claude plugin and removes superseded caches", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-plugin-update-"));
    const pluginRoot = join(cwd, "plugins");
    const binDir = join(cwd, "bin");
    const commandLog = join(cwd, "claude-commands.log");
    try {
      writeInstallablePluginRoot(pluginRoot);
      writeFileSync(join(pluginRoot, "claude", ".claude-plugin", "plugin.json"), JSON.stringify({
        name: "c4a",
        version: "0.6.0-beta.2",
      }), "utf8");
      const claudeHome = join(cwd, "claude-home");
      mkdirSync(join(claudeHome, ".claude", "plugins", "cache", "c4a", "c4a", "0.6.0-alpha.6"), {
        recursive: true,
      });
      mkdirSync(join(claudeHome, ".claude", "plugins", "cache", "c4a", "c4a", "0.6.0-beta.2"), {
        recursive: true,
      });
      mkdirSync(binDir, { recursive: true });
      const claudePath = join(binDir, "claude");
      writeFileSync(claudePath, [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$CLAUDE_COMMAND_LOG"',
        'if [ "$1 $2 $3" = "plugin list --json" ]; then',
        `  printf '%s\\n' '[{"id":"context@c4a","version":"0.6.0-alpha.6"}]'`,
        "fi",
        "exit 0",
        "",
      ].join("\n"), "utf8");
      chmodSync(claudePath, 0o755);

      const result = await runShell(cwd, ["plugin", "install", "--agent", "claude"], {
        C4A_CONTEXT_PLUGIN_ROOT: pluginRoot,
        C4A_CLAUDE_PLUGIN_CACHE_HOME: claudeHome,
        CLAUDE_COMMAND_LOG: commandLog,
        PATH: `${binDir}:/usr/bin:/bin`,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("claude 'plugin' 'uninstall' 'context@c4a' '--scope' 'user'");
      expect(result.stdout).toContain("claude 'plugin' 'install' 'c4a@c4a' '--scope' 'user'");
      expect(result.stdout).toContain("prune superseded Claude c4a/c4a version(s): 0.6.0-alpha.6");
      const commands = readFileSync(commandLog, "utf8");
      expect(commands).toContain("plugin list --json");
      expect(commands).toContain("plugin uninstall context@c4a --scope user");
      expect(commands).toContain("plugin install c4a@c4a --scope user");
      expect(existsSync(join(claudeHome, ".claude", "plugins", "cache", "c4a", "c4a", "0.6.0-alpha.6"))).toBe(false);
      expect(existsSync(join(claudeHome, ".claude", "plugins", "cache", "c4a", "c4a", "0.6.0-beta.2"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plugin install fails when the only requested agent is missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-plugin-missing-agent-"));
    const pluginRoot = join(cwd, "plugins");
    const binDir = join(cwd, "bin");
    try {
      writeInstallablePluginRoot(pluginRoot);
      mkdirSync(binDir, { recursive: true });
      const result = await runShell(cwd, ["plugin", "install", "--agent", "codex"], {
        C4A_CONTEXT_PLUGIN_ROOT: pluginRoot,
        CODEX_HOME: join(cwd, "codex-home"),
        PATH: `${binDir}:/usr/bin:/bin`,
      });

      expect(result.code).toBe(ExitCode.ExternalToolError);
      expect(result.stderr).toContain("✗ failed: external-tool-failed");
      expect(result.stderr).toContain("no requested agent plugin target could be installed");
      expect(result.stderr).toContain("codex CLI was not found on PATH");
      expect(result.stderr).toContain("context plugin install --agent claude");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("plugin path reports the bundled marketplace root", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-plugin-path-"));
    const pluginRoot = join(cwd, "plugins");
    const previous = process.env.C4A_CONTEXT_PLUGIN_ROOT;
    try {
      writeInstallablePluginRoot(pluginRoot);
      process.env.C4A_CONTEXT_PLUGIN_ROOT = pluginRoot;
      const stdout = await runCliInDir(cwd, ["plugin", "path"]);

      expect(stdout).toContain("resolved context plugin");
      expect(stdout).toContain(pluginRoot);
    } finally {
      if (previous === undefined) delete process.env.C4A_CONTEXT_PLUGIN_ROOT;
      else process.env.C4A_CONTEXT_PLUGIN_ROOT = previous;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("init help exposes project options and hides legacy workspace flags", async () => {
    const help = createCliProgram().commands.find((cmd) => cmd.name() === "init")?.helpInformation() ?? "";
    expect(help).toContain("[project-dir]");
    expect(help).toContain("--name <name>");
    expect(help).not.toContain("--adapter");
    expect(help).not.toContain("--scenario");
    expect(help).not.toContain("--layout");
    expect(help).toContain("--language <language>");
    expect(help).toContain("en | zh-CN");
    expect(help).toContain("--debug");
    expect(help).not.toContain("--with-aspects");
    expect(help).not.toContain("--with-all-aspects");
    expect(help).not.toContain("--no-aspects");
    expect(help).not.toContain("--minimal");
  });

  test("init parser rejects retired legacy aspect flags", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-parser-retired-aspects-"));
    try {
      const result = await runShell(cwd, [
        "init",
        "legacy-kb",
        "--with-aspects",
        "code",
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("unknown option '--with-aspects'");
      expect(existsSync(join(cwd, ".context"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("init rejects unsupported workspace template languages before writing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-invalid-language-"));
    try {
      const result = await runShell(cwd, [
        "init",
        "localized-kb",
        "--language",
        "fr",
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("--language must be en or zh-CN");
      expect(existsSync(join(cwd, "localized-kb"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("init parser accepts cwd project initialization", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-cli-parser-cwd-"));
    try {
      const stdout = await runCliInDir(cwd, [
        "init",
        ".",
        "--name",
        "Current KB",
      ]);

      expect(stdout).toContain('✓ initialized "current-kb"');
      expect(stdout).not.toContain("pipeline");
      expect(existsSync(join(cwd, ".context"))).toBe(false);
      expect(existsSync(join(cwd, "src", "index.ts"))).toBe(true);
      expect(existsSync(join(cwd, "sources", "repo", "index.yaml"))).toBe(true);
      expect(existsSync(join(cwd, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("context verify", () => {
  test("top-level verify requires a context project workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "verify-json-not-workspace-"));
    try {
      const result = await runShell(root, ["verify", "--format", "json"]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("workspace-not-found");
      expect(result.stderr).toContain("verify requires a context project workspace");
      expect(result.stdout).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
