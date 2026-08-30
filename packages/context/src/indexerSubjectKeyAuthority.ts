import { z } from "zod";
import {
  addDuplicateIssues,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
} from "./indexerProtocolCommon.js";
import {
  indexerSubjectKeyContractSchema,
  validateIndexerProfileContract,
  type IndexerSubjectKeyContract,
} from "./indexerProfileContract.js";
import type { IndexerProviderManifest } from "./indexerProvider.js";
import {
  canonicalIndexerNodeRef,
  indexerSubjectKeySchema,
  type IndexerSubjectKey,
} from "./indexerSubjectIdentity.js";

const communityAuthoritySchema = z.object({
  kind: z.literal("community-base"),
  profile_contract_version: indexerSemverSchema,
  profile_contract_digest: indexerDigestSchema,
}).strict();

const extensionAuthoritySchema = z.object({
  kind: z.literal("provider-extension"),
  extends: indexerIdSchema,
  provider_layer_id: indexerIdSchema,
  provider_id: indexerIdSchema,
  provider_version: indexerSemverSchema,
  provider_integrity: indexerDigestSchema,
  manifest_digest: indexerDigestSchema,
}).strict();

export const indexerResolvedSubjectKeySchema = z.object({
  protocol: z.literal("context.indexer.resolved-subject-key-schema/v1"),
  indexer_id: indexerIdSchema,
  profile: indexerIdSchema,
  authority: z.discriminatedUnion("kind", [
    communityAuthoritySchema,
    extensionAuthoritySchema,
  ]),
  schema: indexerSubjectKeyContractSchema,
  schema_digest: indexerDigestSchema,
  resolved_digest: indexerDigestSchema,
}).strict();

export type IndexerResolvedSubjectKeySchema = z.infer<
  typeof indexerResolvedSubjectKeySchema
>;

export const indexerResolvedSubjectKeySchemaSetSchema = z.object({
  protocol: z.literal("context.indexer.resolved-subject-key-schema-set/v1"),
  schemas: z.array(indexerResolvedSubjectKeySchema).min(1),
  set_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.schemas.map((schema) => `${schema.indexer_id}\u0000${schema.profile}`),
    context,
    "schemas",
  );
});

export type IndexerResolvedSubjectKeySchemaSet = z.infer<
  typeof indexerResolvedSubjectKeySchemaSetSchema
>;

export interface IndexerSubjectKeyProfileSelection {
  indexer_id: string;
  profile: string;
  role: "primary" | "supporting" | "extension";
  provider_layer_id: string;
}

export interface IndexerSubjectKeyProviderAuthority {
  indexer_id: string;
  provider_layer_id: string;
  provider_integrity: string;
  manifest_digest: string;
  manifest: IndexerProviderManifest;
}

function withoutResolvedDigest(
  value: IndexerResolvedSubjectKeySchema,
): Omit<IndexerResolvedSubjectKeySchema, "resolved_digest"> {
  const payload: Partial<IndexerResolvedSubjectKeySchema> = { ...value };
  Reflect.deleteProperty(payload, "resolved_digest");
  return payload as Omit<IndexerResolvedSubjectKeySchema, "resolved_digest">;
}

export function indexerSubjectKeySchemaDigest(
  profile: string,
  schema: IndexerSubjectKeyContract,
): string {
  return indexerProtocolDigest({ profile, schema });
}

export function indexerResolvedSubjectKeySchemaDigest(
  value: Omit<IndexerResolvedSubjectKeySchema, "resolved_digest">,
): string {
  return indexerProtocolDigest(value);
}

function canonicalSchemaSetPayload(
  schemas: readonly IndexerResolvedSubjectKeySchema[],
): Omit<IndexerResolvedSubjectKeySchemaSet, "set_digest"> {
  return {
    protocol: "context.indexer.resolved-subject-key-schema-set/v1",
    schemas: [...schemas].sort((left, right) => compareIndexerCanonicalText(
      `${left.indexer_id}\u0000${left.profile}`,
      `${right.indexer_id}\u0000${right.profile}`,
    )),
  };
}

