import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  addDuplicateIssues,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

export const indexerParserApplicabilityDispositionSchema = z.enum([
  "applicable",
  "not-applicable",
  "excluded-by-scope",
  "unsupported-format",
]);

const parserExecutionFileSchema = z.object({
  normalized_path: portableIndexerPathSchema,
  content_digest: indexerDigestSchema,
  contract_scope: indexerIdSchema.nullable(),
  role: z.enum(["primary-owner", "enricher"]),
}).strict();

export const indexerParserExecutionPlanEntrySchema = z.object({
  capability: indexerIdSchema,
  requirement_digest: indexerDigestSchema,
  parser_lock_digest: indexerDigestSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  authority_domain: indexerIdSchema,
  precedence: z.number().int().nonnegative(),
  files: z.array(parserExecutionFileSchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.files.map((file) => file.normalized_path),
    context,
    "files.normalized_path",
  );
});

const applicableFileSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  normalized_path: portableIndexerPathSchema,
  content_digest: indexerDigestSchema,
  contract_scope: indexerIdSchema.nullable(),
  capability: indexerIdSchema,
  authority_domain: indexerIdSchema,
  disposition: z.literal("applicable"),
  role: z.enum(["primary-owner", "enricher"]),
}).strict();

const nonApplicableFileSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  normalized_path: portableIndexerPathSchema,
  content_digest: indexerDigestSchema,
  contract_scope: indexerIdSchema.nullable(),
  capability: indexerIdSchema,
  authority_domain: indexerIdSchema,
  disposition: z.enum([
    "not-applicable",
    "excluded-by-scope",
    "unsupported-format",
  ]),
  reason_code: indexerIdSchema,
}).strict();

export const indexerParserApplicabilitySchema = z.discriminatedUnion("disposition", [
  applicableFileSchema,
  nonApplicableFileSchema,
]);

const parserExecutionPlanPayloadSchema = z.object({
  protocol: z.literal("context.indexer.parser-execution-plan/v1"),
  profile_contract_digest: indexerDigestSchema,
  source_registry_digest: indexerDigestSchema,
  entries: z.array(indexerParserExecutionPlanEntrySchema),
  applicability: z.array(indexerParserApplicabilitySchema),
}).strict();

export const indexerParserExecutionPlanSchema = parserExecutionPlanPayloadSchema.extend({
  plan_digest: indexerDigestSchema,
}).strict();

export type IndexerParserApplicability = z.infer<
  typeof indexerParserApplicabilitySchema
>;
export type IndexerParserExecutionPlanEntry = z.infer<
  typeof indexerParserExecutionPlanEntrySchema
>;
export type IndexerParserExecutionPlan = z.infer<
  typeof indexerParserExecutionPlanSchema
>;

export function indexerParserExecutionEntryDigest(
  value: z.input<typeof indexerParserExecutionPlanEntrySchema>,
): string {
  return indexerProtocolDigest(canonicalEntry(value));
}

function moduleKey(value: string | null): string {
  return value ?? "";
}

function entryKey(entry: Pick<
  IndexerParserExecutionPlanEntry,
  "capability" | "source_ref" | "module_ref" | "authority_domain"
>): string {
  return [
    entry.capability,
    entry.source_ref,
    moduleKey(entry.module_ref),
    entry.authority_domain,
  ].join("\u0000");
}

function applicabilityKey(value: IndexerParserApplicability): string {
  return [
    value.source_ref,
    moduleKey(value.module_ref),
    value.normalized_path,
    value.capability,
    value.authority_domain,
  ].join("\u0000");
}

function authorityKey(value: {
  source_ref: string;
  normalized_path: string;
  authority_domain: string;
}): string {
  return [value.source_ref, value.normalized_path, value.authority_domain].join("\u0000");
}

function sourceFileKey(value: { source_ref: string; normalized_path: string }): string {
  return [value.source_ref, value.normalized_path].join("\u0000");
}

function compareKeys(left: string, right: string): number {
  return compareIndexerCanonicalText(left, right);
}

function canonicalEntry(
  value: z.input<typeof indexerParserExecutionPlanEntrySchema>,
): IndexerParserExecutionPlanEntry {
  const entry = indexerParserExecutionPlanEntrySchema.parse(value);
  return {
    ...entry,
    files: [...entry.files].sort((left, right) =>
      compareKeys(left.normalized_path, right.normalized_path)
    ),
  };
}

function canonicalApplicability(
  value: z.input<typeof indexerParserApplicabilitySchema>,
): IndexerParserApplicability {
  return indexerParserApplicabilitySchema.parse(value);
}

function payloadWithoutDigest(
  plan: IndexerParserExecutionPlan,
): Omit<IndexerParserExecutionPlan, "plan_digest"> {
  const { plan_digest: _planDigest, ...payload } = plan;
  void _planDigest;
  return payload;
}

function assertCanonicalOrder(
  values: readonly string[],
  field: string,
): void {
  const sorted = [...values].sort(compareKeys);
  if (values.some((value, index) => value !== sorted[index])) {
    throw new TypeError(`${field} must use canonical order`);
  }
}

