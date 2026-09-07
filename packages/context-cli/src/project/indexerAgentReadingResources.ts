import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { indexerProtocolDigest, type IndexerAuthorizedWorksetView, type IndexerMainWorkset } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { buildIndexerTaskReading, readingBlock, renderIndexerInstructionsReading, renderIndexerWorksetReading } from "./indexerAgentReading.js";
import { renderIndexerBatchReading } from "./indexerBatchReading.js";

type Ready = { path: string; digest: string };

async function persistReading(sourcePath: string, markdown: string) {
  const digest = `sha256:${createHash("sha256").update(markdown).digest("hex")}`;
  const path = join(dirname(sourcePath), `${digest.slice(7)}.md`);
  let unchanged = false;
  try { unchanged = await readFile(path, "utf8") === markdown; } catch { /* Rebuildable runtime presentation. */ }
  if (!unchanged) await atomicWriteFile(path, markdown);
  return { path, digest, media_type: "text/markdown" as const };
}

export async function prepareIndexerInstructionsReading(ready: Ready) {
  const value = JSON.parse(await readFile(ready.path, "utf8")) as { payload_digest?: string };
  if (value.payload_digest !== ready.digest) throw new TypeError("Indexer instruction reading uses a stale resource");
  return persistReading(ready.path, renderIndexerInstructionsReading(value));
}

export async function prepareIndexerWorksetReadings(inputs: readonly {
  ready: Ready; task_key: string; workset: IndexerMainWorkset;
}[]) {
  const views = await Promise.all(inputs.map(async (input) => {
    const view = JSON.parse(await readFile(input.ready.path, "utf8")) as IndexerAuthorizedWorksetView;
    if (indexerProtocolDigest(view) !== input.ready.digest || view.workset_digest !== input.workset.workset_digest) {
      throw new TypeError("Indexer task reading uses a stale View");
    }
    return { view, workset: input.workset, task_key: input.task_key };
  }));
  if (views.length > 0 && views.every((input) => input.workset.stage === views[0]!.workset.stage)) {
    const batch = renderIndexerBatchReading(views.map(buildIndexerTaskReading));
    // Partition packing still measures individual readings conservatively.
    // Share only when the actual file fits within that existing budget.
    const separateBytes = views.reduce((sum, input) => sum + Buffer.byteLength(renderIndexerWorksetReading(input)), 0);
    if (views[0]!.workset.stage === "author" || batch.input_bytes <= separateBytes) {
      const reading = await persistReading(inputs[0]!.ready.path, batch.markdown);
      // Existing per-task Resource IDs still resolve, but their common file is
      // read once. No extra discovery command or reading receipt is needed.
      return inputs.map(() => reading);
    }
  }
  return Promise.all(views.map((input, index) =>
    persistReading(inputs[index]!.ready.path, renderIndexerWorksetReading(input))));
}

export async function prepareIndexerPostAuthorReading(ready: Ready) {
  const value = JSON.parse(await readFile(ready.path, "utf8")) as { view_digest?: string };
  if (value.view_digest !== ready.digest) throw new TypeError("Indexer composer reading uses a stale View");
  return persistReading(ready.path, `# Current composer material\n\n${readingBlock(value)}\n`);
}