function parseResolvedSchema(value: unknown): IndexerResolvedSubjectKeySchema {
  const parsed = indexerResolvedSubjectKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `resolved SubjectKey schema is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const payload = withoutResolvedDigest(parsed.data);
  if (indexerSubjectKeySchemaDigest(parsed.data.profile, parsed.data.schema) !== parsed.data.schema_digest) {
    throw new TypeError("resolved SubjectKey schema digest does not match its canonical schema");
  }
  if (indexerResolvedSubjectKeySchemaDigest(payload) !== parsed.data.resolved_digest) {
    throw new TypeError("resolved SubjectKey schema resolution digest does not match");
  }
  return parsed.data;
}

export function validateIndexerResolvedSubjectKeySchemaSet(
  value: unknown,
): IndexerResolvedSubjectKeySchemaSet {
  const parsed = indexerResolvedSubjectKeySchemaSetSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `resolved SubjectKey schema set is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const schemas = parsed.data.schemas.map(parseResolvedSchema);
  const payload = canonicalSchemaSetPayload(schemas);
  if (canonicalIndexerJson(payload.schemas) !== canonicalIndexerJson(parsed.data.schemas)) {
    throw new TypeError("resolved SubjectKey schemas are not in canonical order");
  }
  if (indexerProtocolDigest(payload) !== parsed.data.set_digest) {
    throw new TypeError("resolved SubjectKey schema set digest does not match");
  }
  return parsed.data;
}

export function requireIndexerSubjectKeySchemaBinding(input: {
  schema_set: unknown;
  indexer_id: string;
  profile: string;
  schema_digest: string;
}): IndexerResolvedSubjectKeySchema {
  const set = validateIndexerResolvedSubjectKeySchemaSet(input.schema_set);
  const resolved = set.schemas.find((schema) =>
    schema.indexer_id === input.indexer_id && schema.profile === input.profile
  );
  if (resolved === undefined) {
    throw new TypeError("resolved SubjectKey schema set has no exact Indexer/profile binding");
  }
  if (resolved.schema_digest !== input.schema_digest) {
    throw new TypeError("SubjectKey schema binding digest is stale");
  }
  return resolved;
}

function providerKey(indexerId: string, providerLayerId: string): string {
  return `${indexerId}\u0000${providerLayerId}`;
}

