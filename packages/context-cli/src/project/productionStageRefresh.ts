import { activeProductionSources } from "./productionScope.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { productionSourceBaseline } from "./productionSubmission.js";
import { assertProductionPlanRequirementsCurrent, productionPlanningRequest } from "./productionPlanning.js";
import { prepareProductionPlanningMaterials } from "./productionPlanningMaterials.js";
import { productionSourceFile, productionStageDirectory } from "./productionStageStore.js";
import { validateProductionStage, type ProductionStage } from "./productionStage.js";
import { safeProjectTarget, runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";

/** Explicit preparation may refresh changed sources. Ordinary submission
 * continuation does not call this source scan. Everything remains temporary. */
export async function refreshProductionStageSources(projectRoot: string, stage: ProductionStage): Promise<ProductionStage> {
  const active = activeProductionSources(stage);
  const affected = new Set(stage.gaps.filter(gap => active.has(gap.scope)).map(gap => gap.scope));
  const unavailable = new Map<string, string>();
  const scopes = [];
  for (const source of stage.scopes) {
    if (!active.has(source.scope)) { scopes.push(source); continue; }
    try {
      const baseline = await productionSourceBaseline(projectRoot, source.scope);
      if (baseline !== source.baseline) affected.add(source.scope);
      scopes.push({ scope: source.scope, baseline });
    } catch (error) {
      affected.add(source.scope);
      unavailable.set(source.scope, error instanceof Error ? error.message : String(error));
      // Retain the last real baseline; a failed read must not manufacture a
      // new input version or drop this source from the agreed scope.
      scopes.push(source);
    }
  }
  if (!affected.size) return stage;
  await assertProductionPlanRequirementsCurrent(projectRoot, stage);
  const request = (await productionPlanningRequest(projectRoot))!;
  const prepared = await prepareProductionPlanningMaterials({ projectRoot, requirements: request.requirements, scopes: affected });
  const sourceMaterials = new Map(prepared.materials.sources);
  for (const [scope, reason] of unavailable) {
    prepared.gaps = [...prepared.gaps.filter(gap => gap.scope !== scope), { scope, reason }];
    sourceMaterials.set(scope, `# ${scope}\n\nSource baseline is unavailable: ${reason}\n\nRestore the authorized source and retry preparation.\n`);
  }
  const updated = validateProductionStage({ ...stage, scopes,
    pending_scopes: [...new Set([...stage.pending_scopes, ...affected])],
    gaps: [...stage.gaps.filter(gap => !affected.has(gap.scope)), ...prepared.gaps],
    tasks: stage.tasks.map(task => !["accepted", "excluded", "replaced"].includes(task.status) &&
      task.sources.some(source => affected.has(source.scope))
      ? { ...task, status: "blocked", reason: "Source material refreshed; investigate and explicitly replace this unfinished task." } : task),
  });
  const directory = productionStageDirectory(stage.id);
  const contents = new Map([...sourceMaterials].map(([scope, content]) => [join(directory, productionSourceFile(scope)), content]));
  contents.set(join(directory, "manifest.json"), `${JSON.stringify(updated)}\n`);
  const targets = [];
  for (const [path, content] of contents) {
    let previous: string | undefined;
    try { previous = await readFile(await safeProjectTarget(projectRoot, path), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (previous === content) continue;
    targets.push({ path, operation: "write" as const, content,
      base_digest: previous === undefined ? null : durableContentDigest(previous), target_digest: durableContentDigest(content) });
  }
  if (targets.length) await runDurableMultiFileTransaction({ projectRoot, kind: "production-source-refresh",
    proposal_digest: durableContentDigest(JSON.stringify(updated)), targets: targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
  return updated;
}
