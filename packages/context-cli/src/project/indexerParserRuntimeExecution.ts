import { createHash } from "node:crypto";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  assertIndexerParserDependenciesLocked,
  buildIndexerMergedParserFactView,
  buildIndexerSourceIdentityInventory,
  indexerParserExecutionEntryDigest,
  indexerProtocolDigest,
  mergeIndexerEvidenceAdapterExecutions,
  validateIndexerParserFactView,
  validateIndexerSourceIdentityInventory,
  validateIndexerEvidenceAdapterResult,
  validateIndexerParserExecutionPlan,
  type IndexerEvidenceAdapterAuthorityMerge,
  type IndexerEvidenceAdapterExecution,
  type IndexerEvidenceAdapterResult,
  type IndexerParserCoordinateMapping,
  type IndexerParserExecutionPlanEntry,
  type IndexerParserFactPayload,
  type IndexerParserFactView,
  type IndexerParserRequirement,
  type IndexerParserResolutionLock,
  type IndexerProfileContract,
  type IndexerSourceIdentityFact,
  type IndexerSourceIdentityInventory,
} from "@c4a/context";
import { redactIndexerOutputText } from "@c4a/core";
import {
  loadProjectIndexerParser,
  validateIndexerParserImportReceipt,
  type IndexerParserImportReceipt,
} from "./indexerParserRuntimeImport.js";

export interface IndexerParserRuntimeEntryInput {
  entry_digest: string;
  files: Readonly<Record<string, string>>;
  prepared_input?: unknown;
  adapter_options?: Readonly<Record<string, unknown>>;
  parser_options?: Readonly<Record<string, unknown>>;
}

export interface IndexerParserRuntimeExecutionReceipt {
  protocol: "context.indexer.parser-runtime-execution/v1";
  execution_plan_digest: string;
  profile_contract_digest: string;
  dependency_intent_set_digest: string;
  import_receipts: IndexerParserImportReceipt[];
  adapter_results: IndexerEvidenceAdapterResult[];
  merge: IndexerEvidenceAdapterAuthorityMerge;
  source_bindings: IndexerParserRuntimeSourceBinding[];
  fact_views: IndexerParserFactView[];
  execution_digest: string;
}

export interface IndexerParserRuntimeSourceBinding {
  source_ref: string;
  module_ref: string | null;
  entry_digests: string[];
  parser_lock_digests: string[];
  import_receipt_digests: string[];
  result_digests: string[];
  eligible_inventory_digest: string;
  source_merge_digest: string;
  source_toolchain_digest: string;
  source_identity_inventory: IndexerSourceIdentityInventory;
  binding_digest: string;
}

const PREPARED_INPUT_CAPABILITIES = new Set([
  "parser.typescript",
  "parser.javascript",
  "parser.go",
  "parser.rush",
]);

function contentDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function sourceKey(value: { source_ref: string; module_ref: string | null }): string {
  return `${value.source_ref}\u0000${value.module_ref ?? ""}`;
}