export function resolveIndexerSubjectKeySchemas(input: {
  profile_contract: unknown;
  operator_contract: unknown;
  selections: readonly IndexerSubjectKeyProfileSelection[];
  providers: readonly IndexerSubjectKeyProviderAuthority[];
}): IndexerResolvedSubjectKeySchemaSet {
  const contract = validateIndexerProfileContract(
    input.profile_contract,
    input.operator_contract,
  );
  const communitySchemas = new Map(contract.subject_key_schemas.map((schema) => {
    const { profile, ...value } = schema;
    return [profile, value] as const;
  }));
  const providers = new Map(input.providers.map((provider) => [
    providerKey(provider.indexer_id, provider.provider_layer_id),
    provider,
  ]));
  if (providers.size !== input.providers.length) {
    throw new TypeError("SubjectKey authority inputs contain duplicate Provider layers");
  }
  const selections = [...input.selections].sort((left, right) => compareIndexerCanonicalText(
    `${left.indexer_id}\u0000${left.profile}`,
    `${right.indexer_id}\u0000${right.profile}`,
  ));
  const selectionKeys = selections.map((selection) => `${selection.indexer_id}\u0000${selection.profile}`);
  if (new Set(selectionKeys).size !== selectionKeys.length) {
    throw new TypeError("an Indexer cannot select the same SubjectKey profile twice");
  }
  if (selections.length === 0) {
    throw new TypeError("SubjectKey schema resolution requires at least one selected profile");
  }
  const resolved = selections.map((selection): IndexerResolvedSubjectKeySchema => {
    const communitySchema = communitySchemas.get(selection.profile);
    if (communitySchema !== undefined) {
      if (selection.role === "extension" || selection.profile.includes("/")) {
        throw new TypeError("community SubjectKey schemas cannot be selected as extensions");
      }
      const payload: Omit<IndexerResolvedSubjectKeySchema, "resolved_digest"> = {
        protocol: "context.indexer.resolved-subject-key-schema/v1",
        indexer_id: selection.indexer_id,
        profile: selection.profile,
        authority: {
          kind: "community-base",
          profile_contract_version: contract.version,
          profile_contract_digest: contract.contract_digest,
        },
        schema: communitySchema,
        schema_digest: indexerSubjectKeySchemaDigest(selection.profile, communitySchema),
      };
      return { ...payload, resolved_digest: indexerResolvedSubjectKeySchemaDigest(payload) };
    }
    if (selection.role !== "extension" || !selection.profile.includes("/")) {
      throw new TypeError(`profile ${selection.profile} has no community SubjectKey schema`);
    }
    const owner = providers.get(providerKey(selection.indexer_id, selection.provider_layer_id));
    if (owner === undefined) {
      throw new TypeError(`extension profile ${selection.profile} has no exact owner Provider layer`);
    }
    const declarations = input.providers.flatMap((provider) =>
      (provider.manifest.composition?.extensions ?? [])
        .filter((extension) => extension.profile === selection.profile)
        .map((extension) => ({ provider, extension }))
    );
    const declarationAuthorities = new Map(declarations.map((declaration) => [
      canonicalIndexerJson({
        provider_id: declaration.provider.manifest.id,
        provider_version: declaration.provider.manifest.version,
        provider_integrity: declaration.provider.provider_integrity,
        manifest_digest: declaration.provider.manifest_digest,
        extension: declaration.extension,
      }),
      declaration,
    ]));
    const ownerAuthorityKey = canonicalIndexerJson({
      provider_id: owner.manifest.id,
      provider_version: owner.manifest.version,
      provider_integrity: owner.provider_integrity,
      manifest_digest: owner.manifest_digest,
      extension: (owner.manifest.composition?.extensions ?? [])
        .find((extension) => extension.profile === selection.profile),
    });
    if (
      declarationAuthorities.size !== 1 ||
      !declarationAuthorities.has(ownerAuthorityKey)
    ) {
      throw new TypeError(`extension profile ${selection.profile} must have one unique owner authority`);
    }
    const declaration = declarationAuthorities.values().next().value!.extension;
    if (!communitySchemas.has(declaration.extends)) {
      throw new TypeError(
        `extension profile ${selection.profile} extends unknown community profile ${declaration.extends}`,
      );
    }
    const schema = declaration.subject_key_schema;
    const payload: Omit<IndexerResolvedSubjectKeySchema, "resolved_digest"> = {
      protocol: "context.indexer.resolved-subject-key-schema/v1",
      indexer_id: selection.indexer_id,
      profile: selection.profile,
      authority: {
        kind: "provider-extension",
        extends: declaration.extends,
        provider_layer_id: owner.provider_layer_id,
        provider_id: owner.manifest.id,
        provider_version: owner.manifest.version,
        provider_integrity: owner.provider_integrity,
        manifest_digest: owner.manifest_digest,
      },
      schema,
      schema_digest: indexerSubjectKeySchemaDigest(selection.profile, schema),
    };
    return { ...payload, resolved_digest: indexerResolvedSubjectKeySchemaDigest(payload) };
  });
  const payload = canonicalSchemaSetPayload(resolved);
  return validateIndexerResolvedSubjectKeySchemaSet({
    ...payload,
    set_digest: indexerProtocolDigest(payload),
  });
}

function assertNormalization(
  value: string,
  rules: readonly string[],
  field: string,
): void {
  if (rules.includes("trim") && value.trim() !== value) {
    throw new TypeError(`SubjectKey ${field} violates trim normalization`);
  }
  if (rules.includes("unicode-nfc") && value.normalize("NFC") !== value) {
    throw new TypeError(`SubjectKey ${field} violates unicode-nfc normalization`);
  }
  if (rules.includes("lowercase") && value.toLocaleLowerCase("en-US") !== value) {
    throw new TypeError(`SubjectKey ${field} violates lowercase normalization`);
  }
}

