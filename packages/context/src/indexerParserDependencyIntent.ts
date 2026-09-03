import {
  buildIndexerDependencyIntentSet,
  validateIndexerDependencyAuthorizationReceipt,
  validateIndexerDependencyIntentSet,
  type IndexerDependencyAuthorizationReceipt,
  type IndexerDependencyIntentSet,
} from "./indexerProjectProposal.js";
import {
  buildIndexerParserCoordinateMapping,
  buildIndexerParserResolutionLock,
  validateIndexerParserCoordinateMapping,
  validateIndexerParserRequirement,
  type IndexerParserCoordinateMapping,
  type IndexerParserRequirement,
  type IndexerParserResolutionLock,
} from "./indexerParserCoordinate.js";

interface ParserResolutionInput {
  requirements: readonly IndexerParserRequirement[];
  mappings: readonly IndexerParserCoordinateMapping[];
}

interface MappedParserCapability {
  requirement: IndexerParserRequirement;
  mapping: IndexerParserCoordinateMapping;
}

interface MappedParserPackage {
  package: string;
  version: string;
  capabilities: string[];
}

function mappedCapabilities(input: ParserResolutionInput): MappedParserCapability[] {
  const requirements = new Map<string, IndexerParserRequirement>();
  for (const value of input.requirements) {
    const requirement = validateIndexerParserRequirement(value);
    if (requirements.has(requirement.capability)) {
      throw new TypeError(`duplicate parser requirement for ${requirement.capability}`);
    }
    requirements.set(requirement.capability, requirement);
  }
  const mappings = new Map<string, IndexerParserCoordinateMapping>();
  for (const value of input.mappings) {
    const requirement = requirements.get(value.capability);
    if (requirement === undefined) {
      throw new TypeError(`parser mapping has no selected requirement: ${value.capability}`);
    }
    if (mappings.has(value.capability)) {
      throw new TypeError(`duplicate parser mapping for ${value.capability}`);
    }
    mappings.set(value.capability, validateIndexerParserCoordinateMapping({
      requirement,
      mapping: value,
    }));
  }
  const missing = [...requirements.keys()].filter((capability) => !mappings.has(capability));
  if (missing.length > 0) {
    throw new TypeError(`selected parser requirements lack mappings: ${missing.sort().join(", ")}`);
  }
  return [...requirements.values()]
    .map((requirement) => ({
      requirement,
      mapping: mappings.get(requirement.capability)!,
    }))
    .sort((left, right) => left.requirement.capability.localeCompare(
      right.requirement.capability,
    ));
}

function mappedPackages(input: ParserResolutionInput): MappedParserPackage[] {
  const packages = new Map<string, MappedParserPackage>();
  for (const { requirement, mapping } of mappedCapabilities(input)) {
    const coordinate = mapping.actual_coordinate;
    const current = packages.get(coordinate.package);
    if (current !== undefined && current.version !== coordinate.version) {
      throw new TypeError(
        `parser mappings disagree on package version: ${coordinate.package}`,
      );
    }
    packages.set(coordinate.package, {
      package: coordinate.package,
      version: coordinate.version,
      capabilities: [...(current?.capabilities ?? []), requirement.capability].sort(),
    });
  }
  return [...packages.values()].sort((left, right) => left.package.localeCompare(right.package));
}

function unresolvedDependencyIntentSet(
  input: ParserResolutionInput & { importers?: readonly string[] },
): IndexerDependencyIntentSet {
  const importers = [...(input.importers ?? ["src/indexers.yaml"])].sort();
  return buildIndexerDependencyIntentSet(mappedPackages(input).map((dependency) => ({
    package: dependency.package,
    version: dependency.version,
    kind: "runtime" as const,
    importers,
    state: "requires-authorization" as const,
    install_scripts: false as const,
  })));
}

function exactAuthorization(input: {
  unresolved: IndexerDependencyIntentSet;
  authorization_receipt: IndexerDependencyAuthorizationReceipt;
}): IndexerDependencyAuthorizationReceipt {
  const receipt = validateIndexerDependencyAuthorizationReceipt(input.authorization_receipt);
  if (receipt.request_intent_set_digest !== input.unresolved.intent_set_digest) {
    throw new TypeError("parser dependency authorization targets a stale intent set");
  }
  const expected = input.unresolved.intents.map((intent) =>
    `${intent.package}@${intent.version}`
  );
  const actual = receipt.resolutions.map((resolution) =>
    `${resolution.package}@${resolution.version}`
  );
  if (
    expected.length !== actual.length ||
    expected.some((identity, index) => identity !== actual[index])
  ) {
    throw new TypeError("parser dependency authorization does not close the exact mapping set");
  }
  return receipt;
}

