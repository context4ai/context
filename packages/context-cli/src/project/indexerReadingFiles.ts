import { createHash } from "node:crypto";
import { type IndexerTaskReading } from "./indexerAgentReading.js";

/** Templates and common instructions keep their own identity across batches.
 * Other repeated material remains grouped, avoiding a file per parser fact. */
export function planIndexerReadingFiles(tasks: readonly IndexerTaskReading[]) {
  // The same material is visited for ownership, grouping and output. Serialize
  // its exact identity once per planning call, without retaining mutable inputs.
  const keys = new Map<IndexerTaskReading["material"][number], string>();
  const keyOf = (block: IndexerTaskReading["material"][number]) => {
    let key = keys.get(block);
    if (key === undefined) {
      key = JSON.stringify([block.identity, block.section, block.markdown]);
      keys.set(block, key);
    }
    return key;
  };
  const stable = (block: IndexerTaskReading["material"][number]) =>
    block.section === "Selected page template" ||
    (block.section === "Goal and constraints" && /^### (index-requirement|source-access)\n/mu.test(block.markdown));
  const owners = new Map<string, Set<string>>();
  for (const task of tasks) for (const key of new Set(task.material.map(keyOf))) {
    const keys = owners.get(key) ?? new Set<string>();
    keys.add(task.task_key);
    owners.set(key, keys);
  }
  const groups = new Map<string, Map<string, IndexerTaskReading["material"][number]>>();
  for (const task of tasks) for (const block of task.material) {
    const key = keyOf(block);
    if (owners.get(key)!.size <= 1 && !stable(block)) continue;
    const groupKey = stable(block) ? `stable:${key}` : JSON.stringify([...owners.get(key)!].sort());
    const group = groups.get(groupKey) ?? new Map();
    group.set(key, block);
    groups.set(groupKey, group);
  }
  const byBlock = new Map<string, { digest: string; markdown: string }>();
  const shared = [...groups.values()].map((group) => {
    const markdown = [...group.values()].map((block) =>
      `# ${block.section}\n\nOrigin: ${block.identity}\n\n${block.markdown}\n`).join("\n");
    const file = { digest: `sha256:${createHash("sha256").update(markdown).digest("hex")}`, markdown };
    for (const key of group.keys()) byBlock.set(key, file);
    return file;
  });
  const readings = tasks.map((task) => {
    const common = [...new Set(task.material.flatMap((block) => byBlock.has(keyOf(block)) ? [byBlock.get(keyOf(block))!] : []))];
    const referenced = new Set<string>();
    let section: string | undefined;
    const material = task.material.flatMap((block) => {
      const resource = byBlock.get(keyOf(block));
      if (resource !== undefined) {
        if (referenced.has(resource.digest)) return [];
        referenced.add(resource.digest);
        return [`Read shared material: ./${resource.digest.slice(7)}.md (${resource.digest}; ${Buffer.byteLength(resource.markdown)} UTF-8 bytes)`];
      }
      const heading = section === block.section ? "" : `## ${block.section}\n\n`;
      section = block.section;
      return [heading + block.markdown];
    });
    return { common, markdown: [task.introduction,
      "Shared links are relative to this file. Read only this task's referenced shared files; they do not extend its allowed source references. Reuse an already fully read shared file with the same digest across batches in this conversation. After context loss, read it again if its contents are no longer available. If tool output is truncated, read the remaining ranges before submitting; do not treat the preview as the complete file.",
      ...material, task.conclusion].join("\n\n") };
  });
  const details = [...new Map(tasks.flatMap(task => task.material.flatMap(block => block.detail ? [[block.detail.digest, block.detail] as const] : []))).values()];
  return { readings, shared, details,
    view_item_count: tasks.reduce((sum, task) => sum + task.context_item_count +
      task.material.filter(block => !byBlock.has(keyOf(block))).length, 0) +
      byBlock.size,
    input_bytes: [...readings, ...shared].reduce((sum, file) => sum + Buffer.byteLength(file.markdown), 0) };
}