export function validateIndexerSubjectKeyForSchema(
  value: unknown,
  resolvedValue: unknown,
): IndexerSubjectKey {
  const resolved = parseResolvedSchema(resolvedValue);
  const subject = indexerSubjectKeySchema.parse(value);
  if (!resolved.schema.kinds.some((kind) => kind.id === subject.kind)) {
    throw new TypeError(`SubjectKey kind ${subject.kind} is absent from profile ${resolved.profile}`);
  }
  const rules = resolved.schema.normalization ?? [];
  assertNormalization(subject.namespace, rules, "namespace");
  assertNormalization(subject.kind, rules, "kind");
  assertNormalization(subject.local_key, rules, "local_key");
  return subject;
}

const approvedSubjectSchema = z.object({
  node_ref: z.string().regex(/^node:subject:sha256:[a-f0-9]{64}$/u),
  subject_key: indexerSubjectKeySchema,
}).strict();

const proposedMappingSchema = z.object({
  old_node_ref: z.string().regex(/^node:subject:sha256:[a-f0-9]{64}$/u),
  new_subject_key: indexerSubjectKeySchema,
}).strict();

const transitionIssueSchema = z.enum([
  "schema-version-not-increased",
  "authority-major-not-increased",
  "missing-mapping",
  "unknown-mapping-source",
  "ambiguous-mapping",
  "collision",
]);

export const indexerSubjectReidentificationReportSchema = z.object({
  protocol: z.literal("context.indexer.subject-reidentification-report/v1"),
  profile: indexerIdSchema,
  old_schema_digest: indexerDigestSchema,
  new_schema_digest: indexerDigestSchema,
  old_authority_version: indexerSemverSchema,
  new_authority_version: indexerSemverSchema,
  classification: z.enum(["equivalent", "compatible", "identity-breaking"]),
  approved_catalog_digest: indexerDigestSchema,
  affected_node_refs: z.array(z.string()),
  mappings: z.array(z.object({
    old_node_ref: z.string(),
    new_node_ref: z.string(),
    new_subject_key: indexerSubjectKeySchema,
  }).strict()),
  missing_node_refs: z.array(z.string()),
  splits: z.array(z.object({
    old_node_ref: z.string(),
    new_node_refs: z.array(z.string()).min(2),
  }).strict()),
  merges: z.array(z.object({
    new_node_ref: z.string(),
    old_node_refs: z.array(z.string()).min(2),
  }).strict()),
  collisions: z.array(z.object({
    new_node_ref: z.string(),
    old_node_refs: z.array(z.string()).min(2),
  }).strict()),
  issues: z.array(transitionIssueSchema),
  mapping_digest: indexerDigestSchema,
  gate_required: z.boolean(),
  activation_allowed: z.boolean(),
  report_digest: indexerDigestSchema,
}).strict();

export type IndexerSubjectReidentificationReport = z.infer<
  typeof indexerSubjectReidentificationReportSchema
>;

function schemaClassification(
  oldSchema: IndexerSubjectKeyContract,
  newSchema: IndexerSubjectKeyContract,
): "equivalent" | "compatible" | "identity-breaking" {
  if (canonicalIndexerJson(oldSchema) === canonicalIndexerJson(newSchema)) return "equivalent";
  if (
    oldSchema.namespace.operator !== newSchema.namespace.operator ||
    canonicalIndexerJson(oldSchema.normalization ?? []) !==
      canonicalIndexerJson(newSchema.normalization ?? [])
  ) {
    return "identity-breaking";
  }
  const newKinds = new Map(newSchema.kinds.map((kind) => [kind.id, kind.local_key.operator]));
  return oldSchema.kinds.every((kind) => newKinds.get(kind.id) === kind.local_key.operator)
    ? "compatible"
    : "identity-breaking";
}

function major(version: string): number {
  return Number(version.split(".", 1)[0]);
}