export function buildIndexerCommunityParserCoordinateMappings(input: {
  requirements: readonly IndexerParserRequirement[];
  registry: string;
}): IndexerParserCoordinateMapping[] {
  return input.requirements.map((value) => {
    const requirement = validateIndexerParserRequirement(value);
    return buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "direct",
      registry: input.registry,
      actual_coordinate: requirement.community_coordinate,
      abi_digest: requirement.abi_digest,
    });
  }).sort((left, right) => left.capability.localeCompare(right.capability));
}

export function buildIndexerParserDependencyIntentSet(input: ParserResolutionInput & {
  importers?: readonly string[];
  authorization_receipt?: IndexerDependencyAuthorizationReceipt;
}): IndexerDependencyIntentSet {
  const unresolved = unresolvedDependencyIntentSet(input);
  if (input.authorization_receipt === undefined) return unresolved;
  const receipt = exactAuthorization({
    unresolved,
    authorization_receipt: input.authorization_receipt,
  });
  const resolutionByPackage = new Map(receipt.resolutions.map((resolution) => [
    resolution.package,
    resolution,
  ]));
  const locked = unresolved.intents.map((intent) => {
    const resolution = resolutionByPackage.get(intent.package)!;
    return {
      ...intent,
      state: "locked" as const,
      lock_integrity: resolution.lock_integrity,
      resolved_digest: resolution.resolved_digest,
      authorization_receipt_digest: receipt.receipt_digest,
    };
  });
  return buildIndexerDependencyIntentSet(locked, [receipt]);
}

export function buildIndexerParserResolutionLocks(input: ParserResolutionInput & {
  authorization_receipt: IndexerDependencyAuthorizationReceipt;
}): IndexerParserResolutionLock[] {
  const unresolved = unresolvedDependencyIntentSet(input);
  const receipt = exactAuthorization({
    unresolved,
    authorization_receipt: input.authorization_receipt,
  });
  const resolutionByPackage = new Map(receipt.resolutions.map((resolution) => [
    resolution.package,
    resolution,
  ]));
  return mappedCapabilities(input).map(({ requirement, mapping }) => {
    const resolution = resolutionByPackage.get(mapping.actual_coordinate.package)!;
    return buildIndexerParserResolutionLock({
      requirement,
      mapping,
      lock_integrity: resolution.lock_integrity,
      resolved_content_digest: resolution.resolved_digest,
    });
  });
}

export function assertIndexerParserDependenciesLocked(input: {
  dependencies: unknown;
  locks: readonly IndexerParserResolutionLock[];
}): IndexerDependencyIntentSet {
  const dependencies = validateIndexerDependencyIntentSet(input.dependencies);
  const expected = new Map<string, {
    version: string;
    lock_integrity: string;
    resolved_digest: string;
  }>();
  for (const lock of input.locks) {
    const next = {
      version: lock.actual_coordinate.version,
      lock_integrity: lock.lock_integrity,
      resolved_digest: lock.resolved_content_digest,
    };
    const current = expected.get(lock.actual_coordinate.package);
    if (
      current !== undefined &&
      (current.version !== next.version ||
        current.lock_integrity !== next.lock_integrity ||
        current.resolved_digest !== next.resolved_digest)
    ) {
      throw new TypeError(
        `parser locks disagree on package identity: ${lock.actual_coordinate.package}`,
      );
    }
    expected.set(lock.actual_coordinate.package, next);
  }
  for (const [packageName, parserPackage] of expected) {
    const intent = dependencies.intents.find((candidate) => candidate.package === packageName);
    if (
      intent?.state !== "locked" || intent.kind !== "runtime" ||
      intent.version !== parserPackage.version ||
      intent.lock_integrity !== parserPackage.lock_integrity ||
      intent.resolved_digest !== parserPackage.resolved_digest
    ) {
      throw new TypeError(`parser dependency is not exactly locked: ${packageName}`);
    }
  }
  if (dependencies.intents.length !== expected.size) {
    throw new TypeError("parser dependency intent set contains an unrelated package");
  }
  return dependencies;
}
