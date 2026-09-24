import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { productionSourceIsExcluded, type ProductionRequirements } from "./productionRequirements.js";
import type { ProductionStage } from "./productionStage.js";
import { safeProjectTarget, runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { productionStageDirectory, productionSourceFile } from "./productionStageStore.js";

export function authorizedProductionSources(requirements: ProductionRequirements, includeExcluded = false): string[] {
  return [...new Set(requirements.requirements.flatMap(item => [
    ...item.target_scope.targets, ...item.evidence_source_scope?.targets ?? [],
  ].map(target => target.source_ref)))].filter(source => includeExcluded || !productionSourceIsExcluded(requirements, source));
}

/** Long-term permission is not a work assignment. Known article inputs select
 * their dependencies; investigation explicitly selects its own source refs. */
export function selectProductionSources(requirements: ProductionRequirements, sources?: string[], includeExcluded = false): string[] {
  const authorized = authorizedProductionSources(requirements, includeExcluded);
  const targets = [...new Set(requirements.requirements.flatMap(item => item.target_scope.targets.map(target => target.source_ref)))]
    .filter(source => authorized.includes(source));
  const selected = sources ?? (targets.length === 1 ? targets : []);
  if (!selected.length) throw new ContextError(ExitCode.UserError, "Select the sources needed for this request before preparing investigation", {
    category: ErrorCategory.UserInputInvalid, reason_code: "production-scope-required",
    authorized_sources: authorized,
    next_action: { command: "context status --format json", instruction: "Use --input for decided article tasks, or repeat --source <source-ref> on the current prepare-current command for this request's investigation. Registered reference material remains available for later plans." },
  });
  if (new Set(selected).size !== selected.length || selected.some(source => !authorized.includes(source))) {
    throw new TypeError("Selected production sources are duplicated or outside authorized scope");
  }
  return selected;
}

/** Compare only the requirements affecting this stage. Adding an unrelated
 * source to the reference pool cannot revoke existing task inputs. */
export function scopedProductionRequirements(requirements: ProductionRequirements, sources: readonly string[]): ProductionRequirements {
  const selected = new Set(sources);
  return { requirements: requirements.requirements.flatMap(item => {
    const targets = item.target_scope.targets.filter(target => selected.has(target.source_ref));
    const evidence = item.evidence_source_scope?.targets.filter(target => selected.has(target.source_ref));
    if (!targets.length && !evidence?.length) return [];
    return [{ ...item, target_scope: { targets },
      evidence_source_scope: { targets: evidence ?? [] },
      exclusions: (item.exclusions ?? []).flatMap(exclusion => {
        const targets = exclusion.scope.targets.filter(target => selected.has(target.source_ref));
        return targets.length ? [{ ...exclusion, scope: { targets }, ...(exclusion.source_baselines
          ? { source_baselines: Object.fromEntries(Object.entries(exclusion.source_baselines).filter(([source]) => selected.has(source))) } : {}) }] : [];
      }),
    }];
  }) };
}

export function productionRequestedSources(stage: ProductionStage): string[] {
  return stage.requested_sources ?? stage.scopes.map(source => source.scope);
}

export function activeProductionSources(stage: ProductionStage): Set<string> {
  return new Set([...stage.pending_scopes, ...stage.tasks.filter(task => !["accepted", "excluded", "replaced"].includes(task.status))
    .flatMap(task => task.sources.map(source => source.scope))]);
}

/** A plan can adopt a previously unused authorized reference. Publish its
 * navigation, requirement snapshot and manifest as one recoverable change. */
export async function saveExpandedProductionScope(root: string, stage: ProductionStage,
  requirements: ProductionRequirements, materials: ReadonlyMap<string, string>): Promise<void> {
  const directory = productionStageDirectory(stage.id);
  const contents = new Map<string, string>([
    [join(directory, "manifest.json"), `${JSON.stringify(stage)}\n`],
    [join(directory, "shared/requirements.md"), YAML.stringify(scopedProductionRequirements(requirements, productionRequestedSources(stage)))],
    ...[...materials].map(([scope, content]) => [join(directory, productionSourceFile(scope)), content] as [string, string]),
  ]);
  const targets = [];
  for (const [path, content] of contents) {
    let previous: string | undefined;
    try { previous = await readFile(await safeProjectTarget(root, path), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (previous === content) continue;
    targets.push({ path, operation: "write" as const, content,
      base_digest: previous === undefined ? null : durableContentDigest(previous), target_digest: durableContentDigest(content) });
  }
  if (targets.length) await runDurableMultiFileTransaction({ projectRoot: root, kind: "production-scope-plan",
    proposal_digest: durableContentDigest(JSON.stringify(stage)), targets: targets.sort((a, b) => a.path.localeCompare(b.path)) });
}
