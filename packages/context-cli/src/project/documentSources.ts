import {
  loadSourcesRegistry,
  type FileSourceDefinition,
  type FileSourceRegistryEntry,
  type LarkSourceDefinition,
  type LarkSourceRegistryEntry,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export interface DocumentSourcesRegistryView {
  files: readonly FileSourceRegistryEntry[];
  larks: readonly LarkSourceRegistryEntry[];
  registryPaths: {
    file: string;
    lark: string;
  };
}

function toContextError(error: unknown): ContextError {
  if (error instanceof ContextError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
  });
}

export async function readDocumentSourcesRegistry(projectRoot: string): Promise<DocumentSourcesRegistryView> {
  try {
    const registry = await loadSourcesRegistry({ rootDir: projectRoot });
    return {
      files: registry.files,
      larks: registry.larks,
      registryPaths: {
        file: registry.registryPaths.file,
        lark: registry.registryPaths.lark,
      },
    };
  } catch (error) {
    throw toContextError(error);
  }
}

export function fileSourceDefinition(entry: FileSourceRegistryEntry): FileSourceDefinition {
  return {
    kind: "source.file",
    id: entry.id,
    name: entry.name,
    ...(entry.namespace !== undefined ? { namespace: entry.namespace } : {}),
    ...(entry.module !== undefined ? { module: entry.module } : {}),
    materializedAt: entry.materializedAt,
    ...(entry.local !== undefined ? { local: entry.local } : {}),
    ...(entry.include !== undefined ? { include: entry.include } : {}),
    ...(entry.snapshot !== undefined ? { snapshot: entry.snapshot } : {}),
  };
}

export function larkSourceDefinition(entry: LarkSourceRegistryEntry): LarkSourceDefinition {
  return {
    kind: "source.lark",
    id: entry.id,
    name: entry.name,
    ...(entry.namespace !== undefined ? { namespace: entry.namespace } : {}),
    ...(entry.module !== undefined ? { module: entry.module } : {}),
    materializedAt: entry.materializedAt,
    ...(entry.url !== undefined ? { url: entry.url } : {}),
    ...(entry.docToken !== undefined ? { docToken: entry.docToken } : {}),
    ...(entry.wikiToken !== undefined ? { wikiToken: entry.wikiToken } : {}),
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.snapshot !== undefined ? { snapshot: entry.snapshot } : {}),
  };
}