function authorityVersion(schema: IndexerResolvedSubjectKeySchema): string {
  return schema.authority.kind === "community-base"
    ? schema.authority.profile_contract_version
    : schema.authority.provider_version;
}

function affectedApprovedSubjects(input: {
  classification: "equivalent" | "compatible" | "identity-breaking";
  oldSchema: IndexerSubjectKeyContract;
  newSchema: IndexerSubjectKeyContract;
  approved: z.infer<typeof approvedSubjectSchema>[];
}): z.infer<typeof approvedSubjectSchema>[] {
  if (input.classification !== "identity-breaking") return [];
  const globalChange = input.oldSchema.namespace.operator !== input.newSchema.namespace.operator ||
    canonicalIndexerJson(input.oldSchema.normalization ?? []) !==
      canonicalIndexerJson(input.newSchema.normalization ?? []);
  if (globalChange) return input.approved;
  const newKinds = new Map(
    input.newSchema.kinds.map((kind) => [kind.id, kind.local_key.operator]),
  );
  return input.approved.filter((item) => {
    const oldKind = input.oldSchema.kinds.find((kind) => kind.id === item.subject_key.kind);
    return oldKind === undefined || newKinds.get(item.subject_key.kind) !== oldKind.local_key.operator;
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIndexerCanonicalText);
}

export function analyzeIndexerSubjectKeySchemaTransition(input: {
  old_schema: unknown;
  new_schema: unknown;
  approved_subjects: readonly unknown[];
  proposed_mappings: readonly unknown[];
}): IndexerSubjectReidentificationReport {
  const oldSchema = parseResolvedSchema(input.old_schema);
  const newSchema = parseResolvedSchema(input.new_schema);
  if (oldSchema.profile !== newSchema.profile) {
    throw new TypeError("SubjectKey schema transition must preserve the profile authority");
  }
  if (oldSchema.authority.kind !== newSchema.authority.kind) {
    throw new TypeError("SubjectKey schema transition cannot change authority kind");
  }
  if (
    oldSchema.authority.kind === "provider-extension" &&
    (newSchema.authority.kind !== "provider-extension" ||
      oldSchema.authority.provider_id !== newSchema.authority.provider_id)
  ) {
    throw new TypeError("SubjectKey extension transition cannot change owner Provider");
  }
  const approved = input.approved_subjects.map((value) => approvedSubjectSchema.parse(value));
  const approvedRefs = approved.map((item) => item.node_ref);
  if (new Set(approvedRefs).size !== approvedRefs.length) {
    throw new TypeError("approved SubjectKey catalog contains duplicate node_ref entries");
  }
  for (const item of approved) {
    validateIndexerSubjectKeyForSchema(item.subject_key, oldSchema);
    if (canonicalIndexerNodeRef(item.subject_key) !== item.node_ref) {
      throw new TypeError("approved SubjectKey node_ref does not match its canonical identity");
    }
  }
  const proposed = input.proposed_mappings.map((value) => proposedMappingSchema.parse(value));
  const classification = schemaClassification(oldSchema.schema, newSchema.schema);
  const affected = affectedApprovedSubjects({
    classification,
    oldSchema: oldSchema.schema,
    newSchema: newSchema.schema,
    approved,
  });
  const affectedRefs = new Set(affected.map((item) => item.node_ref));
  const issues: z.infer<typeof transitionIssueSchema>[] = [];
  if (
    oldSchema.schema_digest !== newSchema.schema_digest &&
    newSchema.schema.version <= oldSchema.schema.version
  ) issues.push("schema-version-not-increased");
  const oldAuthorityVersion = authorityVersion(oldSchema);
  const newAuthorityVersion = authorityVersion(newSchema);
  if (
    classification === "identity-breaking" &&
    major(newAuthorityVersion) <= major(oldAuthorityVersion)
  ) issues.push("authority-major-not-increased");

  const byOld = new Map<string, Array<{
    old_node_ref: string;
    new_node_ref: string;
    new_subject_key: IndexerSubjectKey;
  }>>();
  for (const item of proposed) {
    if (!affectedRefs.has(item.old_node_ref)) {
      issues.push("unknown-mapping-source");
      continue;
    }
    validateIndexerSubjectKeyForSchema(item.new_subject_key, newSchema);
    const mapped = {
      old_node_ref: item.old_node_ref,
      new_node_ref: canonicalIndexerNodeRef(item.new_subject_key),
      new_subject_key: item.new_subject_key,
    };
    const entries = byOld.get(item.old_node_ref) ?? [];
    if (!entries.some((entry) => canonicalIndexerJson(entry) === canonicalIndexerJson(mapped))) {
      entries.push(mapped);
    }
    byOld.set(item.old_node_ref, entries);
  }
  const missingNodeRefs = [...affectedRefs].filter((nodeRef) => !byOld.has(nodeRef))
    .sort(compareIndexerCanonicalText);
  if (missingNodeRefs.length > 0) issues.push("missing-mapping");
  const splits = [...byOld.entries()].filter(([, entries]) => entries.length > 1).map(
    ([oldNodeRef, entries]) => ({
      old_node_ref: oldNodeRef,
      new_node_refs: entries.map((entry) => entry.new_node_ref).sort(compareIndexerCanonicalText),
    }),
  ).sort((left, right) => compareIndexerCanonicalText(left.old_node_ref, right.old_node_ref));
  if (splits.length > 0) issues.push("ambiguous-mapping");
  const mappings = [...byOld.values()].flat().sort((left, right) => compareIndexerCanonicalText(
    `${left.old_node_ref}\u0000${left.new_node_ref}`,
    `${right.old_node_ref}\u0000${right.new_node_ref}`,
  ));
  const byNew = new Map<string, string[]>();
  for (const mapping of mappings) {
    const sources = byNew.get(mapping.new_node_ref) ?? [];
    sources.push(mapping.old_node_ref);
    byNew.set(mapping.new_node_ref, sources);
  }
  const merges = [...byNew.entries()].filter(([, sources]) => new Set(sources).size > 1).map(
    ([newNodeRef, sources]) => ({
      new_node_ref: newNodeRef,
      old_node_refs: uniqueSorted(sources),
    }),
  ).sort((left, right) => compareIndexerCanonicalText(left.new_node_ref, right.new_node_ref));
  const collisions = [...merges];
  if (collisions.length > 0) issues.push("collision");
  const approvedCatalog = approved.slice().sort((left, right) =>
    compareIndexerCanonicalText(left.node_ref, right.node_ref)
  );
  const mappingDigest = indexerProtocolDigest(mappings);
  const uniqueIssues = uniqueSorted(issues) as z.infer<typeof transitionIssueSchema>[];
  const base: Omit<IndexerSubjectReidentificationReport, "report_digest"> = {
    protocol: "context.indexer.subject-reidentification-report/v1",
    profile: oldSchema.profile,
    old_schema_digest: oldSchema.schema_digest,
    new_schema_digest: newSchema.schema_digest,
    old_authority_version: oldAuthorityVersion,
    new_authority_version: newAuthorityVersion,
    classification,
    approved_catalog_digest: indexerProtocolDigest(approvedCatalog),
    affected_node_refs: [...affectedRefs].sort(compareIndexerCanonicalText),
    mappings,
    missing_node_refs: missingNodeRefs,
    splits,
    merges,
    collisions,
    issues: uniqueIssues,
    mapping_digest: mappingDigest,
    gate_required: classification === "identity-breaking" && affectedRefs.size > 0,
    activation_allowed: uniqueIssues.length === 0,
  };
  return { ...base, report_digest: indexerProtocolDigest(base) };
}

export const indexerSubjectReidentificationAuthorizationSchema = z.object({
  protocol: z.literal("context.indexer.subject-reidentification-authorization/v1"),
  action: z.literal("confirm-subject-reidentification"),
  project_ref: z.string().min(1),
  profile: indexerIdSchema,
  old_schema_digest: indexerDigestSchema,
  new_schema_digest: indexerDigestSchema,
  approved_catalog_digest: indexerDigestSchema,
  mapping_digest: indexerDigestSchema,
  report_digest: indexerDigestSchema,
  non_delegable: z.literal(true),
  authorized_by: z.string().min(1),
  authorized_at: z.string().datetime({ offset: true }),
  authorization_digest: indexerDigestSchema,
}).strict();

export type IndexerSubjectReidentificationAuthorization = z.infer<
  typeof indexerSubjectReidentificationAuthorizationSchema
>;

export function indexerSubjectReidentificationAuthorizationDigest(
  value: Omit<IndexerSubjectReidentificationAuthorization, "authorization_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function authorizeIndexerSubjectReidentification(input: {
  report: IndexerSubjectReidentificationReport;
  project_ref: string;
  authorized_by: string;
  authorized_at: string;
}): IndexerSubjectReidentificationAuthorization {
  if (!input.report.activation_allowed || !input.report.gate_required) {
    throw new TypeError("only an activation-safe transition with approved affected Nodes needs authorization");
  }
  const payload: Omit<IndexerSubjectReidentificationAuthorization, "authorization_digest"> = {
    protocol: "context.indexer.subject-reidentification-authorization/v1",
    action: "confirm-subject-reidentification",
    project_ref: input.project_ref,
    profile: input.report.profile,
    old_schema_digest: input.report.old_schema_digest,
    new_schema_digest: input.report.new_schema_digest,
    approved_catalog_digest: input.report.approved_catalog_digest,
    mapping_digest: input.report.mapping_digest,
    report_digest: input.report.report_digest,
    non_delegable: true,
    authorized_by: input.authorized_by,
    authorized_at: input.authorized_at,
  };
  return indexerSubjectReidentificationAuthorizationSchema.parse({
    ...payload,
    authorization_digest: indexerSubjectReidentificationAuthorizationDigest(payload),
  });
}

