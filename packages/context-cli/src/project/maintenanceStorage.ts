import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "../lib/atomicWrite.js";

export const MAINTENANCE_ROOT = join(".tmp", "context-runtime", "maintenance");
const targetSchema = z.object({ path: z.string().min(1), instruction: z.string().trim().min(1) }).strict();
export const maintenanceInputSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/u),
  operation: z.enum(["revise", "regenerate", "rebuild"]),
  timing: z.enum(["after-batch", "priority"]).default("after-batch"),
  targets: z.array(targetSchema).default([]),
}).strict().superRefine((input, ctx) => {
  if ((input.operation === "rebuild") !== (input.targets.length === 0)) ctx.addIssue({ code: "custom", message: "rebuild has no page targets; revise/regenerate require targets" });
  if (new Set(input.targets.map(item => item.path)).size !== input.targets.length) ctx.addIssue({ code: "custom", message: "Page targets must be unique" });
});
export type MaintenanceInput = z.infer<typeof maintenanceInputSchema>;
const requestSchema = z.object({ input: maintenanceInputSchema, delivered_before: z.string(),
  targets: z.array(z.object({ path: z.string(), view_ref: z.string() }).strict()) }).strict();
const stateSchema = z.object({
  protocol: z.literal("context.maintenance/v1"),
  pending: z.array(requestSchema),
  active: requestSchema.extend({ phase: z.enum(["preparing", "running", "finishing", "cancelling"]), completion_outcome: z.enum(["completed", "cancelled"]).optional() }).optional(),
  completed: z.array(z.object({ id: z.string(), input_digest: z.string(), outcome: z.enum(["completed", "cancelled"]).optional() }).strict()),
}).strict();
export type MaintenanceState = z.infer<typeof stateSchema>;
export async function readMaintenance(root: string): Promise<MaintenanceState> {
  try { return stateSchema.parse(JSON.parse(await readFile(join(root, MAINTENANCE_ROOT, "current.json"), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { protocol: "context.maintenance/v1", pending: [], completed: [] }; throw error; }
}
export function saveMaintenance(root: string, state: MaintenanceState) {
  return atomicWriteFile(join(root, MAINTENANCE_ROOT, "current.json"), `${JSON.stringify(stateSchema.parse(state))}\n`);
}
/** Existing local updates keep their compatible path; an in-flight maintenance
 * batch has its own compile pointer and never replaces the production one. */
export async function revisionStoragePath(root: string): Promise<string> {
  return (await readMaintenance(root)).active
    ? join(MAINTENANCE_ROOT, "revision.json")
    : join(".tmp", "context-runtime", "indexer", "candidate-compile", "current.json");
}
