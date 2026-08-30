import { z } from "zod";
import {
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerProtocolIdSchema,
  indexerSemverSchema,
} from "./indexerProtocolCommon.js";

const npmPackageSchema = z.string().regex(
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u,
);
const packageExportSchema = z.string().regex(/^(?:default|[A-Za-z_$][A-Za-z0-9_$.-]*)$/u);
const lockIntegritySchema = z.string().regex(
  /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/u,
);

export const indexerParserPackageCoordinateSchema = z.object({
  package: npmPackageSchema,
  export: packageExportSchema,
  version: indexerSemverSchema,
}).strict();

const parserRequirementPayloadSchema = z.object({
  protocol: z.literal("context.indexer.parser-requirement/v1"),
  capability: indexerIdSchema,
  abi: indexerProtocolIdSchema,
  abi_digest: indexerDigestSchema,
  community_coordinate: indexerParserPackageCoordinateSchema,
}).strict();

export const indexerParserRequirementSchema = parserRequirementPayloadSchema.extend({
  requirement_digest: indexerDigestSchema,
}).strict();

export type IndexerParserRequirement = z.infer<typeof indexerParserRequirementSchema>;

const parserCoordinateMappingPayloadSchema = z.object({
  protocol: z.literal("context.indexer.parser-coordinate-mapping/v1"),
  capability: indexerIdSchema,
  requirement_digest: indexerDigestSchema,
  resolution: z.enum(["direct", "wrapper"]),
  registry: indexerIdSchema,
  actual_coordinate: indexerParserPackageCoordinateSchema,
  abi_digest: indexerDigestSchema,
}).strict();

export const indexerParserCoordinateMappingSchema =
  parserCoordinateMappingPayloadSchema.extend({
    mapping_digest: indexerDigestSchema,
  }).strict();

export type IndexerParserCoordinateMapping = z.infer<
  typeof indexerParserCoordinateMappingSchema
>;

const parserResolutionLockPayloadSchema = z.object({
  protocol: z.literal("context.indexer.parser-resolution-lock/v1"),
  capability: indexerIdSchema,
  requirement_digest: indexerDigestSchema,
  mapping_digest: indexerDigestSchema,
  actual_coordinate: indexerParserPackageCoordinateSchema,
  abi_digest: indexerDigestSchema,
  lock_integrity: lockIntegritySchema,
  resolved_content_digest: indexerDigestSchema,
}).strict();

export const indexerParserResolutionLockSchema = parserResolutionLockPayloadSchema.extend({
  lock_digest: indexerDigestSchema,
}).strict();

export type IndexerParserResolutionLock = z.infer<
  typeof indexerParserResolutionLockSchema
>;

export const indexerParserImportSchema = z.object({
  capability: indexerIdSchema,
  package: npmPackageSchema,
  export: packageExportSchema,
  version: indexerSemverSchema,
  parser_lock_digest: indexerDigestSchema,
}).strict();

export type IndexerParserImport = z.infer<typeof indexerParserImportSchema>;

function exactCanonical(left: unknown, right: unknown): boolean {
  return canonicalIndexerJson(left) === canonicalIndexerJson(right);
}

