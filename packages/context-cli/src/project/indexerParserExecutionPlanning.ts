import { basename, extname } from "node:path";
import {
  INDEXER_PARSER_CAPABILITY_SPECS,
  buildIndexerParserExecutionPlan,
  indexerParserResolutionLockSchema,
  type IndexerParserApplicability,
  type IndexerParserCapabilitySpec,
  type IndexerParserExecutionPlan,
  type IndexerParserExecutionPlanEntry,
  type IndexerProfileContract,
  type IndexerParserResolutionLock,
} from "@c4a/context";

export interface IndexerParserAuthorizedFile {
  source_ref: string;
  module_ref: string | null;
  normalized_path: string;
  content_digest: string;
  contract_scope?: string | null;
  scope_disposition?: "included" | "excluded";
  media_kind?: "text" | "binary";
}

interface ApplicableDecision {
  authority_domain: string;
  role: "primary-owner" | "enricher";
  precedence: number;
}

function normalizedExtension(path: string): string {
  return extname(path).toLowerCase();
}

function matchesFile(
  spec: IndexerParserCapabilitySpec,
  file: IndexerParserAuthorizedFile,
): boolean {
  const extension = normalizedExtension(file.normalized_path);
  const matchesExtension = spec.extensions.some((candidate) =>
    candidate.startsWith(".")
      ? candidate === extension
      : candidate === basename(file.normalized_path).toLowerCase()
  );
  if (!matchesExtension) return false;
  if (spec.capability === "parser.openapi") {
    return file.contract_scope === "openapi";
  }
  if (spec.capability === "parser.graphql") {
    return file.contract_scope === undefined || file.contract_scope === null ||
      file.contract_scope === "graphql";
  }
  return true;
}

export function projectIndexerApplicableParserCapabilities(input: {
  profile_contract: IndexerProfileContract;
  profile_id: string;
  authorized_files: readonly IndexerParserAuthorizedFile[];
}): string[] {
  const profile = input.profile_contract.profiles.find((candidate) =>
    candidate.id === input.profile_id
  );
  if (profile === undefined) {
    throw new TypeError(`unknown Indexer profile ${input.profile_id}`);
  }
  const required = new Set(profile.parser_requirements.map((requirement) =>
    requirement.capability
  ));
  return INDEXER_PARSER_CAPABILITY_SPECS
    .filter((spec) => required.has(spec.capability))
    .filter((spec) => input.authorized_files.some((file) =>
      file.scope_disposition !== "excluded" &&
      file.media_kind !== "binary" &&
      matchesFile(spec, file)
    ))
    .map((spec) => spec.capability)
    .sort();
}

function configCapability(capability: string): boolean {
  return capability === "parser.json" || capability === "parser.yaml" ||
    capability === "parser.toml";
}

function decisionForFile(input: {
  spec: IndexerParserCapabilitySpec;
  file: IndexerParserAuthorizedFile;
  matchedCapabilities: ReadonlySet<string>;
}): ApplicableDecision {
  if (!configCapability(input.spec.capability)) {
    return {
      authority_domain: input.spec.authority_domain,
      role: "primary-owner",
      precedence: 100,
    };
  }
  if (input.matchedCapabilities.has("parser.rush")) {
    return {
      authority_domain: "workspace-structure",
      role: "enricher",
      precedence: 50,
    };
  }
  if (input.matchedCapabilities.has("parser.openapi")) {
    return {
      authority_domain: "protocol-contract",
      role: "enricher",
      precedence: 50,
    };
  }
  return {
    authority_domain: input.spec.authority_domain,
    role: "primary-owner",
    precedence: 100,
  };
}

function nonApplicableDecision(input: {
  file: IndexerParserAuthorizedFile;
  capability: string;
  authority_domain: string;
}): IndexerParserApplicability {
  const base = {
    source_ref: input.file.source_ref,
    module_ref: input.file.module_ref,
    normalized_path: input.file.normalized_path,
    content_digest: input.file.content_digest,
    contract_scope: input.file.contract_scope ?? null,
    capability: input.capability,
    authority_domain: input.authority_domain,
  };
  if (input.file.scope_disposition === "excluded") {
    return {
      ...base,
      disposition: "excluded-by-scope",
      reason_code: "registered-scope-exclusion",
    };
  }
  if (input.file.media_kind === "binary") {
    return {
      ...base,
      disposition: "unsupported-format",
      reason_code: "binary-format",
    };
  }
  return {
    ...base,
    disposition: "not-applicable",
    reason_code: "file-format-not-matched",
  };
}

