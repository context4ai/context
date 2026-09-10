import { contextWorkflowProviderPath } from "./workflow/workflowProvider.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  findContextProjectRoot,
  findContextWorkspaceExpectation,
  isContextProjectRoot,
  resolveContextProjectInitTarget,
  type ProjectLanguage,
} from "./workspace.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

export interface ContextEntryInput {
  cwd: string;
  projectDir?: string;
  name?: string;
  language: ProjectLanguage;
  dev?: boolean;
  debug?: boolean;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
}

export interface ContextEntryResult {
  schema: "context.entry.v1";
  state:
    | "workspace-ready"
    | "workspace-relocation-required"
    | "workspace-initialization-required";
  cwd: string;
  workspace: {
    root: string;
    exists: boolean;
  };
  guidance?: {
    knowledge_updates: { path: string };
    workspace_prepare: { path: string };
    workspace_commit: { path: string };
    workspace_restore: { path: string };
  };
  next_action: {
    kind: "evaluate-workflow" | "enter-workspace" | "initialize-workspace";
    command: string;
    effect: "read" | "write";
    confirmation: "not-required" | "required-unless-explicitly-requested";
  };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/=-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function workflowCommand(input: ContextEntryInput): string {
  const authorities = input.authorities ?? [];

  return [
    "context status --format json",
    ...(input.managed === true ? ["--managed"] : []),
    ...authorities.map((authority) => `--authority ${shellQuote(authority)}`),
  ].join(" ");
}

function initCommand(input: ContextEntryInput, projectDir: string): string {
  const args = [
    "context",
    "init",
    projectDir,
    "--language",
    input.language,
  ];
  if (input.name !== undefined) args.push("--name", input.name);
  if (input.dev === true) args.push("--dev");
  if (input.debug === true) args.push("--debug");
  return args.map(shellQuote).join(" ");
}

function readyResult(
  input: ContextEntryInput,
  projectRoot: string,
  relocation: boolean,
): ContextEntryResult {
  const command = workflowCommand(input);
  return {
    schema: "context.entry.v1",
    guidance: {
      knowledge_updates: { path: resolve(dirname(contextWorkflowProviderPath()), "resources/procedures/knowledge-updates.md") },
      workspace_prepare: { path: resolve(dirname(contextWorkflowProviderPath()), "resources/procedures/workspace-prepare.md") },
      workspace_commit: { path: resolve(dirname(contextWorkflowProviderPath()), "resources/procedures/workspace-commit.md") },
      workspace_restore: { path: resolve(dirname(contextWorkflowProviderPath()), "resources/procedures/workspace-restore.md") },
    },
    state: relocation ? "workspace-relocation-required" : "workspace-ready",
    cwd: resolve(input.cwd),
    workspace: {
      root: projectRoot,
      exists: true,
    },
    next_action: {
      kind: relocation ? "enter-workspace" : "evaluate-workflow",
      command: relocation
        ? `cd ${shellQuote(projectRoot)} && ${command}`
        : command,
      effect: "read",
      confirmation: "not-required",
    },
  };
}

export function resolveContextEntry(input: ContextEntryInput): ContextEntryResult {
  const cwd = resolve(input.cwd);
  if (input.projectDir !== undefined) {
    const target = resolveContextProjectInitTarget(cwd, input.projectDir);
    if (existsSync(target) && isContextProjectRoot(target)) {
      return readyResult(input, target, target !== cwd);
    }
    return {
      schema: "context.entry.v1",
      state: "workspace-initialization-required",
      cwd,
      workspace: {
        root: target,
        exists: existsSync(target),
      },
      next_action: {
        kind: "initialize-workspace",
        command: initCommand(input, input.projectDir),
        effect: "write",
        confirmation: "required-unless-explicitly-requested",
      },
    };
  }

  const found = findContextProjectRoot(cwd);
  if (found !== null) return readyResult(input, found.projectRoot, found.projectRoot !== cwd);

  const expectation = findContextWorkspaceExpectation(cwd);
  if (expectation !== null) {
    if (expectation.exists && isContextProjectRoot(expectation.workspaceRoot)) {
      return readyResult(input, expectation.workspaceRoot, true);
    }
    return {
      schema: "context.entry.v1",
      state: "workspace-initialization-required",
      cwd,
      workspace: {
        root: expectation.workspaceRoot,
        exists: expectation.exists,
      },
      next_action: {
        kind: "initialize-workspace",
        command: `cd ${shellQuote(expectation.markerRoot)} && ${initCommand(input, expectation.workspaceDir)}`,
        effect: "write",
        confirmation: "required-unless-explicitly-requested",
      },
    };
  }

  const target = resolveContextProjectInitTarget(cwd, undefined);
  if (isContextProjectRoot(target)) {
    return readyResult(input, target, true);
  }
  return {
    schema: "context.entry.v1",
    state: "workspace-initialization-required",
    cwd,
    workspace: {
      root: target,
      exists: existsSync(target),
    },
    next_action: {
      kind: "initialize-workspace",
      command: initCommand(input, "context"),
      effect: "write",
      confirmation: "required-unless-explicitly-requested",
    },
  };
}

export function formatContextEntry(result: ContextEntryResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
