import { planIndexerReadingFiles } from "./indexerReadingFiles.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { indexerProtocolDigest, type IndexerAuthorizedWorksetView, type IndexerMainWorkset } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { buildIndexerTaskReading, renderIndexerInstructionsReading } from "./indexerAgentReading.js";
import { renderIndexerPostAuthorReading } from "./indexerPostAuthorReading.js";
import type { IndexerPrimaryResultView } from "@c4a/context";

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
  const plan = planIndexerReadingFiles(views.map(buildIndexerTaskReading));
  const commonFiles = new Map(await Promise.all(plan.shared.map(async (block) =>
    [block.digest, await persistReading(inputs[0]!.ready.path, block.markdown)] as const)));
  return Promise.all(plan.readings.map(async (task, index) => ({
    ...await persistReading(inputs[index]!.ready.path, task.markdown),
    common: task.common.map((block) => commonFiles.get(block.digest)!),
  })));
}

export async function prepareIndexerPostAuthorReading(ready: Ready) {
  const value = JSON.parse(await readFile(ready.path, "utf8")) as IndexerPrimaryResultView;
  if (value.view_digest !== ready.digest) throw new TypeError("Indexer composer reading uses a stale View");
  return persistReading(ready.path, renderIndexerPostAuthorReading(value));
}
