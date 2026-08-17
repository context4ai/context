import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { detectExternalEnvironmentIssue } from "../../lib/externalEnvironment.js";
import type { ProjectStatus } from "../statusTypes.js";
import type {
  ContextWorkflowCommand,
  ContextWorkflowResource,
} from "./workflowTypes.js";
import {
  debugChildEnvironment,
  recordWorkflowAction,
} from "../debugTrace.js";

export interface WorkflowCommandReceipt {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  stdout: {
    bytes: number;
    sha256: string;
  };
  stderr: {
    bytes: number;
    sha256: string;
    tail?: string;
  };
}

export interface WorkflowAutomaticStep {
  index: number;
  revision: string;
  node: string;
  reasonCode: string;
  effect: ContextWorkflowCommand["effect"];
  command: string;
  resources: {
    required: string[];
    recommended: string[];
  };
  receipt?: WorkflowCommandReceipt;
}

export interface WorkflowRunStop {
  reasonCode: string;
  message: string;
  revision: string;
  node?: string;
  command?: string;
}

export interface WorkflowRunResult {
  protocol: "context.workflow.run.v1";
  state: "complete" | "blocked" | "planned" | "failed" | "max-steps";
  projectRoot: string;
  managed: true;
  steps: WorkflowAutomaticStep[];
  stop: WorkflowRunStop;
  workflow: ProjectStatus["workflow"];
}

export interface WorkflowRunExecutor {
  (input: {
    cwd: string;
    command: string;
  }): Promise<WorkflowCommandReceipt>;
}

function resourceIds(resources: readonly ContextWorkflowResource[]): string[] {
  return resources.map((resource) => resource.id);
}

function blockedStop(
  status: ProjectStatus,
  reasonCode: string,
  message: string,
  command?: string,
): WorkflowRunStop {
  return {
    reasonCode,
    message,
    revision: status.workflow.revision,
    ...(status.workflow.current === undefined
      ? {}
      : { node: status.workflow.current.node }),
    ...(command === undefined ? {} : { command }),
  };
}

export function selectAutomaticWorkflowCommand(
  status: ProjectStatus,
):
  | { command: ContextWorkflowCommand }
  | { stop: WorkflowRunStop; state: WorkflowRunResult["state"] } {
  if (status.workflow.status === "complete") {
    return {
      state: "complete",
      stop: blockedStop(
        status,
        "workflow.until.complete",
        "The current declared scope is complete.",
      ),
    };
  }
  const blockingDiagnostic = status.workflow.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (blockingDiagnostic !== undefined) {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.diagnostic",
        `${blockingDiagnostic.code}: ${blockingDiagnostic.message}`,
      ),
    };
  }
  const route = status.workflow.current;
  if (route === undefined) {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.no-route",
        "No legal workflow route is available.",
      ),
    };
  }
  if (route.configuration !== undefined) {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.configuration-required",
        `Agent configuration is required in ${route.configuration.file}.`,
      ),
    };
  }
  if (route.availability !== "immediate") {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.route-not-immediate",
        "The current route requires a decision or authority that is not resolved.",
      ),
    };
  }
  const unreadRequired = route.resources.required.filter((resource) =>
    resource.read_state === "read-required"
  );
  if (unreadRequired.length > 0) {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.agent-context-required",
        `Read the current route's required resources before automatic execution: ${unreadRequired
          .map((resource) => resource.id)
          .join(", ")}.`,
      ),
    };
  }
  const commands = route.commands.filter((item) =>
    item.availability === "immediate"
  );
  if (commands.length !== 1) {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.command-plan-not-unique",
        commands.length === 0
          ? "The current route has no immediate command."
          : "The current route has more than one immediate command.",
      ),
    };
  }
  const command = commands[0]!;
  if (command.effect === "read") {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.agent-context-required",
        "The current route is read-only and requires Agent interpretation before any write.",
        command.command,
      ),
    };
  }
  if (command.managed_execution !== "automatic") {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.agent-execution-required",
        "The current command is not eligible for automatic managed execution.",
        command.command,
      ),
    };
  }
  let argv: string[];
  try {
    argv = parseContextCommand(command.command);
  } catch (error) {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.command-invalid",
        error instanceof Error
          ? error.message
          : "The current command is not a valid Context CLI command.",
        command.command,
      ),
    };
  }
  const inputIndex = argv.indexOf("--input");
  if (inputIndex >= 0 && argv[inputIndex + 1] === "-") {
    return {
      state: "blocked",
      stop: blockedStop(
        status,
        "workflow.until.agent-input-required",
        "The current command requires an explicit payload on stdin.",
        command.command,
      ),
    };
  }
  return { command };
}

