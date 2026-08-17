import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  addFileSourceUnlocked,
  addLarkSourceUnlocked,
  defaultFileModule,
  defaultLarkModule,
  isDateSourceNamespace,
} from "./documentSourceRegistration.js";
import { addRepoSourceUnlocked } from "./repoSources.js";
import { withProjectWriteLock } from "./writeLock.js";

type SourceBatchItem =
  | { type: "repo"; module: string; local?: string; remote?: string; ref?: string }
  | { type: "file"; module: string; local: string; include?: readonly string[] }
  | { type: "lark"; module: string; url?: string; docToken?: string; wikiToken?: string; title?: string };

const ITEM_KEYS = {
  repo: new Set(["type", "module", "local", "remote", "ref"]),
  file: new Set(["type", "module", "local", "include"]),
  lark: new Set(["type", "module", "url", "docToken", "wikiToken", "title"]),
} as const;

function inputError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw inputError(`${path} must be an object`, { path });
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, field: string, path: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw inputError(`${path}.${field} must be a non-empty string`, { path: `${path}.${field}` });
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, field: string, path: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw inputError(`${path}.${field} must be a non-empty string when present`, { path: `${path}.${field}` });
  }
  return value.trim();
}

function optionalStringArray(record: Record<string, unknown>, field: string, path: string): string[] | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw inputError(`${path}.${field} must be an array of non-empty strings`, { path: `${path}.${field}` });
  }
  return value.map((entry) => (entry as string).trim());
}

function assertAllowedKeys(record: Record<string, unknown>, type: keyof typeof ITEM_KEYS, path: string): void {
  const unknown = Object.keys(record).filter((key) => !ITEM_KEYS[type].has(key as never));
  if (unknown.length > 0) {
    throw inputError(`${path} has unsupported field(s): ${unknown.join(", ")}`, { path, fields: unknown });
  }
}

function parseBatchItem(value: unknown, index: number): SourceBatchItem {
  const path = `sources[${index}]`;
  const record = recordAt(value, path);
  const type = requiredString(record, "type", path);
  if (type !== "repo" && type !== "file" && type !== "lark") {
    throw inputError(`${path}.type must be repo, file, or lark`, { path: `${path}.type` });
  }
  assertAllowedKeys(record, type, path);
  if (type === "repo") {
    const module = requiredString(record, "module", path);
    const local = optionalString(record, "local", path);
    const remote = optionalString(record, "remote", path);
    const ref = optionalString(record, "ref", path);
    return {
      type,
      module,
      ...(local !== undefined ? { local } : {}),
      ...(remote !== undefined ? { remote } : {}),
      ...(ref !== undefined ? { ref } : {}),
    };
  }
  if (type === "file") {
    const local = requiredString(record, "local", path);
    const module = optionalString(record, "module", path) ?? defaultFileModule(local);
    const include = optionalStringArray(record, "include", path);
    return {
      type,
      module,
      local,
      ...(include !== undefined ? { include } : {}),
    };
  }
  const url = optionalString(record, "url", path);
  const docToken = optionalString(record, "docToken", path);
  const wikiToken = optionalString(record, "wikiToken", path);
  const title = optionalString(record, "title", path);
  const module = optionalString(record, "module", path) ?? defaultLarkModule({
    ...(url !== undefined ? { url } : {}),
    ...(docToken !== undefined ? { docToken } : {}),
    ...(wikiToken !== undefined ? { wikiToken } : {}),
    ...(title !== undefined ? { title } : {}),
  });
  return {
    type,
    module,
    ...(url !== undefined ? { url } : {}),
    ...(docToken !== undefined ? { docToken } : {}),
    ...(wikiToken !== undefined ? { wikiToken } : {}),
    ...(title !== undefined ? { title } : {}),
  };
}

function parseBatchPayload(payload: unknown): SourceBatchItem[] {
  const values = Array.isArray(payload)
    ? payload
    : recordAt(payload, "payload").sources;
  if (!Array.isArray(values) || values.length === 0) {
    throw inputError("source add batch payload requires a non-empty sources array", { path: "sources" });
  }
  const items = values.map(parseBatchItem);
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(item.module)) {
      throw inputError(`sources[${index}].module must be a lowercase path-safe slug: ${item.module}`, {
        path: `sources[${index}].module`,
      });
    }
    if (seen.has(item.module)) {
      throw inputError(`sources[${index}].module duplicates another source identity in this date batch: ${item.module}`, {
        path: `sources[${index}].module`,
      });
    }
    seen.add(item.module);
  }
  return items;
}

export async function registerSourceBatch(input: {
  projectRoot: string;
  namespace: string;
  payload: unknown;
}): Promise<Record<string, unknown>> {
  if (!isDateSourceNamespace(input.namespace)) {
    throw inputError(`source add batch date must be a valid YYYYMMDD date: ${input.namespace}`, {
      path: "date",
    });
  }
  const items = parseBatchPayload(input.payload);
  return withProjectWriteLock(input.projectRoot, "source-add-batch", async () => {
    const registered: Record<string, unknown>[] = [];
    for (const [index, item] of items.entries()) {
      try {
        const result = item.type === "repo"
          ? await addRepoSourceUnlocked({ projectRoot: input.projectRoot, namespace: input.namespace, ...item })
          : item.type === "file"
            ? await addFileSourceUnlocked({
                projectRoot: input.projectRoot,
                namespace: input.namespace,
                name: `${input.namespace}/${item.module}`,
                ...item,
              })
            : await addLarkSourceUnlocked({
                projectRoot: input.projectRoot,
                namespace: input.namespace,
                name: `${input.namespace}/${item.module}`,
                ...item,
              });
        registered.push({ index, type: item.type, module: item.module, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof ContextError ? error.code : ExitCode.WorkspaceStateError;
        throw new ContextError(code, `source batch stopped at sources[${index}] (${item.type}:${item.module}): ${message}`, {
          ...(error instanceof ContextError ? error.detail : {}),
          batch_completed: registered.map((entry) => ({ type: entry.type, module: entry.module })),
          failed_index: index,
          next: "Fix the failed item and rerun the same batch. Completed items are idempotently updated; do not edit registry YAML by hand.",
        });
      }
    }
    return {
      kind: "source.registration.batch",
      namespace: input.namespace,
      total: registered.length,
      registered,
    };
  });
}
