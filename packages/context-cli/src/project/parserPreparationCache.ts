import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import type { IndexerParserRuntimeEntryInput } from "./indexerParserRuntimeExecution.js";

/** One last successful preparation per source/capability. Publication is atomic;
 * an interrupted sibling entry does not discard already prepared language work.
 * Callers bind the key to the pinned source boundary and verified parser binary.
 */
export async function cachedParserPreparation(input: {
  projectRoot: string;
  slot: unknown;
  identity: unknown;
  entryDigest: string;
  prepare: () => Promise<IndexerParserRuntimeEntryInput>;
  onHit?: () => void;
}): Promise<IndexerParserRuntimeEntryInput> {
  const root = join(input.projectRoot, ".tmp/context-runtime/parser-preparations");
  const name = indexerProtocolDigest(input.slot).replace("sha256:", "");
  const path = join(root, `${name}.json`);
  const identity = indexerProtocolDigest({ protocol: "parser-preparation/v1", input: input.identity });
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  try {
    const text = await readFile(path, "utf8");
    const separator = text.indexOf("\n");
    const record = JSON.parse(text.slice(0, separator));
    const payload = text.slice(separator + 1);
    if (record.identity === identity && hash(payload) === record.digest) {
      const prepared = JSON.parse(payload) as IndexerParserRuntimeEntryInput;
      if (prepared.entry_digest === input.entryDigest && prepared.files && typeof prepared.files === "object") {
        input.onHit?.();
        return prepared;
      }
    }
  } catch {
    // Missing, incomplete or corrupt checkpoint: prepare from the pinned source.
  }
  const prepared = await input.prepare();
  const payload = JSON.stringify(prepared);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(temporary, `${JSON.stringify({ identity, digest: hash(payload) })}\n${payload}`);
    await rename(temporary, path);
  } catch {
    process.stderr.write("[context parser] preparation checkpoint unavailable; continuing with the computed result\n");
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return prepared;
}
