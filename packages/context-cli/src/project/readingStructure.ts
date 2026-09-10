import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import {
  canonicalIndexerJson, indexerProtocolDigest, updateReadingStructure, validateReadingStructure,
  type IndexerProjectFileTarget, type ReadingStructure, type ReadingStructureUpdate,
} from "@c4a/context";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { recoverDurableMultiFileTransactions, runDurableMultiFileTransaction, type DurableMultiFileFailureInjector } from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

export const READING_STRUCTURE_PATH = "src/reading-structure.yaml";
async function optionalText(root: string, path: string): Promise<string | undefined> {
  try { return await readFile(join(root, path), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function readReadingStructure(root: string): Promise<ReadingStructure | undefined> {
  const content = await optionalText(root, READING_STRUCTURE_PATH);
  return content === undefined ? undefined : validateReadingStructure(parse(content));
}

/** Called by the existing structure acceptance, never by parsing a prose report.
 * The decision and organization recover together under the workspace write lock. */
export async function acceptStructureDecision(input: {
  projectRoot: string;
  decisionPath: string;
  revision: string;
  reading_structure?: ReadingStructureUpdate;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, "accept-reading-structure", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readReadingStructure(input.projectRoot);
    const next = input.reading_structure === undefined ? current : updateReadingStructure(current, input.reading_structure);
    const writes = [{ path: input.decisionPath, content: canonicalIndexerJson({ revision: input.revision, decision: "approved" }) }];
    if (input.reading_structure !== undefined) writes.push({ path: READING_STRUCTURE_PATH, content: stringify(next) });
    const targets: IndexerProjectFileTarget[] = await Promise.all(writes.sort((a, b) => a.path < b.path ? -1 : 1).map(async write => {
      const previous = await optionalText(input.projectRoot, write.path);
      return { ...write, operation: "write" as const, base_digest: previous === undefined ? null : durableContentDigest(previous), target_digest: durableContentDigest(write.content) };
    }));
    return runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "accept-reading-structure",
      proposal_digest: indexerProtocolDigest({ revision: input.revision, reading_structure: next ?? null }), targets,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }) });
  });
}

/** A navigation-only adjustment changes no source, Author task or approved body. */
export async function applyReadingStructureUpdate(projectRoot: string, update: ReadingStructureUpdate) {
  return withProjectWriteLock(projectRoot, "adjust-reading-structure", async () => {
    await recoverDurableMultiFileTransactions(projectRoot);
    const current = await readReadingStructure(projectRoot);
    const next = updateReadingStructure(current, update);
    const content = stringify(next);
    const previous = await optionalText(projectRoot, READING_STRUCTURE_PATH);
    await runDurableMultiFileTransaction({ projectRoot, kind: "adjust-reading-structure", proposal_digest: next.revision,
      targets: [{ path: READING_STRUCTURE_PATH, operation: "write", content,
        base_digest: previous === undefined ? null : durableContentDigest(previous), target_digest: durableContentDigest(content) }] });
    return { outcome: "reading-structure-updated" as const, revision: next.revision,
      next_action: { command: "context status --format json", message: "Reading organization changed; rebuild affected outputs through the current workflow. Source parsing and article writing are unchanged." } };
  });
}
