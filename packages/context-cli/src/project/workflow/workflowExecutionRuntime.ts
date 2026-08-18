import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import type { ContextWorkflowCommand } from "./workflowTypes.js";
import {
  ExecutionScope,
  type ExecutionScopeReceipt,
} from "./executionScope.js";
import {
  debugChildEnvironment,
  recordWorkflowExecutionScope,
} from "../debugTrace.js";
import {
  parseContextCommand,
  type WorkflowCommandReceipt,
} from "./workflowRun.js";

export interface WorkflowInProcessExecutor {
  supports(input: {
    cwd: string;
    args: string[];
    effect: ContextWorkflowCommand["effect"];
  }): boolean;
  execute(input: {
    cwd: string;
    args: string[];
    effect: ContextWorkflowCommand["effect"];
  }): Promise<void>;
}

interface StreamDigest {
  bytes: number;
  sha256: string;
  tail?: string;
}

function digestText(value: string, includeTail: boolean): StreamDigest {
  const bytes = Buffer.byteLength(value);
  return {
    bytes,
    sha256: createHash("sha256").update(value).digest("hex"),
    ...(includeTail && value.length > 0 ? { tail: value.slice(-8192) } : {}),
  };
}

function errorReceipt(
  error: unknown,
  started: number,
  output?: { stdout: StreamDigest; stderr: StreamDigest },
): WorkflowCommandReceipt {
  const message = error instanceof Error ? error.message : String(error);
  const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "number"
    ? error.code
    : 1;
  return {
    exitCode: code,
    signal: null,
    durationMs: Date.now() - started,
    timedOut: false,
    stdout: output?.stdout ?? digestText("", false),
    stderr: output?.stderr ?? digestText(message, true),
  };
}

async function captureProcessOutput(
  scope: ExecutionScope,
  action: () => Promise<void>,
): Promise<{ stdout: StreamDigest; stderr: StreamDigest; error?: unknown }> {
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stderrTail = "";
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    stdoutHash.update(buffer);
    stdoutBytes += buffer.byteLength;
    const callback = args.find((value): value is () => void => typeof value === "function");
    callback?.();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    stderrHash.update(buffer);
    stderrBytes += buffer.byteLength;
    stderrTail = `${stderrTail}${buffer.toString("utf8")}`.slice(-8192);
    const callback = args.find((value): value is () => void => typeof value === "function");
    callback?.();
    return true;
  }) as typeof process.stderr.write;
  const outputHandle = scope.defer("process-output-capture", () => {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  });
  let actionError: unknown;
  try {
    await action();
  } catch (error) {
    actionError = error;
    const message = error instanceof Error ? error.message : String(error);
    const buffer = Buffer.from(message);
    stderrHash.update(buffer);
    stderrBytes += buffer.byteLength;
    stderrTail = `${stderrTail}${message}`.slice(-8192);
  } finally {
    await outputHandle.release();
  }
  return {
    stdout: { bytes: stdoutBytes, sha256: stdoutHash.digest("hex") },
    stderr: {
      bytes: stderrBytes,
      sha256: stderrHash.digest("hex"),
      ...(stderrTail.length === 0 ? {} : { tail: stderrTail }),
    },
    ...(actionError === undefined ? {} : { error: actionError }),
  };
}

async function traceScope(
  projectRoot: string,
  phase: "opened" | "closed",
  input: Record<string, unknown>,
): Promise<void> {
  await recordWorkflowExecutionScope({ projectRoot, phase, data: input });
}

export class WorkspaceExecutionRuntime {
  readonly projectRoot: string;
  private readonly cliEntryPath: string;
  private readonly inProcess: WorkflowInProcessExecutor;
  private disposed = false;

  constructor(input: {
    projectRoot: string;
    cliEntryPath: string;
    inProcess: WorkflowInProcessExecutor;
  }) {
    this.projectRoot = input.projectRoot;
    this.cliEntryPath = input.cliEntryPath;
    this.inProcess = input.inProcess;
  }

