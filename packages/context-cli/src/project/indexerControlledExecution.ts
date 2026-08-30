import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  validateIndexerActivationRequest,
  validateIndexerActivationResult,
  validateIndexerControlledProgramRequest,
  validateIndexerControlledProgramResult,
  validateIndexerInspectorRequest,
  validateIndexerInspectorResult,
  type IndexerActivationRequest,
  type IndexerActivationResult,
  type IndexerControlledProgramRequest,
  type IndexerControlledProgramResult,
  type IndexerInspectorRequest,
  type IndexerInspectorResult,
  type ResolvedProviderBundle,
} from "@c4a/context";
import {
  assertIndexerOutputSafe,
  redactIndexerOutputText,
} from "@c4a/core";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  buildIndexerControlledLaunch,
  type IndexerControlledLaunch,
} from "./indexerControlledLaunch.js";
import type { StagedIndexerProviderBundle } from "./indexerProviderStage.js";

export type IndexerControlledExecutionRequest =
  | IndexerActivationRequest
  | IndexerInspectorRequest
  | IndexerControlledProgramRequest;

export type IndexerControlledExecutionResult =
  | IndexerActivationResult
  | IndexerInspectorResult
  | IndexerControlledProgramResult;

export interface IndexerControlledExecutionReceipt {
  protocol: "context.indexer.controlled-execution-receipt/v1";
  resource: IndexerControlledLaunch["resource"];
  invocation_digest: string;
  request_digest: string;
  result_digest: string;
  launch_digest: string;
  stdout_digest: string;
  stderr_digest: string;
  stderr_tail: string | null;
  exit_code: 0;
  duration_ms: number;
  receipt_digest: string;
}

interface CapturedProcess {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  overflow: "stdout" | "stderr" | null;
  stdout: Buffer;
  stderr: Buffer;
  durationMs: number;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function executionError(
  reasonCode: string,
  message: string,
  detail: Record<string, unknown>,
): ContextError {
  return new ContextError(ExitCode.ExternalToolError, message, {
    category: ErrorCategory.ExternalToolFailed,
    reason_code: reasonCode,
    ...detail,
  });
}

function exactRequest(value: unknown): IndexerControlledExecutionRequest {
  const protocol = value !== null && typeof value === "object" && "protocol" in value
    ? (value as { protocol?: unknown }).protocol
    : undefined;
  if (protocol === "context.indexer.activation-request/v1") {
    return validateIndexerActivationRequest(value);
  }
  if (protocol === "context.indexer.inspector-request/v1") {
    return validateIndexerInspectorRequest(value);
  }
  if (protocol === "context.indexer.controlled-program-request/v1") {
    return validateIndexerControlledProgramRequest(value);
  }
  throw new TypeError("controlled execution request protocol is unsupported");
}

function requestResource(
  request: IndexerControlledExecutionRequest,
): IndexerControlledLaunch["resource"] {
  return request.invocation.resource;
}

function validateResult(
  request: IndexerControlledExecutionRequest,
  result: unknown,
): IndexerControlledExecutionResult {
  if (request.protocol === "context.indexer.activation-request/v1") {
    return validateIndexerActivationResult({ request, result }).result;
  }
  if (request.protocol === "context.indexer.inspector-request/v1") {
    return validateIndexerInspectorResult({ request, result }).result;
  }
  return validateIndexerControlledProgramResult({ request, result }).result;
}

function resultDigest(result: IndexerControlledExecutionResult): string {
  if (result.protocol === "context.indexer.controlled-program-result/v1") {
    return result.payload_digest;
  }
  return result.result_digest;
}

function requestDigest(request: IndexerControlledExecutionRequest): string {
  return request.request_digest;
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  currentBytes: number,
  limit: number,
): { bytes: number; overflow: boolean } {
  const available = Math.max(0, limit - currentBytes);
  if (available > 0) chunks.push(chunk.subarray(0, available));
  return {
    bytes: currentBytes + chunk.byteLength,
    overflow: currentBytes + chunk.byteLength > limit,
  };
}

async function captureControlledProcess(
  launch: IndexerControlledLaunch,
  stdin: Buffer,
): Promise<CapturedProcess> {
  const startedAt = Date.now();
  return new Promise<CapturedProcess>((resolve, reject) => {
    const child = spawn(launch.executable, [launch.entry_path, ...launch.args], {
      cwd: launch.cwd,
      env: {},
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow: CapturedProcess["overflow"] = null;
    let timedOut = false;
    let closed = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = (): void => {
      if (closed) return;
      child.kill("SIGTERM");
      if (forceKillTimer === undefined) {
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, launch.limits.timeout_ms);

    child.stdout.on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const appended = appendBounded(
        stdoutChunks,
        chunk,
        stdoutBytes,
        launch.limits.max_stdout_bytes,
      );
      stdoutBytes = appended.bytes;
      if (appended.overflow && overflow === null) {
        overflow = "stdout";
        stop();
      }
    });
    child.stderr.on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const appended = appendBounded(
        stderrChunks,
        chunk,
        stderrBytes,
        launch.limits.max_stderr_bytes,
      );
      stderrBytes = appended.bytes;
      if (appended.overflow && overflow === null) {
        overflow = "stderr";
        stop();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      closed = true;
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      resolve({
        exitCode,
        signal,
        timedOut,
        overflow,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        durationMs: Date.now() - startedAt,
      });
    });
    child.stdin.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin.end(stdin);
  });
}

function decodeUtf8(value: Buffer, channel: "stdout" | "stderr"): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw executionError(
      `indexer-controlled-${channel}-invalid-utf8`,
      `controlled Indexer ${channel} is not valid UTF-8`,
      { [`${channel}_bytes`]: value.byteLength, [`${channel}_digest`]: sha256(value) },
    );
  }
}