function factViewSourceKey(value: IndexerParserFactView): string {
  if (value.authorized_scope.module_refs.length > 1) {
    throw new TypeError("parser fact view cannot span multiple source modules");
  }
  return `${value.authorized_scope.source_ref}\u0000${
    value.authorized_scope.module_refs[0] ?? ""
  }`;
}

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must contain unique digests`);
  }
  return sorted;
}

function sourceBindingDigest(
  value: Omit<IndexerParserRuntimeSourceBinding, "binding_digest">,
): string {
  return indexerProtocolDigest(value);
}

function sourceIdentityFact(
  fact: IndexerEvidenceAdapterAuthorityMerge["facts"][number],
): IndexerSourceIdentityFact {
  return {
    fact_ref: fact.fact_ref,
    fact_kind: fact.kind,
    qualified_item_path: fact.locator.qualified_item_path,
    signature_digest: fact.locator.signature_digest,
  };
}

function buildSourceBindings(input: {
  plan: ReturnType<typeof validateIndexerParserExecutionPlan>;
  merge: IndexerEvidenceAdapterAuthorityMerge;
  executions: readonly {
    entry: IndexerParserExecutionPlanEntry;
    result: IndexerEvidenceAdapterResult;
    receipt: IndexerParserImportReceipt;
  }[];
}): IndexerParserRuntimeSourceBinding[] {
  const keys = [...new Set(input.plan.entries.map(sourceKey))].sort();
  return keys.map((key) => {
    const executions = input.executions.filter(({ entry }) => sourceKey(entry) === key);
    const first = executions[0]?.entry;
    if (first === undefined) throw new TypeError(`parser runtime lacks execution for ${key}`);
    const applicability = input.plan.applicability.filter((item) => sourceKey(item) === key);
    const primaryOwners = input.merge.primary_owners.filter((owner) => sourceKey(owner) === key);
    const sourceFactValues = input.merge.facts.filter((fact) => sourceKey(fact.locator) === key);
    const sourceFactRefs = new Set(sourceFactValues.map((fact) => fact.fact_ref));
    const conflicts = input.merge.conflicts.filter((conflict) =>
      sourceFactRefs.has(conflict.fact_ref)
    );
    // Source identity describes the complete parser-owned file set, not only
    // files that yielded semantic facts. Unsupported files remain addressable
    // with an empty fact list so downstream catalog-only handling can account
    // for them without weakening parser evidence rules.
    const identityPaths = [...new Set(
      primaryOwners.map((owner) => owner.normalized_path),
    )].sort();
    const contentDigests = new Map<string, string>();
    for (const item of applicability) {
      const previous = contentDigests.get(item.normalized_path);
      if (previous !== undefined && previous !== item.content_digest) {
        throw new TypeError(`parser source binding has conflicting content for ${item.normalized_path}`);
      }
      contentDigests.set(item.normalized_path, item.content_digest);
    }
    const entryDigests = executions.map(({ entry }) =>
      indexerParserExecutionEntryDigest(entry)
    ).sort();
    const parserLockDigests = canonicalUnique(
      executions.map(({ entry }) => entry.parser_lock_digest),
      `${key}.parser_lock_digests`,
    );
    const importReceiptDigests = executions.map(({ receipt }) => receipt.receipt_digest).sort();
    const resultDigests = executions.map(({ result }) => result.output_digest).sort();
    const eligibleInventoryDigest = indexerProtocolDigest({
      source_ref: first.source_ref,
      module_ref: first.module_ref,
      applicability,
      primary_owners: primaryOwners,
    });
    const sourceToolchainDigest = indexerProtocolDigest(executions.map(({ entry, result }) => ({
      capability: entry.capability,
      authority_domain: entry.authority_domain,
      parser_lock_digest: entry.parser_lock_digest,
      result_digest: result.output_digest,
      toolchain: result.toolchain,
    })).sort((left, right) => canonicalIndexerJson(left).localeCompare(canonicalIndexerJson(right))));
    const sourceMergeDigest = indexerProtocolDigest({
      source_ref: first.source_ref,
      module_ref: first.module_ref,
      primary_owners: primaryOwners,
      facts: sourceFactValues,
      conflicts,
    });
    const sourceInputDigest = indexerProtocolDigest({
      profile_contract_digest: input.plan.profile_contract_digest,
      source_registry_digest: input.plan.source_registry_digest,
      entry_digests: entryDigests,
      parser_lock_digests: parserLockDigests,
      import_receipt_digests: importReceiptDigests,
      result_digests: resultDigests,
      eligible_inventory_digest: eligibleInventoryDigest,
      source_merge_digest: sourceMergeDigest,
      source_toolchain_digest: sourceToolchainDigest,
    });
    const factsByPath = new Map<string, Map<string, IndexerSourceIdentityFact>>();
    for (const fact of sourceFactValues) {
      if (!identityPaths.includes(fact.locator.normalized_path)) continue;
      const facts = factsByPath.get(fact.locator.normalized_path) ?? new Map();
      const projected = sourceIdentityFact(fact);
      const previous = facts.get(projected.fact_ref);
      if (
        previous !== undefined &&
        canonicalIndexerJson(previous) !== canonicalIndexerJson(projected)
      ) {
        throw new TypeError(`parser source binding has conflicting fact ${projected.fact_ref}`);
      }
      facts.set(projected.fact_ref, projected);
      factsByPath.set(fact.locator.normalized_path, facts);
    }
    const sourceIdentityInventory = buildIndexerSourceIdentityInventory({
      source_ref: first.source_ref,
      module_ref: first.module_ref,
      source_input_digest: sourceInputDigest,
      files: identityPaths.map((normalizedPath) => {
        const digest = contentDigests.get(normalizedPath);
        if (digest === undefined) {
          throw new TypeError(`parser source binding lacks content digest for ${normalizedPath}`);
        }
        return {
          normalized_path: normalizedPath,
          content_digest: digest,
          facts: [...(factsByPath.get(normalizedPath)?.values() ?? [])],
        };
      }),
    });
    const payload: Omit<IndexerParserRuntimeSourceBinding, "binding_digest"> = {
      source_ref: first.source_ref,
      module_ref: first.module_ref,
      entry_digests: entryDigests,
      parser_lock_digests: parserLockDigests,
      import_receipt_digests: importReceiptDigests,
      result_digests: resultDigests,
      eligible_inventory_digest: eligibleInventoryDigest,
      source_merge_digest: sourceMergeDigest,
      source_toolchain_digest: sourceToolchainDigest,
      source_identity_inventory: sourceIdentityInventory,
    };
    return { ...payload, binding_digest: sourceBindingDigest(payload) };
  });
}

export function validateIndexerParserRuntimeExecutionReceipt(
  value: IndexerParserRuntimeExecutionReceipt,
): IndexerParserRuntimeExecutionReceipt {
  if (value.protocol !== "context.indexer.parser-runtime-execution/v1") {
    throw new TypeError("parser runtime execution protocol is invalid");
  }
  if (value.merge.execution_plan_digest !== value.execution_plan_digest) {
    throw new TypeError("parser runtime merge targets another execution plan");
  }
  const importReceiptDigests = new Set(
    value.import_receipts.map((receipt) =>
      validateIndexerParserImportReceipt(receipt).receipt_digest
    ),
  );
  const resultDigests = new Set(value.adapter_results.map((result) =>
    validateIndexerEvidenceAdapterResult(result).output_digest
  ));
  if (
    importReceiptDigests.size !== value.import_receipts.length ||
    resultDigests.size !== value.adapter_results.length ||
    canonicalIndexerJson([...resultDigests].sort()) !==
      canonicalIndexerJson([...value.merge.result_digests].sort())
  ) {
    throw new TypeError("parser runtime execution Result set is inconsistent");
  }
  const sourceBindings = [...value.source_bindings].sort((left, right) =>
    compareIndexerCanonicalText(sourceKey(left), sourceKey(right))
  );
  if (
    sourceBindings.length !== value.source_bindings.length ||
    sourceBindings.some((binding, index) => binding !== value.source_bindings[index])
  ) {
    throw new TypeError("parser runtime source bindings must use canonical order");
  }
  canonicalUnique(sourceBindings.map(sourceKey), "parser runtime source bindings");
  for (const binding of sourceBindings) {
    const inventory = validateIndexerSourceIdentityInventory(
      binding.source_identity_inventory,
    );
    if (
      inventory.source_ref !== binding.source_ref ||
      inventory.module_ref !== binding.module_ref ||
      binding.entry_digests.length === 0 ||
      binding.result_digests.length === 0 ||
      binding.import_receipt_digests.length === 0
    ) {
      throw new TypeError("parser runtime source binding identity is invalid");
    }
    canonicalUnique(binding.entry_digests, "source binding entry_digests");
    canonicalUnique(binding.parser_lock_digests, "source binding parser_lock_digests");
    canonicalUnique(binding.import_receipt_digests, "source binding import_receipt_digests");
    canonicalUnique(binding.result_digests, "source binding result_digests");
    if (
      binding.import_receipt_digests.some((digest) => !importReceiptDigests.has(digest)) ||
      binding.result_digests.some((digest) => !resultDigests.has(digest))
    ) {
      throw new TypeError("parser runtime source binding escapes its execution receipt");
    }
    const { binding_digest: _digest, ...payload } = binding;
    void _digest;
    if (sourceBindingDigest(payload) !== binding.binding_digest) {
      throw new TypeError("parser runtime source binding digest is invalid");
    }
  }
  const factViews = value.fact_views.map(validateIndexerParserFactView);
  const canonicalFactViews = [...factViews].sort((left, right) =>
    compareIndexerCanonicalText(factViewSourceKey(left), factViewSourceKey(right))
  );
  if (
    canonicalFactViews.length !== value.fact_views.length ||
    canonicalFactViews.some((view, index) =>
      factViewSourceKey(view) !== factViewSourceKey(value.fact_views[index]!)
    )
  ) {
    throw new TypeError("parser runtime fact views must use canonical order");
  }
  canonicalUnique(factViews.map(factViewSourceKey), "parser runtime fact views");
  if (factViews.length !== sourceBindings.length) {
    throw new TypeError("parser runtime requires one fact view per source binding");
  }
  for (const binding of sourceBindings) {
    const view = factViews.find((candidate) => factViewSourceKey(candidate) === sourceKey(binding));
    if (
      view === undefined ||
      view.inventory_digest !== binding.source_identity_inventory.inventory_digest ||
      canonicalIndexerJson(view.origin_result_digests) !==
        canonicalIndexerJson(binding.result_digests)
    ) {
      throw new TypeError("parser runtime fact view does not match its source binding");
    }
  }
  const { execution_digest: _executionDigest, ...payload } = value;
  void _executionDigest;
  if (indexerProtocolDigest(payload) !== value.execution_digest) {
    throw new TypeError("parser runtime execution digest is invalid");
  }
  return value;
}

function exactEntryInput(
  entry: IndexerParserExecutionPlanEntry,
  input: IndexerParserRuntimeEntryInput,
): void {
  if (input.entry_digest !== indexerParserExecutionEntryDigest(entry)) {
    throw new TypeError(`parser runtime input does not bind ${entry.capability} entry`);
  }
  const expectedPaths = entry.files.map((file) => file.normalized_path).sort();
  const actualPaths = Object.keys(input.files).sort();
  if (canonicalIndexerJson(expectedPaths) !== canonicalIndexerJson(actualPaths)) {
    throw new TypeError(`parser runtime source set does not match ${entry.capability} entry`);
  }
  for (const file of entry.files) {
    if (contentDigest(input.files[file.normalized_path]!) !== file.content_digest) {
      throw new TypeError(`parser runtime source content is stale: ${file.normalized_path}`);
    }
  }
  const prepared = PREPARED_INPUT_CAPABILITIES.has(entry.capability);
  if (prepared !== (input.prepared_input !== undefined)) {
    throw new TypeError(
      `${entry.capability} ${prepared ? "requires" : "does not accept"} prepared parser input`,
    );
  }
}

function entryRole(entry: IndexerParserExecutionPlanEntry): "primary-owner" | "enricher" {
  const roles = new Set(entry.files.map((file) => file.role));
  if (roles.size !== 1) {
    throw new TypeError(`parser execution entry ${entry.capability} mixes owner roles`);
  }
  return entry.files[0]!.role;
}

function protectedAdapterOptions(options: Readonly<Record<string, unknown>>): void {
  const protectedFields = [
    "adapter",
    "authorized_scope",
    "input_digest",
    "module_ref",
    "module_refs",
    "precedence",
    "role",
    "workspace_module_ref",
  ];
  const supplied = protectedFields.filter((field) => field in options);
  if (supplied.length > 0) {
    throw new TypeError(`adapter options cannot replace authorized fields: ${supplied.join(", ")}`);
  }
}

function requirementByCapability(
  contract: IndexerProfileContract,
  profileId: string,
): Map<string, IndexerParserRequirement> {
  const profile = contract.profiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) throw new TypeError(`unknown Indexer profile ${profileId}`);
  return new Map(profile.parser_requirements.map((requirement) => [
    requirement.capability,
    requirement,
  ]));
}

function uniqueByCapability<T extends { capability: string }>(
  values: readonly T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.capability)) {
      throw new TypeError(`${label} duplicates ${value.capability}`);
    }
    result.set(value.capability, value);
  }
  return result;
}

function assertResultIdentity(input: {
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

export async function executeProjectIndexerParserPlan(input: {
  projectRoot: string;
  profile_contract: IndexerProfileContract;
  profile_id: string;
  execution_plan: unknown;
  dependencies: unknown;
  mappings: readonly IndexerParserCoordinateMapping[];
  locks: readonly IndexerParserResolutionLock[];
  entry_inputs: readonly IndexerParserRuntimeEntryInput[];
}): Promise<IndexerParserRuntimeExecutionReceipt> {
  const plan = validateIndexerParserExecutionPlan(input.execution_plan);
  if (plan.profile_contract_digest !== input.profile_contract.contract_digest) {
    throw new TypeError("parser execution plan targets another profile contract");
  }
  const requirements = requirementByCapability(input.profile_contract, input.profile_id);
  const mappings = uniqueByCapability(input.mappings, "parser mappings");
  const locks = uniqueByCapability(input.locks, "parser locks");
  const dependencies = assertIndexerParserDependenciesLocked({
    dependencies: input.dependencies,
    locks: input.locks,
  });
  const entryInputs = new Map(input.entry_inputs.map((value) => [value.entry_digest, value]));
  if (entryInputs.size !== input.entry_inputs.length) {
    throw new TypeError("parser runtime entry inputs must be unique");
  }
  const imports: IndexerParserImportReceipt[] = [];
  const results: IndexerEvidenceAdapterResult[] = [];
  const executions: IndexerEvidenceAdapterExecution[] = [];
  const sourceExecutions: Array<{
    entry: IndexerParserExecutionPlanEntry;
    result: IndexerEvidenceAdapterResult;
    materialization: {
      result: IndexerEvidenceAdapterResult;
      fact_payloads: IndexerParserFactPayload[];
    };
    receipt: IndexerParserImportReceipt;
  }> = [];

  for (const entry of plan.entries) {
    const entryDigest = indexerParserExecutionEntryDigest(entry);
    const entryInput = entryInputs.get(entryDigest);
    if (entryInput === undefined) {
      throw new TypeError(`parser runtime lacks input for ${entry.capability} entry`);
    }
    exactEntryInput(entry, entryInput);
    const requirement = requirements.get(entry.capability);
    const mapping = mappings.get(entry.capability);
    const lock = locks.get(entry.capability);
    if (
      requirement === undefined || mapping === undefined || lock === undefined ||
      requirement.requirement_digest !== entry.requirement_digest ||
      lock.lock_digest !== entry.parser_lock_digest
    ) {
      throw new TypeError(`parser runtime resolution set does not satisfy ${entry.capability}`);
    }
    const loaded = await loadProjectIndexerParser({
      requirement,
      mapping,
      lock,
    });
    const adapterOptions = entryInput.adapter_options ?? {};
    protectedAdapterOptions(adapterOptions);
    if (entry.capability === "parser.rush") {
      const projectModuleRefs = adapterOptions.project_module_refs;
      if (
        projectModuleRefs !== undefined &&
        (projectModuleRefs === null || typeof projectModuleRefs !== "object" ||
          Array.isArray(projectModuleRefs) ||
          Object.values(projectModuleRefs).some((value) => value !== entry.module_ref))
      ) {
        throw new TypeError("Rush project module refs must remain inside the execution entry");
      }
    }
    const role = entryRole(entry);
    const moduleRefs = entry.module_ref === null ? [] : [entry.module_ref];
    const authorizedScope = {
      source_ref: entry.source_ref,
      module_refs: moduleRefs,
    };
    const executionInputDigest = indexerProtocolDigest({
      entry_digest: entryDigest,
      parser_lock_digest: entry.parser_lock_digest,
      source_content_digests: entry.files.map((file) => file.content_digest),
    });
    const capabilityAdapterOptions = entry.capability === "parser.sql"
      ? { dialects: {}, ...adapterOptions }
      : adapterOptions;
    const commonInvocation = {
      ...capabilityAdapterOptions,
      adapter: {
        id: entry.capability,
        package: lock.actual_coordinate.package,
        export: lock.actual_coordinate.export,
        version: lock.actual_coordinate.version,
        digest: lock.resolved_content_digest,
      },
      authorized_scope: {
        ...authorizedScope,
        scope_digest: indexerProtocolDigest(authorizedScope),
      },
      input_digest: executionInputDigest,
      precedence: entry.precedence,
      role,
    };
    const moduleRefByPath = Object.fromEntries(entry.files.map((file) => [
      file.normalized_path,
      entry.module_ref,
    ]));
    let value: unknown;
    try {
      if (entry.capability === "parser.rush") {
        value = await loaded.adapter(entryInput.prepared_input, {
          ...commonInvocation,
          workspace_module_ref: entry.module_ref,
          project_module_refs: adapterOptions.project_module_refs ?? {},
        });
      } else if (PREPARED_INPUT_CAPABILITIES.has(entry.capability)) {
        value = await loaded.adapter(entryInput.prepared_input, {
          ...commonInvocation,
          module_ref: entry.module_ref,
        });
      } else {
        value = await loaded.adapter(entryInput.files, {
          ...commonInvocation,
          module_refs: moduleRefByPath,
        }, entryInput.parser_options ?? {});
      }
    } catch (error) {
      const message = redactIndexerOutputText({
        channel: "exception-message",
        value: error instanceof Error ? error.message : String(error),
      });
      throw new TypeError(
        `${entry.capability} materialization failed for ${entry.source_ref}` +
          `${entry.module_ref === null ? "" : `/${entry.module_ref}`}: ${message}`,
      );
    }
    if (
      value === null || typeof value !== "object" || Array.isArray(value) ||
      !("result" in value) || !("fact_payloads" in value) ||
      !Array.isArray(value.fact_payloads)
    ) {
      throw new TypeError(
        `${entry.capability} must return an Evidence Adapter materialization`,
      );
    }
    const result = validateIndexerEvidenceAdapterResult(value.result);
    const materialization = {
      result,
      fact_payloads: value.fact_payloads as IndexerParserFactPayload[],
    };
    assertResultIdentity({
      result,
      capability: entry.capability,
      coordinate: lock.actual_coordinate,
      resolvedContentDigest: lock.resolved_content_digest,
    });
    imports.push(loaded.receipt);
    results.push(result);
    sourceExecutions.push({
      entry,
      result,
      materialization,
      receipt: loaded.receipt,
    });
    executions.push({
      capability: entry.capability,
      authority_domain: entry.authority_domain,
      source_ref: entry.source_ref,
      module_ref: entry.module_ref,
      result,
    });
  }
  if (entryInputs.size !== plan.entries.length) {
    throw new TypeError("parser runtime input contains entries absent from the execution plan");
  }
  const merge = mergeIndexerEvidenceAdapterExecutions({
    execution_plan: plan,
    executions,
  });
  const sourceBindings = buildSourceBindings({ plan, merge, executions: sourceExecutions });
  const factViews = sourceBindings.map((binding) => {
    const key = sourceKey(binding);
    const sourceMaterializations = sourceExecutions.filter(({ entry }) =>
      sourceKey(entry) === key
    ).map(({ materialization }) => materialization);
    return buildIndexerMergedParserFactView({
      materializations: sourceMaterializations,
      merged_facts: merge.facts.filter((fact) => sourceKey(fact.locator) === key),
      primary_owners: merge.primary_owners.filter((owner) => sourceKey(owner) === key),
      inventory_digest: binding.source_identity_inventory.inventory_digest,
    });
  }).sort((left, right) =>
    compareIndexerCanonicalText(factViewSourceKey(left), factViewSourceKey(right))
  );
  const uniqueImports = [...new Map(imports.map((receipt) => [
    receipt.receipt_digest,
    receipt,
  ])).values()].sort((left, right) =>
    left.receipt_digest.localeCompare(right.receipt_digest)
  );
  results.sort((left, right) => left.output_digest.localeCompare(right.output_digest));
  const payload: Omit<IndexerParserRuntimeExecutionReceipt, "execution_digest"> = {
    protocol: "context.indexer.parser-runtime-execution/v1",
    execution_plan_digest: plan.plan_digest,
    profile_contract_digest: plan.profile_contract_digest,
    dependency_intent_set_digest: dependencies.intent_set_digest,
    import_receipts: uniqueImports,
    adapter_results: results,
    merge,
    source_bindings: sourceBindings,
    fact_views: factViews,
  };
  return validateIndexerParserRuntimeExecutionReceipt({
    ...payload,
    execution_digest: indexerProtocolDigest(payload),
  });
}