export async function runWorkflowUntilBlockedOrComplete(input: {
  observe: () => Promise<ProjectStatus>;
  execute: WorkflowRunExecutor;
  maxSteps: number;
  dryRun: boolean;
}): Promise<WorkflowRunResult> {
  const steps: WorkflowAutomaticStep[] = [];
  const seen = new Set<string>();
  let status = await input.observe();
  while (true) {
    const selected = selectAutomaticWorkflowCommand(status);
    if ("stop" in selected) {
      return {
        protocol: "context.workflow.run.v1",
        state: selected.state,
        projectRoot: status.projectRoot,
        managed: true,
        steps,
        stop: selected.stop,
        workflow: status.workflow,
      };
    }
    const route = status.workflow.current!;
    const key = `${status.workflow.revision}\u0000${selected.command.command}`;
    if (seen.has(key)) {
      return {
        protocol: "context.workflow.run.v1",
        state: "blocked",
        projectRoot: status.projectRoot,
        managed: true,
        steps,
        stop: blockedStop(
          status,
          "workflow.until.no-progress",
          "The same revision-bound command remained current after execution.",
          selected.command.command,
        ),
        workflow: status.workflow,
      };
    }
    const step: WorkflowAutomaticStep = {
      index: steps.length + 1,
      revision: status.workflow.revision,
      node: route.node,
      reasonCode: route.reason_code,
      effect: selected.command.effect,
      command: selected.command.command,
      resources: {
        required: resourceIds(route.resources.required),
        recommended: resourceIds(route.resources.recommended),
      },
    };
    if (input.dryRun) {
      return {
        protocol: "context.workflow.run.v1",
        state: "planned",
        projectRoot: status.projectRoot,
        managed: true,
        steps: [step],
        stop: blockedStop(
          status,
          "workflow.until.dry-run",
          "The next deterministic workflow command was planned without execution.",
          selected.command.command,
        ),
        workflow: status.workflow,
      };
    }
    if (steps.length >= input.maxSteps) {
      return {
        protocol: "context.workflow.run.v1",
        state: "max-steps",
        projectRoot: status.projectRoot,
        managed: true,
        steps,
        stop: blockedStop(
          status,
          "workflow.until.max-steps",
          `The managed loop reached its ${input.maxSteps}-step limit.`,
          selected.command.command,
        ),
        workflow: status.workflow,
      };
    }
    seen.add(key);
    await recordWorkflowAction({
      projectRoot: status.projectRoot,
      phase: "started",
      step: {
        index: step.index,
        revision: step.revision,
        node: step.node,
        reason_code: step.reasonCode,
        effect: step.effect,
        command: step.command,
        resources: step.resources,
      },
    });
    let receipt: WorkflowCommandReceipt;
    try {
      receipt = await input.execute({
        cwd: status.projectRoot,
        command: selected.command.command,
      });
    } catch (error) {
      steps.push(step);
      await recordWorkflowAction({
        projectRoot: status.projectRoot,
        phase: "completed",
        step: {
          index: step.index,
          revision: step.revision,
          node: step.node,
          outcome: "launch-error",
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return {
        protocol: "context.workflow.run.v1",
        state: "failed",
        projectRoot: status.projectRoot,
        managed: true,
        steps,
        stop: blockedStop(
          status,
          "workflow.until.command-launch-failed",
          error instanceof Error
            ? error.message
            : "The current revision-bound command could not be launched.",
          selected.command.command,
        ),
        workflow: status.workflow,
      };
    }
    steps.push({ ...step, receipt });
    await recordWorkflowAction({
      projectRoot: status.projectRoot,
      phase: "completed",
      step: {
        index: step.index,
        revision: step.revision,
        node: step.node,
        reason_code: step.reasonCode,
        outcome: receipt.exitCode === 0 && !receipt.timedOut ? "success" : "failure",
        receipt,
      },
    });
    if (receipt.exitCode !== 0 || receipt.timedOut) {
      const environmentIssue = selected.command.effect === "external"
        ? detectExternalEnvironmentIssue(receipt.stderr.tail ?? "")
        : undefined;
      return {
        protocol: "context.workflow.run.v1",
        state: "failed",
        projectRoot: status.projectRoot,
        managed: true,
        steps,
        stop: blockedStop(
          status,
          receipt.timedOut
            ? "workflow.until.command-timeout"
            : environmentIssue !== undefined
              ? "workflow.until.external-environment-required"
            : "workflow.until.command-failed",
          receipt.timedOut
            ? "The current revision-bound command timed out."
            : environmentIssue !== undefined
              ? `The external command requires Agent-host access to ${environmentIssue.requiredCapabilities.join(", ")}. Retry the same revision-bound command through the Agent host; do not weaken credential protection.`
            : `The current revision-bound command exited with code ${String(receipt.exitCode)}.`,
          selected.command.command,
        ),
        workflow: status.workflow,
      };
    }
    try {
      status = await input.observe();
    } catch (error) {
      return {
        protocol: "context.workflow.run.v1",
        state: "failed",
        projectRoot: status.projectRoot,
        managed: true,
        steps,
        stop: blockedStop(
          status,
          "workflow.until.reevaluation-failed",
          error instanceof Error
            ? error.message
            : "The workflow could not be re-evaluated after the command receipt.",
        ),
        workflow: status.workflow,
      };
    }
  }
}

export function parseContextCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let active = false;
  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
      active = true;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else token += character;
      active = true;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else if (character === "\\") escaped = true;
      else token += character;
      active = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      active = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      active = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (active) {
        tokens.push(token);
        token = "";
        active = false;
      }
      continue;
    }
    token += character;
    active = true;
  }
  if (quote !== undefined || escaped) {
    throw new Error("Context workflow command contains an incomplete quote or escape.");
  }
  if (active) tokens.push(token);
  if (tokens[0] !== "context") {
    throw new Error("Context workflow command must start with `context`.");
  }
  return tokens.slice(1);
}

