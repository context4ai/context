import {
  canonicalIndexerJson,
  indexerParserExecutionEntryDigest,
  indexerProtocolDigest,
  type IndexerEvidenceAdapterResult,
  type IndexerParserExecutionPlanEntry,
  type IndexerParserFactView,
  type IndexerParserResolutionLock,
} from "@c4a/context";
import type { IndexerParserImportReceipt } from "./indexerParserRuntimeImport.js";
import type {
  IndexerParserRuntimeExecutionReceipt,
  IndexerParserRuntimeSourceBinding,
} from "./indexerParserRuntimeExecution.js";

export interface ReusableIndexerParserSource {
  source_binding: IndexerParserRuntimeSourceBinding;
  fact_view: IndexerParserFactView;
  executions: Array<{
    entry: IndexerParserExecutionPlanEntry;
    result: IndexerEvidenceAdapterResult;
    receipt: IndexerParserImportReceipt;
  }>;
}

function sourceKey(value: { source_ref: string; module_ref: string | null }): string {
  return `${value.source_ref}\u0000${value.module_ref ?? ""}`;
}

function factViewSourceKey(value: IndexerParserFactView): string {
  return sourceKey({
    source_ref: value.authorized_scope.source_ref,
    module_ref: value.authorized_scope.module_refs[0] ?? null,
  });
}

function uniqueByCapability<T extends { capability: string }>(
  values: readonly T[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.capability)) return new Map();
    result.set(value.capability, value);
  }
  return result;
}

export function indexerParserEntryRole(
  entry: IndexerParserExecutionPlanEntry,
): "primary-owner" | "enricher" {
  const roles = new Set(entry.files.map((file) => file.role));
  if (roles.size !== 1) {
    throw new TypeError(`parser execution entry ${entry.capability} mixes owner roles`);
  }
  return entry.files[0]!.role;
}

export function indexerParserEntryExecutionInputDigest(
  entry: IndexerParserExecutionPlanEntry,
): string {
  return indexerProtocolDigest({
    entry_digest: indexerParserExecutionEntryDigest(entry),
    parser_lock_digest: entry.parser_lock_digest,
    source_content_digests: entry.files.map((file) => file.content_digest),
  });
}

export function assertIndexerParserResultIdentity(input: {
  result: IndexerEvidenceAdapterResult;
  capability: string;
  coordinate: IndexerParserResolutionLock["actual_coordinate"];
  resolvedContentDigest: string;
}): void {
  const expected = {
    id: input.capability,
    package: input.coordinate.package,
    export: input.coordinate.export,
    version: input.coordinate.version,
    digest: input.resolvedContentDigest,
  };
  if (canonicalIndexerJson(input.result.adapter) !== canonicalIndexerJson(expected)) {
    throw new TypeError(`adapter Result identity does not match ${input.capability} lock`);
  }
  const first = input.result.toolchain[0]!;
  if (
    first.package !== expected.package || first.export !== expected.export ||
    first.version !== expected.version || first.digest !== expected.digest
  ) {
    throw new TypeError(`adapter Result toolchain does not start from ${input.capability} lock`);
  }
}

function resultMatchesEntry(input: {
  result: IndexerEvidenceAdapterResult;
  entry: IndexerParserExecutionPlanEntry;
  lock: IndexerParserResolutionLock;
}): boolean {
  const expectedModules = input.entry.module_ref === null ? [] : [input.entry.module_ref];
  const expectedPaths = input.entry.files.map((file) => file.normalized_path).sort();
  const resultPaths = input.result.files.map((file) => file.normalized_path).sort();
  if (
    input.result.adapter.id !== input.entry.capability ||
    input.result.authorized_scope.source_ref !== input.entry.source_ref ||
    canonicalIndexerJson(input.result.authorized_scope.module_refs) !==
      canonicalIndexerJson(expectedModules) ||
    canonicalIndexerJson(resultPaths) !== canonicalIndexerJson(expectedPaths) ||
    input.result.input_digest !== indexerParserEntryExecutionInputDigest(input.entry) ||
    input.result.precedence !== input.entry.precedence ||
    input.result.files.some((file) => file.role !== indexerParserEntryRole(input.entry))
  ) return false;
  try {
    assertIndexerParserResultIdentity({
      result: input.result,
      capability: input.entry.capability,
      coordinate: input.lock.actual_coordinate,
      resolvedContentDigest: input.lock.resolved_content_digest,
    });
    return true;
  } catch {
    return false;
  }
}

export function collectReusableIndexerParserSources(input: {
  previous_execution?: IndexerParserRuntimeExecutionReceipt;
  entries: readonly IndexerParserExecutionPlanEntry[];
  locks: readonly IndexerParserResolutionLock[];
  profile_contract_digest: string;
}): Map<string, ReusableIndexerParserSource> {
  const previous = input.previous_execution;
  if (previous === undefined || previous.profile_contract_digest !== input.profile_contract_digest) {
    return new Map();
  }
  const locks = uniqueByCapability(input.locks);
  if (locks.size !== input.locks.length) return new Map();
  const grouped = new Map<string, IndexerParserExecutionPlanEntry[]>();
  for (const entry of input.entries) {
    const key = sourceKey(entry);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  const reusable = new Map<string, ReusableIndexerParserSource>();
  for (const [key, entries] of grouped) {
    const binding = previous.source_bindings.find((candidate) => sourceKey(candidate) === key);
    const view = previous.fact_views.find((candidate) => factViewSourceKey(candidate) === key);
    if (binding === undefined || view === undefined) continue;
    const expectedEntryDigests = entries.map(indexerParserExecutionEntryDigest).sort();
    if (canonicalIndexerJson(expectedEntryDigests) !== canonicalIndexerJson(binding.entry_digests)) {
      continue;
    }
    const executions: ReusableIndexerParserSource["executions"] = [];
    for (const entry of entries) {
      const lock = locks.get(entry.capability);
      if (lock === undefined || lock.lock_digest !== entry.parser_lock_digest) break;
      const results = previous.adapter_results.filter((result) =>
        resultMatchesEntry({ result, entry, lock })
      );
      const receipts = previous.import_receipts.filter((receipt) =>
        receipt.capability === entry.capability &&
        receipt.parser_lock_digest === entry.parser_lock_digest
      );
      if (results.length !== 1 || receipts.length !== 1) break;
      executions.push({ entry, result: results[0]!, receipt: receipts[0]! });
    }
    if (executions.length !== entries.length) continue;
    const resultDigests = executions.map(({ result }) => result.output_digest).sort();
    const receiptDigests = executions.map(({ receipt }) => receipt.receipt_digest).sort();
    if (
      canonicalIndexerJson(resultDigests) !== canonicalIndexerJson(binding.result_digests) ||
      canonicalIndexerJson(receiptDigests) !== canonicalIndexerJson(binding.import_receipt_digests) ||
      canonicalIndexerJson(view.origin_result_digests) !== canonicalIndexerJson(resultDigests)
    ) continue;
    reusable.set(key, { source_binding: binding, fact_view: view, executions });
  }
  return reusable;
}