  async execute(input: {
    cwd: string;
    command: string;
    effect: ContextWorkflowCommand["effect"];
  }): Promise<WorkflowCommandReceipt> {
    if (this.disposed) throw new Error("workspace execution runtime is closed");
    if (input.cwd !== this.projectRoot) {
      throw new Error(`workspace execution runtime cannot cross roots: ${input.cwd}`);
    }
    const args = parseContextCommand(input.command);
    if (input.effect !== "external" && this.inProcess.supports({ ...input, args })) {
      return this.executeInProcess({ ...input, args });
    }
    return this.executeSubprocess(input);
  }

  async close(): Promise<void> {
    this.disposed = true;
  }

  private async executeInProcess(input: {
    cwd: string;
    command: string;
    effect: ContextWorkflowCommand["effect"];
    args: string[];
  }): Promise<WorkflowCommandReceipt> {
    const scope = new ExecutionScope("workflow-command:in-process");
    const started = Date.now();
    await traceScope(this.projectRoot, "opened", {
      executor: "in-process",
      effect: input.effect,
    });
    let receipt: WorkflowCommandReceipt;
    try {
      const output = await captureProcessOutput(scope, () => this.inProcess.execute(input));
      receipt = output.error === undefined
        ? {
            exitCode: 0,
            signal: null,
            durationMs: Date.now() - started,
            timedOut: false,
            stdout: output.stdout,
            stderr: output.stderr,
          }
        : errorReceipt(output.error, started, output);
    } catch (error) {
      receipt = errorReceipt(error, started);
    }
    const scopeReceipt = await scope.close();
    await this.recordClosedScope("in-process", input.effect, scopeReceipt);
    return scopeReceipt.releaseErrors === 0
      ? receipt
      : {
          ...receipt,
          exitCode: receipt.exitCode === 0 ? 1 : receipt.exitCode,
          stderr: digestText(
            `${receipt.stderr.tail ?? ""}\nexecution scope cleanup failed`,
            true,
          ),
        };
  }

  private async executeSubprocess(input: {
    cwd: string;
    command: string;
    effect: ContextWorkflowCommand["effect"];
  }): Promise<WorkflowCommandReceipt> {
    const args = parseContextCommand(input.command);
    const scope = new ExecutionScope("workflow-command:subprocess");
    const started = Date.now();
    await traceScope(this.projectRoot, "opened", {
      executor: "subprocess",
      effect: input.effect,
    });
    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stderrTail = "";
    const timeoutMs = 30 * 60 * 1000;
    let receipt: WorkflowCommandReceipt;
    try {
      receipt = await new Promise<WorkflowCommandReceipt>((resolve, reject) => {
      let settled = false;
      const child = spawn(process.execPath, [this.cliEntryPath, ...args], {
        cwd: input.cwd,
        env: { ...process.env, ...debugChildEnvironment() },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      scope.defer("child-process", () => {
        if (!settled) child.kill("SIGKILL");
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
      scope.defer("command-timeout", () => clearTimeout(timer));
      scope.defer("force-kill-timeout", () => {
        if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      });
      child.once("close", (exitCode, signal) => {
        settled = true;
        resolve({
          exitCode,
          signal,
          durationMs: Date.now() - started,
          timedOut,
          stdout: { bytes: stdoutBytes, sha256: stdoutHash.digest("hex") },
          stderr: {
            bytes: stderrBytes,
            sha256: stderrHash.digest("hex"),
            ...(stderrTail.length === 0 ? {} : { tail: stderrTail }),
          },
        });
      });
      });
    } catch (error) {
      receipt = errorReceipt(error, started);
    }
    const scopeReceipt = await scope.close();
    await this.recordClosedScope("subprocess", input.effect, scopeReceipt);
    return scopeReceipt.releaseErrors === 0
      ? receipt
      : {
          ...receipt,
          exitCode: receipt.exitCode === 0 ? 1 : receipt.exitCode,
          stderr: digestText(
            `${receipt.stderr.tail ?? ""}\nexecution scope cleanup failed`,
            true,
          ),
        };
  }

  private async recordClosedScope(
    executor: "in-process" | "subprocess",
    effect: ContextWorkflowCommand["effect"],
    receipt: ExecutionScopeReceipt,
  ): Promise<void> {
    await traceScope(this.projectRoot, "closed", {
      executor,
      effect,
      resources: receipt.resources,
      release_errors: receipt.releaseErrors,
    });
  }
}