export function buildIndexerParserRequirement(input: {
  capability: string;
  abi: string;
  abi_digest: string;
  community_coordinate: z.input<typeof indexerParserPackageCoordinateSchema>;
}): IndexerParserRequirement {
  const payload = parserRequirementPayloadSchema.parse({
    protocol: "context.indexer.parser-requirement/v1",
    ...input,
  });
  return indexerParserRequirementSchema.parse({
    ...payload,
    requirement_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerParserRequirement(value: unknown): IndexerParserRequirement {
  const requirement = indexerParserRequirementSchema.parse(value);
  const { requirement_digest: _digest, ...payload } = requirement;
  void _digest;
  if (indexerProtocolDigest(payload) !== requirement.requirement_digest) {
    throw new TypeError("parser requirement digest is invalid");
  }
  return requirement;
}

export function buildIndexerParserCoordinateMapping(input: {
  requirement: unknown;
  resolution: "direct" | "wrapper";
  registry: string;
  actual_coordinate: z.input<typeof indexerParserPackageCoordinateSchema>;
  abi_digest: string;
}): IndexerParserCoordinateMapping {
  const requirement = validateIndexerParserRequirement(input.requirement);
  const actualCoordinate = indexerParserPackageCoordinateSchema.parse(input.actual_coordinate);
  if (input.abi_digest !== requirement.abi_digest) {
    throw new TypeError("parser mapping changes the required ABI");
  }
  if (
    input.resolution === "direct" &&
    !exactCanonical(actualCoordinate, requirement.community_coordinate)
  ) {
    throw new TypeError("direct parser mapping must preserve the community coordinate");
  }
  const payload = parserCoordinateMappingPayloadSchema.parse({
    protocol: "context.indexer.parser-coordinate-mapping/v1",
    capability: requirement.capability,
    requirement_digest: requirement.requirement_digest,
    resolution: input.resolution,
    registry: input.registry,
    actual_coordinate: actualCoordinate,
    abi_digest: input.abi_digest,
  });
  return indexerParserCoordinateMappingSchema.parse({
    ...payload,
    mapping_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerParserCoordinateMapping(input: {
  requirement: unknown;
  mapping: unknown;
}): IndexerParserCoordinateMapping {
  const mapping = indexerParserCoordinateMappingSchema.parse(input.mapping);
  const expected = buildIndexerParserCoordinateMapping({
    requirement: input.requirement,
    resolution: mapping.resolution,
    registry: mapping.registry,
    actual_coordinate: mapping.actual_coordinate,
    abi_digest: mapping.abi_digest,
  });
  if (!exactCanonical(expected, mapping)) {
    throw new TypeError("parser coordinate mapping is stale or forged");
  }
  return mapping;
}

export function buildIndexerParserResolutionLock(input: {
  requirement: unknown;
  mapping: unknown;
  lock_integrity: string;
  resolved_content_digest: string;
}): IndexerParserResolutionLock {
  const requirement = validateIndexerParserRequirement(input.requirement);
  const mapping = validateIndexerParserCoordinateMapping({
    requirement,
    mapping: input.mapping,
  });
  const payload = parserResolutionLockPayloadSchema.parse({
    protocol: "context.indexer.parser-resolution-lock/v1",
    capability: requirement.capability,
    requirement_digest: requirement.requirement_digest,
    mapping_digest: mapping.mapping_digest,
    actual_coordinate: mapping.actual_coordinate,
    abi_digest: mapping.abi_digest,
    lock_integrity: input.lock_integrity,
    resolved_content_digest: input.resolved_content_digest,
  });
  return indexerParserResolutionLockSchema.parse({
    ...payload,
    lock_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerParserResolutionLock(input: {
  requirement: unknown;
  mapping: unknown;
  lock: unknown;
}): IndexerParserResolutionLock {
  const lock = indexerParserResolutionLockSchema.parse(input.lock);
  const expected = buildIndexerParserResolutionLock({
    requirement: input.requirement,
    mapping: input.mapping,
    lock_integrity: lock.lock_integrity,
    resolved_content_digest: lock.resolved_content_digest,
  });
  if (!exactCanonical(expected, lock)) {
    throw new TypeError("parser resolution lock is stale or forged");
  }
  return lock;
}

export function validateIndexerParserImport(input: {
  requirement: unknown;
  mapping: unknown;
  lock: unknown;
  parser_import: unknown;
}): IndexerParserImport {
  const lock = validateIndexerParserResolutionLock(input);
  const parserImport = indexerParserImportSchema.parse(input.parser_import);
  const expected = {
    capability: lock.capability,
    ...lock.actual_coordinate,
    parser_lock_digest: lock.lock_digest,
  };
  if (!exactCanonical(expected, parserImport)) {
    throw new TypeError("parser import does not match the actual resolution lock");
  }
  return parserImport;
}

export function indexerParserLockedDependency(lockValue: unknown): {
  package: string;
  version: string;
  lock_integrity: string;
  resolved_digest: string;
} {
  const lock = indexerParserResolutionLockSchema.parse(lockValue);
  return {
    package: lock.actual_coordinate.package,
    version: lock.actual_coordinate.version,
    lock_integrity: lock.lock_integrity,
    resolved_digest: lock.resolved_content_digest,
  };
}
