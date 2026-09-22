import { spawn } from "node:child_process";
import { isLarkResourcePermissionDenied, LarkResourceCommandError, runLarkResourceCommand,
  type LarkResourceCommandRunner } from "./larkResourceCommand.js";
import { createLarkResourceScheduler } from "./larkResourceScheduler.js";
import type { LarkReadIdentity } from "./larkReadIdentity.js";

export interface WikiDiscoveryNode {
  node_token: string;
  obj_token: string;
  obj_type: string;
  title: string;
  has_child: boolean;
  node_type?: string;
  parent_node_token?: string;
}
export interface WikiDiscoveryRoot extends WikiDiscoveryNode { space_id: string }
export interface WikiDiscoveryPage { nodes: WikiDiscoveryNode[]; next_page_token?: string }
export interface WikiDiscoveryRequest {
  space_id: string;
  parent_node_token: string;
  page_token?: string;
  identity: LarkReadIdentity;
}
export interface WikiDiscoveryProvider {
  resolveRoot(url: string, identity: LarkReadIdentity): Promise<WikiDiscoveryRoot>;
  listPage(request: WikiDiscoveryRequest): Promise<WikiDiscoveryPage>;
}
export class WikiDiscoveryError extends Error {
  constructor(readonly reason: string, readonly retryable: boolean, message: string) {
    super(message);
    this.name = "WikiDiscoveryError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WikiDiscoveryError("invalid-response", false, "Wiki response must contain an object");
  }
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new WikiDiscoveryError("invalid-response", false, `Wiki response is missing ${field}`);
  }
  return value;
}
export function parseWikiDiscoveryNode(value: unknown): WikiDiscoveryNode {
  const item = object(value);
  if (typeof item.has_child !== "boolean") {
    throw new WikiDiscoveryError("invalid-response", false, "Wiki response is missing has_child");
  }
  return {
    node_token: requiredString(item.node_token, "node_token"),
    obj_token: requiredString(item.obj_token, "obj_token"),
    obj_type: requiredString(item.obj_type, "obj_type"),
    title: typeof item.title === "string" ? item.title : "",
    has_child: item.has_child,
    ...(typeof item.node_type === "string" ? { node_type: item.node_type } : {}),
    ...(typeof item.parent_node_token === "string" ? { parent_node_token: item.parent_node_token } : {}),
  };
}
export function parseWikiDiscoveryRoot(value: unknown): WikiDiscoveryRoot {
  const item = object(value);
  return { ...parseWikiDiscoveryNode(item), space_id: requiredString(item.space_id, "space_id") };
}

export function wikiDiscoveryFailure(error: unknown): { reason: string; retryable: boolean; message: string } {
  if (error instanceof WikiDiscoveryError) return { reason: error.reason, retryable: error.retryable, message: error.message };
  if (isLarkResourcePermissionDenied(error) || (error instanceof LarkResourceCommandError &&
      ["authorization", "authentication"].includes(error.errorType ?? ""))) {
    return { reason: "access-unavailable", retryable: false, message: "The selected identity cannot read this Wiki resource; no identity fallback was attempted" };
  }
  if (error instanceof LarkResourceCommandError) {
    const code = String(error.code ?? "");
    if (code === "131006") return { reason: "access-unavailable", retryable: false, message: "The selected identity cannot read this Wiki resource" };
    if (["429", "99991400"].includes(code) || error.errorType === "rate_limit" || error.errorSubtype === "rate_limited") {
      return { reason: "rate-limited", retryable: true, message: "Wiki request remained throttled after bounded backoff" };
    }
    if (code === "131001" || /^[5][0-9]{2}$/u.test(code)) {
      return { reason: "service-unavailable", retryable: true, message: "Wiki service request failed; this page can be resumed" };
    }
    return { reason: "request-failed", retryable: false, message: "Wiki rejected this request; successful pages were retained" };
  }
  return { reason: "request-failed", retryable: true, message: "Wiki request did not complete; this page can be resumed" };
}

