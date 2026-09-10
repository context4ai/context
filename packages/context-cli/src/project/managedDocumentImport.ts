import { readFile } from "node:fs/promises";
import { z } from "zod";
import { assertManagedDocumentPath, sessionChangesSchema, writeSessionChanges, readSessionChanges } from "@c4a/context";
import { withProjectWriteLock } from "./writeLock.js";
import { durableContentDigest, runDurableSingleFileTransaction } from "./durableSingleFileTransaction.js";

const inputSchema = z.object({ type: z.enum(["note", "sessions"]), name: z.string().min(1),
  changes: sessionChangesSchema.optional(),
  markdown: z.string().trim().min(1), base_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional() }).strict();

export async function importManagedDocument(projectRoot: string, value: unknown) {
  const input = inputSchema.parse(value);
  if (input.type !== "sessions" && input.changes !== undefined) throw new TypeError("changes metadata is only supported for sessions sources");
  return withProjectWriteLock(projectRoot, "import-managed-document", async () => {
    const path = await assertManagedDocumentPath(projectRoot, input.type, input.name);
    let previous: string | undefined;
    try { previous = await readFile(path, "utf8"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const markdown = input.type === "sessions"
      ? writeSessionChanges(`${input.markdown}\n`, input.changes ??
        (readSessionChanges(input.markdown) === undefined && previous !== undefined ? readSessionChanges(previous) : undefined)) : `${input.markdown}\n`;
    const sourceRef = `${input.type}:${input.name}`;
    const receipt = { source_ref: sourceRef, path: `sources/${input.type}/${input.name}`, digest: durableContentDigest(markdown) };
    if (previous === markdown) return { ...receipt, outcome: "unchanged" as const };
    if (previous !== undefined) {
      if (input.base_digest !== durableContentDigest(previous)) {
        throw new TypeError("This document already exists. Read it and supply its current base_digest to revise it, or choose a distinct semantic filename for independent material.");
      }
      const { assertSourceInputMutable } = await import("./sourceInputMutation.js");
      await assertSourceInputMutable(projectRoot, sourceRef);
    } else if (input.base_digest !== undefined) {
      throw new TypeError("The document to revise no longer exists; refresh its current path before retrying.");
    }
    await runDurableSingleFileTransaction({ projectRoot, kind: "import-managed-document",
      target_path: receipt.path, expected_base_digest: previous === undefined ? null : durableContentDigest(previous),
      target_content: markdown });
    return { ...receipt, outcome: "saved" as const };
  });
}
