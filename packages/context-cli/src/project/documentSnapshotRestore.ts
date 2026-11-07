import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { z } from "zod";
import { computeDocumentContentHash, type DocumentSnapshotManifest } from "@c4a/extract";
import { applyAtomicFileBatch } from "../lib/atomicFileBatch.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { parseLarkCaptureReport } from "../lib/larkCaptureReport.js";
import { readDocumentSourcesRegistry } from "./documentSources.js";
import { findDocumentSnapshotForSource, readDocumentManifestFile, renderDocumentManifestFile, updateDocumentManifestFile } from "./documentBatchManifest.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { assertSourceInputMutable } from "./sourceInputMutation.js";
import { withProjectWriteLock } from "./writeLock.js";
import { larkSnapshotIdentityDiagnostic } from "./larkSourceIdentity.js";
import type { LarkSourceRegistryEntry } from "@c4a/context";

const exec = promisify(execFile);
const requestSchema = z.object({ type: z.enum(["file", "lark"]), name: z.string().min(1), commit: z.string().min(1).optional() }).strict();

export async function restoreDocumentSnapshot(projectRoot: string, value: unknown) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new ContextError(ExitCode.UserError, "Document restore requires type, name, and an optional Git commit.", {
    category: ErrorCategory.UserInputInvalid, expected_shape: { type: "lark", name: "handbook", commit: "optional-commit" },
  });
  const input = parsed.data;
  return withProjectWriteLock(projectRoot, "source-restore-document", async () => {
    await assertSourceInputMutable(projectRoot, `${input.type}:${input.name}`);
    const registry = await readDocumentSourcesRegistry(projectRoot);
    const source = (input.type === "lark" ? registry.larks : registry.files).find(entry => entry.name === input.name);
    if (!source) throw new ContextError(ExitCode.UserError, `Unknown ${input.type} source: ${input.name}`, { category: ErrorCategory.UserInputInvalid });
    const manifestPath = source.snapshot?.manifest ?? `${source.materializedAt}/manifest.json`;
    const manifestTarget = await safeProjectTarget(projectRoot, manifestPath);
    const git = async (args: string[]) => (await exec("git", args, { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 })).stdout;
    const prefix = (await git(["rev-parse", "--show-prefix"])).trim();
    const commits = input.commit === undefined
      ? (await git(["log", "--format=%H", "--", manifestPath])).trim().split("\n").filter(Boolean)
      : [(await git(["rev-parse", "--verify", "--end-of-options", `${input.commit}^{commit}`])).trim()];
    const blob = async (commit: string, path: string) => (await exec("git", ["show", `${commit}:${prefix}${path}`], {
      cwd: projectRoot, encoding: "buffer", maxBuffer: 256 * 1024 * 1024,
    })).stdout;
    let selected: { commit: string; snapshot: DocumentSnapshotManifest; files: Map<string, Buffer> } | undefined;
    for (const commit of commits) {
      try {
        const snapshot = findDocumentSnapshotForSource(JSON.parse((await blob(commit, manifestPath)).toString("utf8")), input.name);
        if (!snapshot || snapshot.source_type !== input.type) continue;
        if (input.type === "lark") {
          const mismatch = larkSnapshotIdentityDiagnostic(source as LarkSourceRegistryEntry, snapshot);
          if (mismatch !== null) throw new Error(mismatch);
        }
        const files = new Map<string, Buffer>();
        for (const file of [...snapshot.files, ...(snapshot.assets ?? [])]) {
          if (file.content_hash === undefined) continue;
          const path = `${source.materializedAt}/${file.path}`;
          await safeProjectTarget(projectRoot, path);
          const bytes = await blob(commit, path);
          if (computeDocumentContentHash(bytes) !== file.content_hash) throw new Error(`Historical snapshot hash mismatch: ${file.path}`);
          files.set(path, bytes);
        }
        if (input.type === "lark") {
          const report = snapshot.metadata?.capture?.report;
          if (!report) throw new Error("Historical document has no capture completeness report");
          const bytes = files.get(`${source.materializedAt}/${report.path}`);
          if (!bytes) throw new Error("Historical capture report is missing");
          const capture = parseLarkCaptureReport(JSON.parse(bytes.toString("utf8")));
          if (input.commit === undefined && (capture.fidelity.evidence_status === "error" || capture.fidelity.projection_status === "error")) {
            throw new Error("Historical capture is incomplete");
          }
        }
        selected = { commit, snapshot, files };
        break;
      } catch (error) {
        if (input.commit !== undefined) throw new ContextError(ExitCode.WorkspaceStateError, `Cannot restore the selected snapshot: ${error instanceof Error ? error.message : String(error)}`, {
          category: ErrorCategory.WorkspaceStateInvalid, next: "Select a complete historical capture or recapture this source.",
        });
      }
    }
    if (!selected) throw new ContextError(ExitCode.WorkspaceStateError, "No complete document snapshot was found in Git history.", {
      category: ErrorCategory.WorkspaceStateInvalid, next: "Pass an explicit commit in the restore request, or recapture the document.",
    });
    let current: unknown | null;
    let previous: DocumentSnapshotManifest | null;
    try {
      current = await readDocumentManifestFile(manifestTarget);
      previous = current === null ? null : findDocumentSnapshotForSource(current, input.name);
    } catch {
      if (input.name.includes("/")) throw new ContextError(ExitCode.WorkspaceStateError,
        "The shared batch manifest is invalid. Restore that manifest from Git before restoring one source; sibling entries must be preserved.",
        { category: ErrorCategory.WorkspaceStateInvalid, next: "Restore the shared manifest from its known-good Git version, then retry." });
      current = null; previous = null;
    }
    const next = updateDocumentManifestFile({ current, snapshot: selected.snapshot });
    const removals = [...(previous?.files ?? []), ...(previous?.assets ?? [])]
      .map(file => `${source.materializedAt}/${file.path}`)
      .filter(path => !selected.files.has(path) && !renderDocumentManifestFile(next).includes(path.slice(source.materializedAt.length + 1)));
    const removalTargets = await Promise.all(removals.map(path => safeProjectTarget(projectRoot, path)));
    await applyAtomicFileBatch({ transactionRoot: join(projectRoot, ".tmp/context-runtime/capture-transactions"),
      writes: [...selected.files].map(([path, bytes]) => ({ path: join(projectRoot, path), bytes })).concat([
        { path: manifestTarget, bytes: Buffer.from(renderDocumentManifestFile(next)) },
      ]), removals: removalTargets,
    });
    return { source: `${input.type}:${input.name}`, commit: selected.commit, files_restored: selected.files.size,
      next_action: { command: "context status --format json" } };
  });
}
