import type { ProductionStage } from "./productionStage.js";

/** Only unfinished writers owning these actual paths/identities conflict.
 * Shared sources or skill names do not create article ownership. */
export function maintenanceProductionConflict(
  targets: Array<{ path: string; article_id: string }>, stage: ProductionStage,
): boolean {
  return stage.tasks.some(task => ["pending", "issued", "blocked"].includes(task.status) &&
    targets.some(target => target.article_id === task.article_id || target.path === task.path));
}