function assertExecutionPlanSemantics(plan: IndexerParserExecutionPlan): void {
  const entriesByKey = new Map<string, IndexerParserExecutionPlanEntry>();
  for (const entry of plan.entries) {
    const key = entryKey(entry);
    if (entriesByKey.has(key)) {
      throw new TypeError(`parser execution plan duplicates entry ${key}`);
    }
    entriesByKey.set(key, entry);
    assertCanonicalOrder(
      entry.files.map((file) => file.normalized_path),
      `${entry.capability}.files`,
    );
  }

  const applicabilityByKey = new Map<string, IndexerParserApplicability>();
  const contentDigests = new Map<string, string>();
  for (const item of plan.applicability) {
    const key = applicabilityKey(item);
    if (applicabilityByKey.has(key)) {
      throw new TypeError(`parser execution plan duplicates applicability ${key}`);
    }
    applicabilityByKey.set(key, item);
    const fileKey = sourceFileKey(item);
    const previousDigest = contentDigests.get(fileKey);
    if (previousDigest !== undefined && previousDigest !== item.content_digest) {
      throw new TypeError(`parser execution plan disagrees on content digest for ${fileKey}`);
    }
    contentDigests.set(fileKey, item.content_digest);
  }

  for (const entry of plan.entries) {
    for (const file of entry.files) {
      const key = applicabilityKey({
        source_ref: entry.source_ref,
        module_ref: entry.module_ref,
        normalized_path: file.normalized_path,
        content_digest: file.content_digest,
        contract_scope: file.contract_scope,
        capability: entry.capability,
        authority_domain: entry.authority_domain,
        disposition: "applicable",
        role: file.role,
      });
      const applicability = applicabilityByKey.get(key);
      if (
        applicability?.disposition !== "applicable" ||
        applicability.content_digest !== file.content_digest ||
        applicability.contract_scope !== file.contract_scope ||
        applicability.role !== file.role
      ) {
        throw new TypeError(`parser execution entry file lacks exact applicability ${key}`);
      }
    }
  }

  const ownerCounts = new Map<string, number>();
  const precedences = new Map<string, Set<number>>();
  const applicationCounts = new Map<string, number>();
  for (const item of plan.applicability) {
    if (item.disposition !== "applicable") continue;
    const entry = entriesByKey.get(entryKey({
      capability: item.capability,
      source_ref: item.source_ref,
      module_ref: item.module_ref,
      authority_domain: item.authority_domain,
    }));
    if (entry === undefined) {
      throw new TypeError(`applicable parser file has no execution entry: ${applicabilityKey(item)}`);
    }
    const matchingFile = entry.files.find((file) =>
      file.normalized_path === item.normalized_path &&
      file.content_digest === item.content_digest &&
      file.contract_scope === item.contract_scope &&
      file.role === item.role
    );
    if (matchingFile === undefined) {
      throw new TypeError(`applicable parser file is absent from its execution entry: ${applicabilityKey(item)}`);
    }
    const key = authorityKey(item);
    applicationCounts.set(key, (applicationCounts.get(key) ?? 0) + 1);
    if (item.role === "primary-owner") {
      ownerCounts.set(key, (ownerCounts.get(key) ?? 0) + 1);
    }
    const usedPrecedences = precedences.get(key) ?? new Set<number>();
    if (usedPrecedences.has(entry.precedence)) {
      throw new TypeError(`parser execution plan has equal precedence for ${key}`);
    }
    usedPrecedences.add(entry.precedence);
    precedences.set(key, usedPrecedences);
  }
  for (const key of applicationCounts.keys()) {
    if ((ownerCounts.get(key) ?? 0) !== 1) {
      throw new TypeError(`applicable parser authority ${key} must have exactly one primary owner`);
    }
  }
}

export function buildIndexerParserExecutionPlan(input: {
  profile_contract_digest: string;
  source_registry_digest: string;
  entries: readonly z.input<typeof indexerParserExecutionPlanEntrySchema>[];
  applicability: readonly z.input<typeof indexerParserApplicabilitySchema>[];
}): IndexerParserExecutionPlan {
  const entries = input.entries.map(canonicalEntry)
    .sort((left, right) => compareKeys(entryKey(left), entryKey(right)));
  const applicability = input.applicability.map(canonicalApplicability)
    .sort((left, right) => compareKeys(applicabilityKey(left), applicabilityKey(right)));
  const payload = parserExecutionPlanPayloadSchema.parse({
    protocol: "context.indexer.parser-execution-plan/v1",
    profile_contract_digest: input.profile_contract_digest,
    source_registry_digest: input.source_registry_digest,
    entries,
    applicability,
  });
  const plan = indexerParserExecutionPlanSchema.parse({
    ...payload,
    plan_digest: indexerProtocolDigest(payload),
  });
  assertExecutionPlanSemantics(plan);
  return plan;
}

export function validateIndexerParserExecutionPlan(
  value: unknown,
): IndexerParserExecutionPlan {
  const parsed = indexerParserExecutionPlanSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `parser execution plan is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const plan = parsed.data;
  assertCanonicalOrder(plan.entries.map(entryKey), "parser execution plan entries");
  assertCanonicalOrder(
    plan.applicability.map(applicabilityKey),
    "parser execution plan applicability",
  );
  assertExecutionPlanSemantics(plan);
  if (indexerProtocolDigest(payloadWithoutDigest(plan)) !== plan.plan_digest) {
    throw new TypeError("parser execution plan digest is invalid");
  }
  return plan;
}

export function indexerParserExecutionPlanDigest(value: unknown): string {
  return validateIndexerParserExecutionPlan(value).plan_digest;
}

export function sameIndexerParserExecutionPlan(
  left: unknown,
  right: unknown,
): boolean {
  return canonicalIndexerJson(validateIndexerParserExecutionPlan(left)) ===
    canonicalIndexerJson(validateIndexerParserExecutionPlan(right));
}
