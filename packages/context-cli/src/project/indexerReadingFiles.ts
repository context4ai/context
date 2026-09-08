import { createHash } from "node:crypto";
import { type IndexerTaskReading } from "./indexerAgentReading.js";

/** One shared file per exact set of owning tasks, not one file per fact. */
export function planIndexerReadingFiles(tasks: readonly IndexerTaskReading[]) {
  const keyOf = (block: IndexerTaskReading["material"][number]) => JSON.stringify([block.identity, block.section, block.markdown]);
  const owners = new Map<string, Set<string>>();
  for (const task of tasks) for (const key of new Set(task.material.map(keyOf))) {
    const keys = owners.get(key) ?? new Set<string>();
    keys.add(task.task_key);
    owners.set(key, keys);
  }
  const groups = new Map<string, Map<string, IndexerTaskReading["material"][number]>>();
  for (const task of tasks) for (const block of task.material) {
    const key = keyOf(block);
    if (owners.get(key)!.size <= 1) continue;
    const groupKey = JSON.stringify([...owners.get(key)!].sort());
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
        return [`Read shared material: ./${resource.digest.slice(7)}.md (${resource.digest})`];
      }
      const heading = section === block.section ? "" : `## ${block.section}\n\n`;
      section = block.section;
      return [heading + block.markdown];
    });
    return { common, markdown: [task.introduction,
      "Shared links are relative to this file. Read only this task's referenced shared files; they do not extend its allowed source references.",
      ...material, task.conclusion].join("\n\n") };
  });
  return { readings, shared,
    input_bytes: [...readings, ...shared].reduce((sum, file) => sum + Buffer.byteLength(file.markdown), 0) };
}