/** A single CLI process has a hard deadline and no stdin or interactive login. */
function defaultRunner(signal?: AbortSignal): LarkResourceCommandRunner {
  return (args, options) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WikiDiscoveryError("request-interrupted", true, "Wiki request was interrupted"));
      return;
    }
    let failure: WikiDiscoveryError | undefined;
    let stdout = "", stderr = "", size = 0;
    const terminate = (): void => {
      try {
        // lark-cli may itself be a host shim with a child CLI process.
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* Already exited; the close callback still owns the receipt. */ }
    };
    const interrupt = (): void => {
      failure = new WikiDiscoveryError("request-interrupted", true, "Wiki request was interrupted or exceeded its 30 second deadline");
      terminate();
    };
    const child = spawn(process.env.CONTEXT_LARK_CLI_BIN?.trim() || "lark-cli", args, {
      ...(options?.cwd ? { cwd: options.cwd } : {}), detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
    });
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", interrupt);
    };
    const collect = (chunk: string, stream: "stdout" | "stderr"): void => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > 8 * 1024 * 1024) {
        failure ??= new WikiDiscoveryError("response-too-large", false, "Wiki CLI page exceeded the 8 MB response limit");
        terminate();
      } else if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => collect(chunk, "stdout"));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => collect(chunk, "stderr"));
    child.on("error", () => {
      cleanup();
      reject(new WikiDiscoveryError("cli-unavailable", false, "Could not execute lark-cli; install or configure it before resuming"));
    });
    child.on("close", code => {
      cleanup();
      if (failure) reject(failure);
      else resolve({ stdout, stderr, exitCode: code });
    });
    const timer = setTimeout(interrupt, 30_000);
    timer.unref();
    signal?.addEventListener("abort", interrupt, { once: true });
    if (signal?.aborted) interrupt();
  });
}

export function createWikiDiscoveryProvider(options: {
  runner?: LarkResourceCommandRunner;
  signal?: AbortSignal;
  scheduler?: { now?: () => number; sleep?: (ms: number) => Promise<unknown> };
} = {}): WikiDiscoveryProvider {
  const raw = options.runner ?? defaultRunner(options.signal);
  // Normalize the Wiki API's explicit throttle code for the shared scheduler.
  const runner = createLarkResourceScheduler(async (args, commandOptions) => {
    const result = await raw(args, commandOptions);
    for (const field of ["stdout", "stderr"] as const) {
      const start = result[field].indexOf("{");
      if (start < 0) continue;
      try {
        const value = object(JSON.parse(result[field].slice(start)));
        const detail = value.error;
        if (detail && typeof detail === "object" && String((detail as Record<string, unknown>).code) === "99991400") {
          const parsed = detail as Record<string, unknown>;
          const enriched = { ...parsed, type: "rate_limit",
            ...(parsed.retry_after_seconds !== undefined ? { retry_after: parsed.retry_after_seconds } : {}) };
          result[field] = JSON.stringify({ ...value, error: enriched });
        }
      } catch { /* Preserve non-JSON diagnostics for the existing error parser. */ }
    }
    return result;
  }, options.scheduler);
  const request = async (args: string[], identity: LarkReadIdentity): Promise<Record<string, unknown>> => {
    const output = await runLarkResourceCommand(runner, [...args, "--as", identity, "--format", "json"]);
    let envelope: Record<string, unknown>;
    try { envelope = object(JSON.parse(output)); }
    catch (error) {
      if (error instanceof WikiDiscoveryError) throw error;
      throw new WikiDiscoveryError("invalid-response", false, "Wiki CLI returned invalid JSON");
    }
    if (envelope.identity !== undefined && envelope.identity !== identity) {
      throw new WikiDiscoveryError("identity-mismatch", false, "Wiki CLI responded with a different identity; the response was not accepted");
    }
    return object(envelope.data ?? envelope);
  };
  return {
    async resolveRoot(url, identity) {
      const value = await request(["wiki", "+node-get", "--node-token", url], identity);
      const root = parseWikiDiscoveryRoot(value);
      const requested = new URL(url).pathname.split("/").filter(Boolean).at(-1);
      if (root.node_token !== requested) {
        throw new WikiDiscoveryError("scope-mismatch", false, "Wiki resolution returned a different root node; no tree traversal was started");
      }
      return root;
    },
    async listPage(input) {
      const args = ["wiki", "+node-list", "--space-id", input.space_id,
        "--parent-node-token", input.parent_node_token, "--page-size", "50"];
      if (input.page_token) args.push("--page-token", input.page_token);
      const value = await request(args, input.identity);
      if (!Array.isArray(value.nodes) || typeof value.has_more !== "boolean") {
        throw new WikiDiscoveryError("invalid-response", false, "Wiki page must contain nodes and has_more");
      }
      if (value.nodes.some((raw: unknown) => {
        const item = object(raw);
        return (item.space_id !== undefined && item.space_id !== input.space_id) ||
          (item.parent_node_token !== undefined && item.parent_node_token !== input.parent_node_token);
      })) {
        throw new WikiDiscoveryError("scope-mismatch", false, "Wiki page contained nodes outside the requested space or parent; this page was not accepted");
      }
      return { nodes: value.nodes.map(parseWikiDiscoveryNode), ...(value.has_more
        ? { next_page_token: requiredString(value.page_token, "page_token") } : {}) };
    },
  };
}
