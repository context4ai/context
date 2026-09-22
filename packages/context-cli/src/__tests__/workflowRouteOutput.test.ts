import { afterEach, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateContextWorkflow } from "../project/workflow/workflowProvider.js";
import { workflowRouteOutput, WORKFLOW_ROUTE_INLINE_BYTE_LIMIT } from "../project/workflow/workflowRouteOutput.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-route-output-"));
  roots.push(root);
  const snapshot = await evaluateContextWorkflow({ observation: emptyObservation(), authorities: [] });
  return { root, route: snapshot.route! };
}

test("bounded Route is identical inline and on disk, retaining authority and required reading", async () => {
  const { root, route } = await fixture();
  const before = JSON.stringify(route);
  const output = (await workflowRouteOutput(root, route))!;
  const body = await readFile(output.file, "utf8");
  expect(output.inline).toEqual(route);
  expect(JSON.parse(body)).toEqual(output.inline);
  expect(output.digest).toBe(`sha256:${createHash("sha256").update(body).digest("hex")}`);
  expect(output.route_bytes).toBe(Buffer.byteLength(body));
  expect(output.inline?.availability).toBe("requires-user");
  expect(output.inline?.gate?.resolution_action?.input_schema).toBeDefined();
  expect(output.inline?.commands.some(command => command.availability === "after-human-confirmation")).toBe(true);
  expect(output.inline?.resources.required.some(resource => resource.read_state === "read-required")).toBe(true);
  expect(output.inline?.resources.after_read).toEqual(route.resources.after_read);
  expect(JSON.stringify(route)).toBe(before);
});

test("oversized Route remains complete in the file without a partial inline contract", async () => {
  const { root, route } = await fixture();
  route.action = { id: "large-input", runner: "agent", effect: "read", input: { body: "x".repeat(WORKFLOW_ROUTE_INLINE_BYTE_LIMIT) } };
  const output = (await workflowRouteOutput(root, route))!;
  expect(output).not.toHaveProperty("inline");
  expect(output).not.toHaveProperty("commands");
  expect(output.route_bytes).toBeGreaterThan(output.inline_byte_limit);
  expect(JSON.parse(await readFile(output.file, "utf8"))).toEqual(route);
});

test("inline budget uses UTF-8 bytes and can be reduced by a containing receipt", async () => {
  const { root, route } = await fixture();
  route.summary = "说明";
  const body = `${JSON.stringify(route, null, 2)}\n`;
  const bytes = Buffer.byteLength(body);
  expect(bytes).toBeGreaterThan(body.length);
  const included = (await workflowRouteOutput(root, route, { inlineByteLimit: bytes }))!;
  const excluded = (await workflowRouteOutput(root, route, { inlineByteLimit: bytes - 1 }))!;
  expect(included.inline).toEqual(route);
  expect(excluded).not.toHaveProperty("inline");
  expect(excluded.file).toBe(included.file);
  expect(excluded.digest).toBe(included.digest);
});

test("completed workflow produces no synthetic Route or route file", async () => {
  const { root } = await fixture();
  expect(await workflowRouteOutput(root, undefined)).toBeNull();
  expect(await readdir(root)).toEqual([]);
});
