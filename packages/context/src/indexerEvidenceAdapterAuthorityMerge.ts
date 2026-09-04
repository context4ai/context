import {
  validateIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterResult,
} from "./indexerEvidenceAdapterResult.js";
import {
  validateIndexerParserExecutionPlan,
  type IndexerParserExecutionPlan,
  type IndexerParserExecutionPlanEntry,
} from "./indexerParserExecutionPlan.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export interface IndexerEvidenceAdapterExecution {
  capability: string;
  authority_domain: string;
  source_ref: string;
  module_ref: string | null;
  result: unknown;
}

export interface IndexerEvidenceAdapterAuthorityMerge {
  protocol: "context.indexer.evidence-adapter-authority-merge/v1";
  execution_plan_digest: string;
  result_digests: string[];
  primary_owners: Array<{
    source_ref: string;
    module_ref: string | null;
    normalized_path: string;
    authority_domain: string;
    capability: string;
    adapter_id: string;
    coverage_tier: string;
    disposition: "analyzed" | "unsupported" | "excluded";
  }>;
  facts: Array<IndexerEvidenceAdapterFact & {
    authority_domain: string;
    capability: string;
    adapter_id: string;
    precedence: number;
  }>;
  conflicts: Array<{
    authority_domain: string;
    fact_ref: string;
    winner_adapter_id: string;
    shadowed_adapter_ids: string[];
  }>;
  blockers: Array<{
    source_ref: string;
    normalized_path: string;
    authority_domain: string;
    capability: string;
    disposition: "unsupported" | "excluded";
  }>;
  toolchain_digest: string;
  merge_digest: string;
}

function moduleKey(value: string | null): string {
  return value ?? "";
}

function entryKey(value: {
  capability: string;
  authority_domain: string;
  source_ref: string;
  module_ref: string | null;
}): string {
  return [
    value.capability,
    value.source_ref,
    moduleKey(value.module_ref),
    value.authority_domain,
  ].join("\u0000");
}

function fileKey(value: {
  source_ref: string;
  normalized_path: string;
  authority_domain: string;
}): string {
  return [value.source_ref, value.normalized_path, value.authority_domain].join("\u0000");
}

function factKey(authorityDomain: string, factRef: string): string {
  return `${authorityDomain}\u0000${factRef}`;
}

function exactEntryFiles(
  entry: IndexerParserExecutionPlanEntry,
  result: IndexerEvidenceAdapterResult,
): void {
  const expected = entry.files.map((file) => ({
    normalized_path: file.normalized_path,
    module_ref: entry.module_ref,
    role: file.role,
  })).sort((left, right) => compareIndexerCanonicalText(
    `${left.normalized_path}\u0000${left.role}`,
    `${right.normalized_path}\u0000${right.role}`,
  ));
  const actual = result.files.map((file) => ({
    normalized_path: file.normalized_path,
    module_ref: file.module_ref,
    role: file.role,
  })).sort((left, right) => compareIndexerCanonicalText(
    `${left.normalized_path}\u0000${left.role}`,
    `${right.normalized_path}\u0000${right.role}`,
  ));
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(actual)) {
    throw new TypeError(`adapter Result file set does not match ${entry.capability} execution entry`);
  }
}