function parseResult(stdout: Buffer): unknown {
  const text = decodeUtf8(stdout, "stdout");
  try {
    return JSON.parse(text);
  } catch {
    throw executionError(
      "indexer-controlled-output-invalid-json",
      "controlled Indexer output must be one JSON value",
      { stdout_bytes: stdout.byteLength, stdout_digest: sha256(stdout) },
    );
  }
}

export async function executeIndexerControlledRequest(input: {
  request: unknown;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
}): Promise<{
  result: IndexerControlledExecutionResult;
  receipt: IndexerControlledExecutionReceipt;
}> {
  const request = exactRequest(input.request);
  const safeRequest = assertIndexerOutputSafe({ channel: "ipc-envelope", value: request });
  const stdin = Buffer.from(`${canonicalIndexerJson(safeRequest)}\n`, "utf8");
  if (stdin.byteLength > request.invocation.limits.max_stdin_bytes) {
    throw executionError(
      "indexer-controlled-stdin-limit-exceeded",
      "controlled Indexer request exceeds its authorized stdin limit",
      {
        stdin_bytes: stdin.byteLength,
        max_stdin_bytes: request.invocation.limits.max_stdin_bytes,
        request_digest: requestDigest(request),
      },
    );
  }
  const launch = await buildIndexerControlledLaunch({
    invocation: request.invocation,
    bundle: input.bundle,
    staged: input.staged,
  });
  let captured: CapturedProcess;
  try {
    captured = await captureControlledProcess(launch, stdin);
  } catch (error) {
    const message = redactIndexerOutputText({
      channel: "exception-message",
      value: error instanceof Error ? error.message : String(error),
    });
    throw executionError(
      "indexer-controlled-spawn-failed",
      "controlled Indexer process could not start",
      { detail: message, request_digest: requestDigest(request) },
    );
  }
  const stderrText = redactIndexerOutputText({
    channel: "stderr",
    value: decodeUtf8(captured.stderr, "stderr"),
  });
  const commonDetail = {
    resource: requestResource(request),
    invocation_digest: request.invocation.invocation_digest,
    request_digest: requestDigest(request),
    exit_code: captured.exitCode,
    signal: captured.signal,
    stdout_bytes: captured.stdout.byteLength,
    stderr_bytes: captured.stderr.byteLength,
    stderr_tail: stderrText.length === 0 ? null : stderrText.slice(-8192),
  };
  if (captured.timedOut) {
    throw executionError(
      "indexer-controlled-timeout",
      "controlled Indexer process exceeded its authorized timeout",
      commonDetail,
    );
  }
  if (captured.overflow !== null) {
    throw executionError(
      `indexer-controlled-${captured.overflow}-limit-exceeded`,
      `controlled Indexer ${captured.overflow} exceeded its authorized limit`,
      commonDetail,
    );
  }
  if (captured.exitCode !== 0) {
    throw executionError(
      "indexer-controlled-nonzero-exit",
      "controlled Indexer process exited without a valid Result",
      commonDetail,
    );
  }
  let result: IndexerControlledExecutionResult;
  try {
    const parsed = assertIndexerOutputSafe({
      channel: "ipc-envelope",
      value: parseResult(captured.stdout),
    });
    result = validateResult(request, parsed);
  } catch (error) {
    if (error instanceof ContextError) throw error;
    const message = redactIndexerOutputText({
      channel: "exception-message",
      value: error instanceof Error ? error.message : String(error),
    });
    throw executionError(
      "indexer-controlled-result-invalid",
      "controlled Indexer returned a Result that failed protocol validation",
      { ...commonDetail, detail: message, stdout_digest: sha256(captured.stdout) },
    );
  }
  const receiptPayload: Omit<IndexerControlledExecutionReceipt, "receipt_digest"> = {
    protocol: "context.indexer.controlled-execution-receipt/v1",
    resource: requestResource(request),
    invocation_digest: request.invocation.invocation_digest,
    request_digest: requestDigest(request),
    result_digest: resultDigest(result),
    launch_digest: launch.runtime_receipt.launch_digest,
    stdout_digest: sha256(captured.stdout),
    stderr_digest: sha256(stderrText),
    stderr_tail: stderrText.length === 0 ? null : stderrText.slice(-8192),
    exit_code: 0,
    duration_ms: captured.durationMs,
  };
  return {
    result,
    receipt: {
      ...receiptPayload,
      receipt_digest: indexerProtocolDigest(receiptPayload),
    },
  };
}
