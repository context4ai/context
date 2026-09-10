/** Presentation counters have explicit scope and units. Never infer page totals
 * from task counts: a task may revise an existing page or produce several. */
export interface ProgressCount {
  unit: "task" | "page";
  completed: number;
  total: number | null;
}
export function progressCount(unit: ProgressCount["unit"], completed: number, total: number | null): ProgressCount {
  return { unit, completed, total };
}
export function submittedProgressSlice(stage: string, outcomes: readonly { outcome: string; committed?: boolean }[]) {
  return { scope: "submitted-slice" as const, stage,
    ...progressCount("task", outcomes.filter(item => item.committed === true && item.outcome === "accepted").length, outcomes.length) };
}
export function indexerProgressScopes(input: {
  delivered: number;
  planning: { completed: number; total: number; stale?: number } | null;
  author: { completed: number; total: number } | null;
  wavePages: { authored: number; delivered: number };
  composer: { completed: number; prepared: number; allPrepared: boolean };
  review: { pending: number; requiresRepair: number };
  slice: { stage: string; completed: number; total: number } | null;
}) {
  return {
    overall: {
      scope: "current-indexer-run" as const,
      delivery: progressCount("page", input.delivered, null),
      planning: input.planning === null ? null : {
        ...progressCount("task", input.planning.completed, input.planning.total),
        definition: "currently-valid-accepted",
        needs_recheck: input.planning.stale ?? 0,
        recheck_reason: input.planning.stale ? "request-bindings-changed" : null,
      },
    },
    wave: input.author === null ? null : {
      scope: "current-author-wave" as const,
      writing: progressCount("task", input.author.completed, input.author.total),
      delivery: progressCount("page", input.wavePages.delivered, null),
      authored_pages: input.wavePages.authored,
      composition: { ...progressCount("task", input.composer.completed,
        input.composer.allPrepared ? input.composer.prepared : null), prepared: input.composer.prepared },
      review: { scope: "current-candidates" as const, unit: "page" as const, pending: input.review.pending, requires_repair: input.review.requiresRepair },
    },
    slice: input.slice === null ? null : { scope: "current-route-slice" as const, stage: input.slice.stage,
      ...progressCount("task", input.slice.completed, input.slice.total) },
  };
}