function executionEntryKey(input: {
  capability: string;
  source_ref: string;
  module_ref: string | null;
  authority_domain: string;
}): string {
  return [
    input.capability,
    input.source_ref,
    input.module_ref ?? "",
    input.authority_domain,
  ].join("\u0000");
}

function validatedLockByCapability(
  locks: readonly IndexerParserResolutionLock[],
): Map<string, IndexerParserResolutionLock> {
  const result = new Map<string, IndexerParserResolutionLock>();
  for (const value of locks) {
    const lock = indexerParserResolutionLockSchema.parse(value);
    if (result.has(lock.capability)) {
      throw new TypeError(`duplicate parser resolution lock for ${lock.capability}`);
    }
    result.set(lock.capability, lock);
  }
  return result;
}

export function buildProjectIndexerParserExecutionPlan(input: {
  profile_contract: IndexerProfileContract;
  profile_id: string;
  source_registry_digest: string;
  authorized_files: readonly IndexerParserAuthorizedFile[];
  parser_locks: readonly IndexerParserResolutionLock[];
}): IndexerParserExecutionPlan {
  const profile = input.profile_contract.profiles.find((candidate) =>
    candidate.id === input.profile_id
  );
  if (profile === undefined) {
    throw new TypeError(`unknown Indexer profile ${input.profile_id}`);
  }
  const requirements = new Map(profile.parser_requirements.map((requirement) => [
    requirement.capability,
    requirement,
  ]));
  const specs = INDEXER_PARSER_CAPABILITY_SPECS.filter((spec) =>
    requirements.has(spec.capability)
  );
  const locks = validatedLockByCapability(input.parser_locks);
  const applicability: IndexerParserApplicability[] = [];
  const entryBuilders = new Map<string, IndexerParserExecutionPlanEntry>();

  for (const file of input.authorized_files) {
    const applicableSpecs = file.scope_disposition === "excluded" || file.media_kind === "binary"
      ? []
      : specs.filter((spec) => matchesFile(spec, file));
    const matchedCapabilities = new Set(applicableSpecs.map((spec) => spec.capability));
    for (const spec of specs) {
      if (!matchedCapabilities.has(spec.capability)) {
        applicability.push(nonApplicableDecision({
          file,
          capability: spec.capability,
          authority_domain: spec.authority_domain,
        }));
        continue;
      }
      const requirement = requirements.get(spec.capability)!;
      const lock = locks.get(spec.capability);
      if (lock === undefined) {
        throw new TypeError(`applicable parser ${spec.capability} lacks a resolution lock`);
      }
      if (
        lock.requirement_digest !== requirement.requirement_digest
      ) {
        throw new TypeError(`parser resolution lock does not satisfy ${spec.capability}`);
      }
      const decision = decisionForFile({ spec, file, matchedCapabilities });
      const contractScope = file.contract_scope ?? null;
      applicability.push({
        source_ref: file.source_ref,
        module_ref: file.module_ref,
        normalized_path: file.normalized_path,
        content_digest: file.content_digest,
        contract_scope: contractScope,
        capability: spec.capability,
        authority_domain: decision.authority_domain,
        disposition: "applicable",
        role: decision.role,
      });
      const key = executionEntryKey({
        capability: spec.capability,
        source_ref: file.source_ref,
        module_ref: file.module_ref,
        authority_domain: decision.authority_domain,
      });
      const existing = entryBuilders.get(key);
      const nextFile = {
        normalized_path: file.normalized_path,
        content_digest: file.content_digest,
        contract_scope: contractScope,
        role: decision.role,
      };
      if (existing === undefined) {
        entryBuilders.set(key, {
          capability: spec.capability,
          requirement_digest: requirement.requirement_digest,
          parser_lock_digest: lock.lock_digest,
          source_ref: file.source_ref,
          module_ref: file.module_ref,
          authority_domain: decision.authority_domain,
          precedence: decision.precedence,
          files: [nextFile],
        });
      } else {
        existing.files.push(nextFile);
      }
    }
  }

  return buildIndexerParserExecutionPlan({
    profile_contract_digest: input.profile_contract.contract_digest,
    source_registry_digest: input.source_registry_digest,
    entries: [...entryBuilders.values()],
    applicability,
  });
}
