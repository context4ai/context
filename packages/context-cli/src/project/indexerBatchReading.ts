import { Buffer } from "node:buffer";
import { renderIndexerTaskReading, type IndexerTaskReading } from "./indexerAgentReading.js";

/** Reading presentation only. Task identities and their full canonical Views
 * remain independent. Share only byte-identical material from the same origin;
 * never infer equivalent facts or broaden a task's available references. */
export function renderIndexerBatchReading(tasks: readonly IndexerTaskReading[]) {
  if (tasks.length === 0) throw new TypeError("Indexer batch reading requires a task");
  const blocks = new Map<string, {
    block: IndexerTaskReading["material"][number]; tasks: string[];
  }>();
  const keyOf = (block: IndexerTaskReading["material"][number]) =>
    JSON.stringify([block.identity, block.section, block.markdown]);
  for (const task of tasks) {
    for (const block of task.material) {
      const key = keyOf(block);
      const existing = blocks.get(key);
      if (existing === undefined) blocks.set(key, { block, tasks: [task.task_key] });
      else if (!existing.tasks.includes(task.task_key)) existing.tasks.push(task.task_key);
    }
  }
  const shared = [...blocks.values()].filter((entry) => entry.tasks.length > 1);
  const output = tasks.length === 1 ? [renderIndexerTaskReading(tasks[0]!)] : [
    "# Indexer batch", "",
    "Read this file once for the entire batch. Each task keeps its own goals and result. Shared material applies only to the listed task keys; it does not authorize references for other tasks.", "",
    ...tasks.flatMap((task) => [task.introduction, ""]),
  ];
  if (tasks.length > 1) {
    if (shared.length > 0) {
      output.push("## Shared material — read once", "");
      for (const entry of shared) {
        output.push(`Applies to: ${entry.tasks.join(", ")} — ${entry.block.section}`, "", entry.block.markdown);
      }
    }
    for (const task of tasks) {
      output.push(`## ${task.task_key} — task-specific material`, "");
      let section: string | undefined;
      for (const block of task.material) {
        if (blocks.get(keyOf(block))!.tasks.length > 1) continue;
        if (block.section !== section) output.push(`## ${block.section}`, "");
        output.push(block.markdown);
        section = block.section;
      }
      output.push(task.conclusion, "");
    }
    output.push("Submit the batch once, with a separate results[] entry for each task_key. Do not replace distinct pages with one generic page.", "");
  }
  const markdown = output.join("\n");
  return {
    markdown,
    input_bytes: Buffer.byteLength(markdown, "utf8"),
    // Count reader-visible items, not the recovery graph that backs them.
    view_item_count: tasks.reduce((count, task) => count + task.context_item_count +
      task.material.filter((block) => blocks.get(keyOf(block))!.tasks.length === 1).length, 0) + shared.length,
  };
}