export async function executeRevisionBoundContextCommand(input: {
  cwd: string;
  command: string;
  cliEntryPath: string;
  timeoutMs?: number;
}): Promise<WorkflowCommandReceipt> {
  const args = parseContextCommand(input.command);
  const started = Date.now();
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stderrTail = "";
  const timeoutMs = input.timeoutMs ?? 30 * 60 * 1000;
  return await new Promise<WorkflowCommandReceipt>((resolve, reject) => {
    const child = spawn(process.execPath, [input.cliEntryPath, ...args], {
      cwd: input.cwd,
      env: { ...process.env, ...debugChildEnvironment() },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutHash.update(buffer);
      stdoutBytes += buffer.byteLength;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrHash.update(buffer);
      stderrBytes += buffer.byteLength;
      stderrTail = `${stderrTail}${buffer.toString("utf8")}`.slice(-8192);
    });
    child.once("error", reject);
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      resolve({
        exitCode,
        signal,
        durationMs: Date.now() - started,
        timedOut,
        stdout: {
          bytes: stdoutBytes,
          sha256: stdoutHash.digest("hex"),
        },
        stderr: {
          bytes: stderrBytes,
          sha256: stderrHash.digest("hex"),
          ...(stderrTail.length === 0
            ? {}
            : { tail: stderrTail }),
        },
      });
    });
  });
}

export function formatWorkflowRunResult(
  result: WorkflowRunResult,
  format: "text" | "json",
): string {
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  const lines = [
    `${result.state}: ${result.stop.message}`,
    `project: ${result.projectRoot}`,
    `steps: ${result.steps.length}`,
    ...result.steps.map((step) =>
      `${step.index}. ${step.reasonCode} → ${step.command}` +
      (step.receipt === undefined
        ? ""
        : ` (exit=${String(step.receipt.exitCode)}, ${step.receipt.durationMs}ms)`)
    ),
    `stop: ${result.stop.reasonCode}`,
    ...(result.stop.command === undefined
      ? []
      : [`next: ${result.stop.command}`]),
  ];
  return `${lines.join("\n")}\n`;
}
