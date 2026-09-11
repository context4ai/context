import type { CurrentIndexerBatchTask } from "./indexerCurrentBatch.js";

/** Resolve defaults only after task_key has selected a current, validated task.
 * Never repair an explicitly different group or mutate the submitted payload. */
export function inheritAuthorTaskGroup(value: unknown, task: Pick<CurrentIndexerBatchTask, "spec">): unknown {
  const workset = task.spec.request.workset;
  if (workset.stage !== "author") throw new TypeError("Author defaults require a current Author task");
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  if (result.group_key === undefined) return { ...result, group_key: workset.group_key };
  if (result.group_key !== workset.group_key) {
    throw new TypeError(`Author group_key must match the current task: ${workset.group_key}. Omit it to inherit the plan; do not reuse another task's group.`);
  }
  return value;
}
