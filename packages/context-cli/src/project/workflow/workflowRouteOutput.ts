import { createHash } from "node:crypto";
import { join } from "node:path";
import { atomicWriteFile } from "../../lib/atomicWrite.js";
import type { ContextResolvedWorkflowRoute } from "./workflowTypes.js";

/** Summary callers get a pointer, never a second partial executable Route. */
export async function workflowRouteOutput(projectRoot: string, route: ContextResolvedWorkflowRoute | undefined) {
  if (!route) return null;
  const body = `${JSON.stringify(route, null, 2)}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const file = join(projectRoot, ".tmp/context-runtime/routes", `${digest}.json`);
  await atomicWriteFile(file, body);
  return { file, digest: `sha256:${digest}`, revision: route.revision, node: route.node,
    reason_code: route.reason_code, availability: route.availability,
    next: "Read this file for the complete current Route before acting." };
}

export async function workflowRunResultFile(projectRoot: string, result: unknown): Promise<string> {
  const body = `${JSON.stringify(result, null, 2)}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const file = join(projectRoot, ".tmp/context-runtime/action-results", `${digest}.run.json`);
  await atomicWriteFile(file, body);
  return file;
}
