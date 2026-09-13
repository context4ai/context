import { readFile } from "node:fs/promises";
import { z } from "zod";
import YAML from "yaml";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";

// Keep the existing requirements location; migrating it does not create a
// second requirements ledger or move any production process into Git.
export const PRODUCTION_REQUIREMENTS_PATH = "src/indexers.yaml";
const text = z.string().trim().min(1);
const sourceTarget = z.object({ source_ref: text, module_refs: z.array(text).optional() }).strict();
const scope = z.object({ targets: z.array(sourceTarget) }).strict();
const localPath = text.refine(value => !value.startsWith("/") && !value.includes("\\") &&
  !value.split("/").some(part => !part || part === "." || part === "..") && !/[?*]/u.test(value),
"Use a source-relative exact file or directory path");
const requirement = z.object({
  id: text,
  purpose: text.optional(),
  reader_goals: z.array(text).optional(),
  coverage_domains: z.record(z.enum(["required", "optional", "out-of-scope"])).optional(),
  questions: z.array(text).optional(),
  target_scope: scope,
  evidence_source_scope: scope.optional(),
  exclusions: z.array(z.object({ scope, reason: text, paths: z.array(localPath).min(1).optional(),
    source_baselines: z.record(text).optional() }).strict()).optional(),
}).strict();

export const productionRequirementsSchema = z.object({ requirements: z.array(requirement).min(1) }).strict();
export type ProductionRequirements = z.infer<typeof productionRequirementsSchema>;

/** Runtime consumers use only the current requirements contract, not a skill registry. */
export async function readProductionRequirements(projectRoot: string): Promise<ProductionRequirements> {
  const inspected = await inspectProductionRequirements(projectRoot);
  if (!inspected) throw new TypeError("Configure the reader purpose and authorized sources before starting production. Run context status --format json.");
  return inspected.requirements;
}

/** Only an explicit whole-source exclusion shared by every owning requirement
 * removes investigation. Partial paths/modules and another reader purpose do not. */
export function productionSourceIsExcluded(requirements: ProductionRequirements, source: string): boolean {
  const owners = requirements.requirements.filter(item => [...item.target_scope.targets,
    ...item.evidence_source_scope?.targets ?? []].some(target => target.source_ref === source));
  return owners.length > 0 && owners.every(item => item.exclusions?.some(exclusion =>
    exclusion.paths === undefined && exclusion.scope.targets.some(target =>
      target.source_ref === source && !target.module_refs?.length)));
}

export function validateProductionRequirements(value: unknown): ProductionRequirements {
  const parsed = productionRequirementsSchema.parse(value);
  if (new Set(parsed.requirements.map(item => item.id)).size !== parsed.requirements.length) throw new TypeError("Requirement identities must be unique");
  for (const item of parsed.requirements) {
    if (!item.purpose && !item.reader_goals?.length && !item.questions?.length) throw new TypeError(`Requirement ${item.id} needs a reader purpose or questions`);
    if (!item.target_scope.targets.length) throw new TypeError(`Requirement ${item.id} needs an explicitly authorized production scope`);
    const authorized = new Set([...item.target_scope.targets, ...item.evidence_source_scope?.targets ?? []].map(target => target.source_ref));
    for (const selected of [item.target_scope, item.evidence_source_scope, ...item.exclusions?.map(exclusion => exclusion.scope) ?? []]) {
      if (!selected) continue;
      if (new Set(selected.targets.map(target => target.source_ref)).size !== selected.targets.length) throw new TypeError(`Requirement ${item.id} repeats a source in one scope`);
      for (const target of selected.targets) {
        if (!authorized.has(target.source_ref)) throw new TypeError(`Exclusion source is outside requirement ${item.id}: ${target.source_ref}`);
        if (new Set(target.module_refs).size !== (target.module_refs?.length ?? 0)) throw new TypeError(`Source ${target.source_ref} repeats a module`);
      }
    }
  }
  return parsed;
}

export async function inspectProductionRequirements(projectRoot: string): Promise<{
  requirements: ProductionRequirements;
  content: string;
} | undefined> {
  let content: string;
  try { content = await readFile(await safeProjectTarget(projectRoot, PRODUCTION_REQUIREMENTS_PATH), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    const value: unknown = YAML.parse(content, { uniqueKeys: true });
    return { requirements: validateProductionRequirements(value), content };
  } catch (error) {
    throw new ContextError(ExitCode.UserError, `Invalid ${PRODUCTION_REQUIREMENTS_PATH}: ${error instanceof Error ? error.message : String(error)}`, {
      category: ErrorCategory.UserInputInvalid, reason_code: "invalid-production-requirements",
      configuration: { file: PRODUCTION_REQUIREMENTS_PATH,
        action: "Correct the reported syntax or fields while preserving the user's purpose, authorized scope and exclusions. No production state was created." },
      input_schema: zodToJsonSchema(productionRequirementsSchema, { $refStrategy: "none" }),
      next_action: { command: "context status --format json" },
    });
  }
}
