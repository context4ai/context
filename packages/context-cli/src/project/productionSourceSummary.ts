import type { ProductionStage } from "./productionStage.js";

/** Describe existing state only; never infer article coverage or alter scope. */
export function productionSourceSummary(stage: Pick<ProductionStage, "scopes" | "pending_scopes" | "gaps" | "tasks">) {
  const pending = new Set(stage.pending_scopes);
  const unavailable = new Set(stage.gaps.map(gap => gap.scope));
  return {
    stage_source_count: new Set(stage.scopes.map(source => source.scope)).size,
    pending_scope_count: pending.size,
    unavailable_source_count: unavailable.size,
    pending_without_read_failure_count: [...pending].filter(scope => !unavailable.has(scope)).length,
    planned_article_count: new Set(stage.tasks.filter(task => !["excluded", "replaced"].includes(task.status)).map(task => task.path)).size,
    unavailable_sources: stage.gaps,
    meaning: "Pending scopes are remaining investigation, not missing knowledge or failed captures. Unavailable sources have current material/baseline read failures; inspect their reasons. Counts can overlap and must not be added. Restore required code dependencies even for document-led work.",
  };
}

export function productionSourceSummaryMarkdown(stage: Parameters<typeof productionSourceSummary>[0]): string[] {
  const summary = productionSourceSummary(stage);
  return ["## Source availability and progress", "",
    `Stage sources: ${summary.stage_source_count}; pending investigation scopes: ${summary.pending_scope_count}; sources with read failures: ${summary.unavailable_source_count}; pending scopes without read failures: ${summary.pending_without_read_failure_count}; planned articles: ${summary.planned_article_count}.`,
    summary.meaning, "",
    ...summary.unavailable_sources.map(gap => `- ${gap.scope}: ${gap.reason}`), ""];
}