function mergeDigest(
  value: Omit<IndexerEvidenceAdapterAuthorityMerge, "merge_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function mergeIndexerEvidenceAdapterExecutions(input: {
  execution_plan: unknown;
  executions: readonly IndexerEvidenceAdapterExecution[];
}): IndexerEvidenceAdapterAuthorityMerge {
  const plan: IndexerParserExecutionPlan = validateIndexerParserExecutionPlan(
    input.execution_plan,
  );
  const entries = new Map(plan.entries.map((entry) => [entryKey(entry), entry]));
  const executions = new Map<string, {
    entry: IndexerParserExecutionPlanEntry;
    result: IndexerEvidenceAdapterResult;
  }>();
  for (const execution of input.executions) {
    const key = entryKey(execution);
    const entry = entries.get(key);
    if (entry === undefined) {
      throw new TypeError(`adapter execution is not authorized by the plan: ${key}`);
    }
    if (executions.has(key)) {
      throw new TypeError(`adapter execution is duplicated: ${key}`);
    }
    const result = validateIndexerEvidenceAdapterResult(execution.result);
    if (
      result.authorized_scope.source_ref !== entry.source_ref ||
      result.precedence !== entry.precedence
    ) {
      throw new TypeError(`adapter Result does not bind execution entry ${key}`);
    }
    exactEntryFiles(entry, result);
    executions.set(key, { entry, result });
  }
  if (executions.size !== entries.size) {
    const missing = [...entries.keys()].filter((key) => !executions.has(key));
    throw new TypeError(`parser execution plan has unexecuted entries: ${missing.join(", ")}`);
  }

  const resultDigests = [...executions.values()].map(({ result }) => result.output_digest)
    .sort(compareIndexerCanonicalText);
  if (new Set(resultDigests).size !== resultDigests.length) {
    throw new TypeError("parser executions must have unique Result digests");
  }
  const owners = new Map<string, IndexerEvidenceAdapterAuthorityMerge["primary_owners"][number]>();
  const blockers: IndexerEvidenceAdapterAuthorityMerge["blockers"] = [];
  const candidates = new Map<string, Array<{
    authority_domain: string;
    capability: string;
    fact: IndexerEvidenceAdapterFact;
    adapter_id: string;
    precedence: number;
  }>>();
  const toolchains: unknown[] = [];

  for (const { entry, result } of executions.values()) {
    toolchains.push({
      capability: entry.capability,
      authority_domain: entry.authority_domain,
      parser_lock_digest: entry.parser_lock_digest,
      result_digest: result.output_digest,
      toolchain: result.toolchain,
    });
    for (const file of result.files) {
      const key = fileKey({ ...file, authority_domain: entry.authority_domain });
      if (file.role === "primary-owner") {
        if (owners.has(key)) {
          throw new TypeError(`adapter executions have two primary owners for ${key}`);
        }
        owners.set(key, {
          source_ref: file.source_ref,
          module_ref: file.module_ref,
          normalized_path: file.normalized_path,
          authority_domain: entry.authority_domain,
          capability: entry.capability,
          adapter_id: result.adapter.id,
          coverage_tier: file.coverage_tier,
          disposition: file.disposition,
        });
        if (file.disposition !== "analyzed") {
          blockers.push({
            source_ref: file.source_ref,
            normalized_path: file.normalized_path,
            authority_domain: entry.authority_domain,
            capability: entry.capability,
            disposition: file.disposition,
          });
        }
      }
      for (const fact of file.facts) {
        const key = factKey(entry.authority_domain, fact.fact_ref);
        candidates.set(key, [...(candidates.get(key) ?? []), {
          authority_domain: entry.authority_domain,
          capability: entry.capability,
          fact,
          adapter_id: result.adapter.id,
          precedence: result.precedence,
        }]);
      }
    }
  }

  const expectedOwnerKeys = plan.applicability.filter((item) =>
    item.disposition === "applicable" && item.role === "primary-owner"
  ).map(fileKey).sort(compareIndexerCanonicalText);
  const actualOwnerKeys = [...owners.keys()].sort(compareIndexerCanonicalText);
  if (canonicalIndexerJson(expectedOwnerKeys) !== canonicalIndexerJson(actualOwnerKeys)) {
    throw new TypeError("adapter execution owners do not close the execution plan authority set");
  }

  const facts: IndexerEvidenceAdapterAuthorityMerge["facts"] = [];
  const conflicts: IndexerEvidenceAdapterAuthorityMerge["conflicts"] = [];
  for (const key of [...candidates.keys()].sort(compareIndexerCanonicalText)) {
    const values = candidates.get(key)!.sort((left, right) =>
      right.precedence - left.precedence ||
      compareIndexerCanonicalText(left.adapter_id, right.adapter_id)
    );
    if (new Set(values.map((value) => value.fact.denominator)).size > 1) {
      throw new TypeError(`adapter fact ${key} has conflicting denominator authority`);
    }
    const bestPrecedence = values[0]!.precedence;
    const best = values.filter((value) => value.precedence === bestPrecedence);
    if (new Set(best.map((value) => indexerProtocolDigest(value.fact))).size > 1) {
      throw new TypeError(`adapter fact ${key} has an equal-precedence conflict`);
    }
    const winner = best[0]!;
    facts.push({
      ...winner.fact,
      authority_domain: winner.authority_domain,
      capability: winner.capability,
      adapter_id: winner.adapter_id,
      precedence: winner.precedence,
    });
    const shadowed = values.filter((value) => value !== winner)
      .map((value) => value.adapter_id)
      .sort(compareIndexerCanonicalText);
    if (shadowed.length > 0) {
      conflicts.push({
        authority_domain: winner.authority_domain,
        fact_ref: winner.fact.fact_ref,
        winner_adapter_id: winner.adapter_id,
        shadowed_adapter_ids: shadowed,
      });
    }
  }

  const primaryOwners = [...owners.values()].sort((left, right) =>
    compareIndexerCanonicalText(fileKey(left), fileKey(right))
  );
  blockers.sort((left, right) => compareIndexerCanonicalText(fileKey(left), fileKey(right)));
  toolchains.sort((left, right) => compareIndexerCanonicalText(
    canonicalIndexerJson(left),
    canonicalIndexerJson(right),
  ));
  const payload: Omit<IndexerEvidenceAdapterAuthorityMerge, "merge_digest"> = {
    protocol: "context.indexer.evidence-adapter-authority-merge/v1",
    execution_plan_digest: plan.plan_digest,
    result_digests: resultDigests,
    primary_owners: primaryOwners,
    facts,
    conflicts,
    blockers,
    toolchain_digest: indexerProtocolDigest(toolchains),
  };
  return { ...payload, merge_digest: mergeDigest(payload) };
}