export function enforceIndexerSubjectKeySchemaTransition(input: {
  report: unknown;
  old_schema: unknown;
  new_schema: unknown;
  approved_subjects: readonly unknown[];
  proposed_mappings: readonly unknown[];
  project_ref: string;
  authorization?: unknown;
}): IndexerSubjectReidentificationReport {
  const report = indexerSubjectReidentificationReportSchema.parse(input.report);
  const expected = analyzeIndexerSubjectKeySchemaTransition({
    old_schema: input.old_schema,
    new_schema: input.new_schema,
    approved_subjects: input.approved_subjects,
    proposed_mappings: input.proposed_mappings,
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(report)) {
    throw new TypeError("SubjectKey re-identification report is stale or was not recomputed");
  }
  if (!report.activation_allowed || report.issues.length > 0) {
    throw new TypeError(
      `SubjectKey schema activation is blocked: ${report.issues.join(", ") || "invalid transition"}`,
    );
  }
  if (!report.gate_required) {
    if (input.authorization !== undefined) {
      throw new TypeError("SubjectKey transition does not accept an unnecessary authorization");
    }
    return report;
  }
  const authorization = indexerSubjectReidentificationAuthorizationSchema.parse(
    input.authorization,
  );
  const payload: Partial<IndexerSubjectReidentificationAuthorization> = {
    ...authorization,
  };
  Reflect.deleteProperty(payload, "authorization_digest");
  if (
    indexerSubjectReidentificationAuthorizationDigest(
      payload as Omit<IndexerSubjectReidentificationAuthorization, "authorization_digest">,
    ) !==
      authorization.authorization_digest
  ) {
    throw new TypeError("SubjectKey re-identification authorization digest does not match");
  }
  if (
    authorization.project_ref !== input.project_ref ||
    authorization.profile !== report.profile ||
    authorization.old_schema_digest !== report.old_schema_digest ||
    authorization.new_schema_digest !== report.new_schema_digest ||
    authorization.approved_catalog_digest !== report.approved_catalog_digest ||
    authorization.mapping_digest !== report.mapping_digest ||
    authorization.report_digest !== report.report_digest
  ) {
    throw new TypeError("SubjectKey re-identification authorization is stale or for another transition");
  }
  return report;
}
