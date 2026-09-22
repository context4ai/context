import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { atomicWriteFile } from "../../lib/atomicWrite.js";
import type { ContextResolvedWorkflowRoute } from "./workflowTypes.js";

export const WORKFLOW_ROUTE_INLINE_BYTE_LIMIT = 8 * 1024;

/** Inline the intact evaluated Route when bounded; the file is the same contract. */
export async function workflowRouteOutput(
  projectRoot: string,
  route: ContextResolvedWorkflowRoute | undefined,
  options: { inlineByteLimit?: number } = {},
) {
  if (!route) return null;
  const body = `${JSON.stringify(route, null, 2)}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const file = join(projectRoot, ".tmp/context-runtime/routes", `${digest}.json`);
  await atomicWriteFile(file, body);
  const routeBytes = Buffer.byteLength(body);
  const inlineByteLimit = Math.max(0, Math.min(
    WORKFLOW_ROUTE_INLINE_BYTE_LIMIT, options.inlineByteLimit ?? WORKFLOW_ROUTE_INLINE_BYTE_LIMIT,
  ));
  const inline = routeBytes <= inlineByteLimit;
  return { file, digest: `sha256:${digest}`, revision: route.revision, node: route.node,
    reason_code: route.reason_code, availability: route.availability,
    route_bytes: routeBytes, inline_byte_limit: inlineByteLimit,
    ...(inline ? { inline: route } : {}),
    next: inline
      ? "Use inline as the complete current Route; file contains the same Route and does not need another read. Required resources and read receipts still apply."
      : "Read this file for the complete current Route before acting. The Route exceeded the inline budget; no executable fields were truncated." };
}

export async function workflowRunResultFile(projectRoot: string, result: unknown): Promise<string> {
  const body = `${JSON.stringify(result, null, 2)}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const file = join(projectRoot, ".tmp/context-runtime/action-results", `${digest}.run.json`);
  await atomicWriteFile(file, body);
  return file;
}
