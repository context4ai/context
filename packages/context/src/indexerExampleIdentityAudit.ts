import { z } from "zod";
import {
  validateIndexerExampleInventory,
  type IndexerExampleInventory,
} from "./indexerExampleIdentity.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const collisionSchema = z.object({
  example_ref: indexerCanonicalRefSchema,
  public_target_ref: indexerCanonicalRefSchema,
  scenario_key: indexerIdSchema,
  full_relative_path: portableIndexerPathSchema,
  observation_refs: z.array(indexerCanonicalRefSchema).min(2),
}).strict();

export const indexerExampleIdentityAuditSchema = z.object({
  protocol: z.literal("context.indexer.example-identity-audit/v1"),
  inventory_digest: indexerDigestSchema,
  observation_count: z.number().int().nonnegative(),
  unique_example_count: z.number().int().nonnegative(),
  collision_count: z.number().int().nonnegative(),
  collisions: z.array(collisionSchema),
  pass: z.boolean(),
  audit_digest: indexerDigestSchema,
}).strict();

export type IndexerExampleIdentityAudit = z.infer<
  typeof indexerExampleIdentityAuditSchema
>;

export function indexerExampleIdentityAuditDigest(
  value: Omit<IndexerExampleIdentityAudit, "audit_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerExampleIdentityAudit(
  inventoryInput: unknown,
): IndexerExampleIdentityAudit {
  const inventory = validateIndexerExampleInventory({ value: inventoryInput });
  const byExample = new Map<string, IndexerExampleInventory["observations"]>();
  for (const observation of inventory.observations) {
    const current = byExample.get(observation.example_ref) ?? [];
    current.push(observation);
    byExample.set(observation.example_ref, current);
  }
  const collisions = [...byExample.entries()].flatMap(([exampleRef, observations]) => {
    if (observations.length < 2) return [];
    const first = observations[0]!;
    return [{
      example_ref: exampleRef,
      public_target_ref: first.public_target_ref,
      scenario_key: first.scenario_key,
      full_relative_path: first.full_relative_path,
      observation_refs: observations.map((item) => item.observation_ref).sort(
        compareIndexerCanonicalText,
      ),
    }];
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.example_ref, right.example_ref)
  );
  const payload: Omit<IndexerExampleIdentityAudit, "audit_digest"> = {
    protocol: "context.indexer.example-identity-audit/v1",
    inventory_digest: inventory.inventory_digest,
    observation_count: inventory.observations.length,
    unique_example_count: byExample.size,
    collision_count: collisions.length,
    collisions,
    pass: collisions.length === 0,
  };
  return indexerExampleIdentityAuditSchema.parse({
    ...payload,
    audit_digest: indexerExampleIdentityAuditDigest(payload),
  });
}

export function validateIndexerExampleIdentityAudit(input: {
  value: unknown;
  inventory: unknown;
}): IndexerExampleIdentityAudit {
  const inventory = validateIndexerExampleInventory({ value: input.inventory });
  const value = indexerExampleIdentityAuditSchema.parse(input.value);
  const rebuilt = buildIndexerExampleIdentityAudit(inventory);
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(value)) {
    throw new TypeError("example identity audit does not match its current inventory");
  }
  return value;
}

export function assertIndexerExampleIdentityAuditPassed(input: {
  value: unknown;
  inventory: unknown;
}): IndexerExampleIdentityAudit {
  const audit = validateIndexerExampleIdentityAudit(input);
  if (!audit.pass) {
    throw new TypeError(
      `example-identity-collision: ${audit.collision_count} full-path identity collision(s)`,
    );
  }
  return audit;
}
