import type { FileSourceRegistryEntry, LarkSourceRegistryEntry, DocumentSourceType } from "@c4a/context";
import type { DocumentSnapshotManifest } from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { fileSourceIncludeMismatchDiagnostic } from "./documentCapture.js";
import { larkSnapshotIdentityDiagnostic } from "./larkSourceIdentity.js";

function staleSnapshotError(input: {
  sourceType: DocumentSourceType;
  sourceName: string;
  message: string;
}): ContextError {
  const command = `context run capture:${input.sourceType}:${input.sourceName}`;
  return new ContextError(
    ExitCode.WorkspaceStateError,
    `document source ${input.sourceType}:${input.sourceName} snapshot is stale: ${input.message}`,
    {
      category: ErrorCategory.WorkspaceStateInvalid,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      diagnostics: [{
        severity: "error",
        code: "snapshot.stale",
        family: "stale",
        message: input.message,
      }],
      repair_hints: [{
        action: "rerun_capture",
        command,
        reason: "The registry source definition changed after the committed snapshot was captured.",
      }],
      next: command,
    },
  );
}

export function assertDocumentSnapshotFresh(input: {
  projectRoot?: string;
  sourceType: DocumentSourceType;
  sourceName: string;
  entry: FileSourceRegistryEntry | LarkSourceRegistryEntry;
  manifest: DocumentSnapshotManifest;
}): void {
  const diagnostic = input.sourceType === "file"
    ? fileSourceIncludeMismatchDiagnostic({
        manifest: input.manifest,
        source: input.entry as FileSourceRegistryEntry,
        ...(input.projectRoot === undefined ? {} : {
          projectRoot: input.projectRoot,
          materializedAt: input.entry.materializedAt,
        }),
      })
    : larkSnapshotIdentityDiagnostic(input.entry as LarkSourceRegistryEntry, input.manifest);
  if (diagnostic === null) return;
  throw staleSnapshotError({
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    message: diagnostic,
  });
}
