import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  INDEXER_SEMANTIC_OPERATIONS,
  addDuplicateIssues,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
  isPortableIndexerPath,
} from "./indexerProtocolCommon.js";

const stableRefSchema = z.string().regex(
  /^[a-z][a-z0-9.-]*:[A-Za-z0-9][A-Za-z0-9._~:/#-]*$/u,
);

const indexerJsonSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(indexerJsonSchema),
    z.record(indexerJsonSchema),
  ])
);

export type IndexerJson =
  | null
  | boolean
  | number
  | string
  | IndexerJson[]
  | { [key: string]: IndexerJson };

const scopeTargetSchema = z.object({
  source_ref: stableRefSchema,
  module_refs: z.array(stableRefSchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.module_refs, context, "module_refs");
});

const targetScopeSchema = z.object({
  targets: z.array(scopeTargetSchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.targets.map((target) => target.source_ref),
    context,
    "targets.source_ref",
  );
});

const requirementQuestionSchema = z.object({
  ref: stableRefSchema,
  authority: z.object({
    kind: z.enum(["cli-base-contract", "verified-contract-overlay"]),
    ref: stableRefSchema,
    digest: indexerDigestSchema,
  }).strict(),
  contract_version: z.number().int().positive(),
  contract_digest: indexerDigestSchema,
}).strict();

const requirementExclusionSchema = z.object({
  id: indexerIdSchema,
  scope: targetScopeSchema,
  reason: z.string().min(1),
}).strict();

export const indexRequirementSchema = z.object({
  id: indexerIdSchema,
  reader_goals: z.array(indexerIdSchema).min(1),
  coverage_domains: z.record(
    indexerIdSchema,
    z.enum(["required", "optional", "out-of-scope"]),
  ),
  questions: z.array(requirementQuestionSchema).optional(),
  target_scope: targetScopeSchema,
  evidence_source_scope: targetScopeSchema,
  exclusions: z.array(requirementExclusionSchema).optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.reader_goals, context, "reader_goals");
  if (Object.keys(value.coverage_domains).length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "coverage_domains must contain at least one domain",
      path: ["coverage_domains"],
    });
  }
  addDuplicateIssues((value.questions ?? []).map((question) => question.ref), context, "questions");
  addDuplicateIssues((value.exclusions ?? []).map((exclusion) => exclusion.id), context, "exclusions");
});

export const indexRequirementSetSchema = z.object({
  protocol: z.literal("context.indexer.requirement-set/v1"),
  requirements: z.array(indexRequirementSchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.requirements.map((requirement) => requirement.id), context, "requirements");
});

const scopeRefSchema = z.string().regex(
  /^requirement:[a-z0-9][a-z0-9._/-]*#(?:target_scope|evidence_source_scope)$/u,
);

const ownedScopeSchema = z.union([
  z.object({ ref: scopeRefSchema }).strict(),
  targetScopeSchema,
]);

const requirementBindingSchema = z.object({
  requirement_ref: indexerIdSchema,
  coverage_domains: z.array(indexerIdSchema).min(1),
  owned_scope: ownedScopeSchema,
  role: z.enum(["primary", "enricher"]),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.coverage_domains, context, "coverage_domains");
});

const readScopeSchema = z.object({
  refs: z.array(scopeRefSchema).min(1),
  extra_targets: z.array(scopeTargetSchema).optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.refs, context, "refs");
  addDuplicateIssues(
    (value.extra_targets ?? []).map((target) => target.source_ref),
    context,
    "extra_targets.source_ref",
  );
});

const profileBindingSchema = z.object({
  id: indexerIdSchema,
  provider: indexerIdSchema,
  variants: z.record(indexerIdSchema, indexerIdSchema).optional(),
}).strict();

const additionalProfileBindingSchema = profileBindingSchema.extend({
  kind: z.enum(["supporting", "extension"]),
}).strict();

const composerBindingSchema = z.object({
  id: indexerIdSchema,
  provider: indexerIdSchema,
}).strict();

const locatorId = "[a-z0-9][a-z0-9._-]*";
const portableLocatorPath = "[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*";

export const indexerDistributionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cli-bundled"),
    locator: z.string().regex(
      new RegExp(`^cli-bundled://${locatorId}/${locatorId}$`, "u"),
      "cli-bundled locator must identify one release bundle set and Skill",
    ),
  }).strict(),
  z.object({
    kind: z.literal("bundled"),
    locator: z.string().regex(
      new RegExp(`^plugin://${locatorId}/${locatorId}$`, "u"),
      "bundled locator must identify one exact plugin and Skill",
    ),
  }).strict(),
  z.object({
    kind: z.literal("workspace"),
    locator: z.string().regex(
      new RegExp(`^workspace://${portableLocatorPath}$`, "u"),
      "workspace locator must contain a portable repository-relative Skill directory",
    ),
  }).strict(),
  z.object({
    kind: z.literal("package"),
    locator: z.string().regex(
      new RegExp(`^package://${locatorId}/[^/#\\s]+#${portableLocatorPath}$`, "u"),
      "package locator must identify a registry, encoded package and Bundle subpath",
    ),
  }).strict(),
  z.object({
    kind: z.literal("marketplace"),
    locator: z.string().regex(
      new RegExp(`^marketplace://${locatorId}/${locatorId}/${locatorId}$`, "u"),
      "marketplace locator must identify a marketplace, publisher and artifact",
    ),
  }).strict(),
]).superRefine((value, context) => {
  if (
    value.kind === "workspace" &&
    !isPortableIndexerPath(value.locator.slice("workspace://".length))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "workspace locator path must not escape the repository root",
      path: ["locator"],
    });
  }
  if (value.kind === "package") {
    const separator = value.locator.indexOf("#");
    if (separator < 0 || !isPortableIndexerPath(value.locator.slice(separator + 1))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "package Bundle subpath must be portable",
        path: ["locator"],
      });
    }
  }
});

const FORBIDDEN_CONFIG_KEYS = new Set([
  "settings",
  "inventory",
  "files",
  "symbols",
  "pages",
  "metrics",
  "thresholds",
  "output",
  "output_path",
  "out_dir",
  "batch",
  "priority",
  "execution_order",
  "dependency_results",
  "passed",
]);

function forbiddenConfigPath(value: IndexerJson, path: readonly string[] = []): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = forbiddenConfigPath(item, [...path, String(index)]);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_CONFIG_KEYS.has(key)) return [...path, key].join(".");
    const found = forbiddenConfigPath(item, [...path, key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

const providerLayerSchema = z.object({
  id: indexerIdSchema,
  role: z.enum(["primary", "extension"]),
  skill: indexerIdSchema,
  version: indexerSemverSchema,
  integrity: indexerDigestSchema,
  distribution: indexerDistributionSchema,
  config: z.record(indexerJsonSchema).optional(),
}).strict().superRefine((value, context) => {
  const forbidden = value.config === undefined
    ? undefined
    : forbiddenConfigPath(value.config);
  if (forbidden !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Provider config contains non-persistent runtime field ${forbidden}`,
      path: ["config"],
    });
  }
});

export const indexerRegistryEntrySchema = z.object({
  id: indexerIdSchema,
  operations: z.array(z.enum(INDEXER_SEMANTIC_OPERATIONS)).min(1),
  requirement_bindings: z.array(requirementBindingSchema).min(1),
  read_scope: readScopeSchema,
  profile: z.object({
    primary: profileBindingSchema,
    additional: z.array(additionalProfileBindingSchema).optional(),
    composers: z.array(composerBindingSchema).optional(),
  }).strict(),
  providers: z.array(providerLayerSchema).min(1),
  customization: z.object({
    mode: z.enum(["extend", "replace"]),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.operations, context, "operations");
  addDuplicateIssues(value.providers.map((provider) => provider.id), context, "providers");
  const primaryProviders = value.providers.filter((provider) => provider.role === "primary");
  if (primaryProviders.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "providers must contain exactly one primary layer",
      path: ["providers"],
    });
  }
  const profileIds = [
    value.profile.primary.id,
    ...(value.profile.additional ?? []).map((profile) => profile.id),
  ];
  addDuplicateIssues(profileIds, context, "profile bindings");
  addDuplicateIssues(
    (value.profile.composers ?? []).map((composer) => `${composer.provider}:${composer.id}`),
    context,
    "profile.composers",
  );
  addDuplicateIssues(
    value.requirement_bindings.map((binding) => [
      binding.requirement_ref,
      binding.role,
      binding.coverage_domains.join(","),
      "ref" in binding.owned_scope
        ? binding.owned_scope.ref
        : JSON.stringify(binding.owned_scope.targets),
    ].join("|")),
    context,
    "requirement_bindings",
  );
});

export const indexerRegistrySchema = z.object({
  protocol: z.literal("context.indexer.registry/v1"),
  requirements: z.array(indexRequirementSchema).min(1),
  indexers: z.array(indexerRegistryEntrySchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.requirements.map((requirement) => requirement.id), context, "requirements");
  addDuplicateIssues(value.indexers.map((indexer) => indexer.id), context, "indexers");
});

export type IndexRequirement = z.infer<typeof indexRequirementSchema>;
export type IndexRequirementSet = z.infer<typeof indexRequirementSetSchema>;
export type IndexerDistribution = z.infer<typeof indexerDistributionSchema>;
export type IndexerRegistryEntry = z.infer<typeof indexerRegistryEntrySchema>;
export type IndexerRegistry = z.infer<typeof indexerRegistrySchema>;
export type IndexerScopeTarget = z.infer<typeof scopeTargetSchema>;

export interface LoadedIndexerRegistry {
  path: typeof DEFAULT_INDEXER_REGISTRY_PATH;
  absolutePath: string;
  registry: IndexerRegistry;
  requirementSet: IndexRequirementSet;
  requirementSetDigest: string;
  indexerSelectionDigest: string;
  registryDigest: string;
}

function parseYamlDocument(source: string, label: string): unknown {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new TypeError(
      `${label} is not valid YAML: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return document.toJS();
}

function scopeRef(requirementId: string, kind: "target_scope" | "evidence_source_scope"): string {
  return `requirement:${requirementId}#${kind}`;
}

function targetCells(targets: readonly IndexerScopeTarget[]): string[] {
  return targets.flatMap((target) =>
    target.module_refs.length === 0
      ? [`${target.source_ref}\u0000`]
      : target.module_refs.map((moduleRef) => `${target.source_ref}\u0000${moduleRef}`)
  );
}

function targetCellSet(targets: readonly IndexerScopeTarget[]): Set<string> {
  return new Set(targetCells(targets));
}

function assertTargetSubset(
  subset: readonly IndexerScopeTarget[],
  superset: readonly IndexerScopeTarget[],
  field: string,
): void {
  const allowed = targetCellSet(superset);
  const invalid = targetCells(subset).find((cell) => !allowed.has(cell));
  if (invalid !== undefined) {
    throw new TypeError(`${field} must stay within its confirmed requirement scope`);
  }
}

function boundRequirementIds(indexer: IndexerRegistryEntry): Set<string> {
  return new Set(indexer.requirement_bindings.map((binding) => binding.requirement_ref));
}

function providerIds(indexer: IndexerRegistryEntry): Set<string> {
  return new Set(indexer.providers.map((provider) => provider.id));
}

function validateIndexerReferences(registry: IndexerRegistry): void {
  const requirements = new Map(
    registry.requirements.map((requirement) => [requirement.id, requirement]),
  );
  for (const indexer of registry.indexers) {
    const providers = providerIds(indexer);
    const profileBindings = [
      indexer.profile.primary,
      ...(indexer.profile.additional ?? []),
      ...(indexer.profile.composers ?? []),
    ];
    for (const binding of profileBindings) {
      if (!providers.has(binding.provider)) {
        throw new TypeError(
          `Indexer ${indexer.id} profile binding references unknown Provider ${binding.provider}`,
        );
      }
    }
    const boundRequirements = boundRequirementIds(indexer);
    for (const binding of indexer.requirement_bindings) {
      const requirement = requirements.get(binding.requirement_ref);
      if (requirement === undefined) {
        throw new TypeError(
          `Indexer ${indexer.id} references unknown requirement ${binding.requirement_ref}`,
        );
      }
      for (const domain of binding.coverage_domains) {
        const coverage = requirement.coverage_domains[domain];
        if (coverage === undefined || coverage === "out-of-scope") {
          throw new TypeError(
            `Indexer ${indexer.id} cannot own unavailable coverage domain ${domain}`,
          );
        }
      }
      if ("ref" in binding.owned_scope) {
        const expected = scopeRef(requirement.id, "target_scope");
        if (binding.owned_scope.ref !== expected) {
          throw new TypeError(
            `Indexer ${indexer.id} owned_scope.ref must be ${expected}`,
          );
        }
      } else {
        assertTargetSubset(
          binding.owned_scope.targets,
          requirement.target_scope.targets,
          `Indexer ${indexer.id} owned_scope.targets`,
        );
        const ownedCells = targetCellSet(binding.owned_scope.targets);
        const requirementCells = targetCellSet(requirement.target_scope.targets);
        if (
          ownedCells.size === requirementCells.size &&
          [...ownedCells].every((cell) => requirementCells.has(cell))
        ) {
          throw new TypeError(
            `Indexer ${indexer.id} must reference ${scopeRef(requirement.id, "target_scope")} instead of repeating its complete target scope`,
          );
        }
      }
    }
    for (const ref of indexer.read_scope.refs) {
      const match = /^requirement:([^#]+)#(target_scope|evidence_source_scope)$/u.exec(ref);
      if (match === null || !boundRequirements.has(match[1]!)) {
        throw new TypeError(
          `Indexer ${indexer.id} read_scope ref must use one of its bound requirements: ${ref}`,
        );
      }
    }
    const readableTargets = [...boundRequirements].flatMap((requirementId) => {
      const requirement = requirements.get(requirementId)!;
      return [
        ...requirement.target_scope.targets,
        ...requirement.evidence_source_scope.targets,
      ];
    });
    assertTargetSubset(
      indexer.read_scope.extra_targets ?? [],
      readableTargets,
      `Indexer ${indexer.id} read_scope.extra_targets`,
    );
    const referencedReadTargets = indexer.read_scope.refs.flatMap((ref) => {
      const match = /^requirement:([^#]+)#(target_scope|evidence_source_scope)$/u.exec(ref)!;
      const requirement = requirements.get(match[1]!)!;
      return match[2] === "target_scope"
        ? requirement.target_scope.targets
        : requirement.evidence_source_scope.targets;
    });
    const referencedCells = targetCellSet(referencedReadTargets);
    const duplicateExtra = targetCells(indexer.read_scope.extra_targets ?? [])
      .find((cell) => referencedCells.has(cell));
    if (duplicateExtra !== undefined) {
      throw new TypeError(
        `Indexer ${indexer.id} read_scope.extra_targets repeats a scope already included by ref`,
      );
    }
  }
}

export function parseIndexerRegistry(
  source: string,
  label = DEFAULT_INDEXER_REGISTRY_PATH,
): IndexerRegistry {
  const parsed = indexerRegistrySchema.safeParse(parseYamlDocument(source, label));
  if (!parsed.success) {
    throw new TypeError(
      `${label} does not satisfy context.indexer.registry/v1: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  validateIndexerReferences(parsed.data);
  return parsed.data;
}

export function requirementSetFromRegistry(registry: IndexerRegistry): IndexRequirementSet {
  return {
    protocol: "context.indexer.requirement-set/v1",
    requirements: registry.requirements,
  };
}

export function indexerRegistryDigests(registry: IndexerRegistry): {
  requirementSetDigest: string;
  indexerSelectionDigest: string;
  registryDigest: string;
} {
  return {
    requirementSetDigest: indexerProtocolDigest(requirementSetFromRegistry(registry)),
    indexerSelectionDigest: indexerProtocolDigest({
      protocol: "context.indexer.selection/v1",
      indexers: registry.indexers,
    }),
    registryDigest: indexerProtocolDigest(registry),
  };
}

function encodeOwnerPart(value: string): string {
  return encodeURIComponent(value)
    .replaceAll("~", "%7E")
    .replaceAll("%", "~");
}

export function canonicalOwnerCellRef(input: {
  requirementRef: string;
  coverageDomain: string;
  sourceRef: string;
  moduleRef: string | null;
}): string {
  return [
    "owner-cell:",
    encodeOwnerPart(input.requirementRef),
    "/",
    encodeOwnerPart(input.coverageDomain),
    "/",
    encodeOwnerPart(input.sourceRef),
    "/",
    input.moduleRef === null ? "~" : encodeOwnerPart(input.moduleRef),
  ].join("");
}

function bindingTargets(
  requirement: IndexRequirement,
  binding: IndexerRegistryEntry["requirement_bindings"][number],
): readonly IndexerScopeTarget[] {
  return "ref" in binding.owned_scope
    ? requirement.target_scope.targets
    : binding.owned_scope.targets;
}

function primaryOwnerCounts(registry: IndexerRegistry): Map<string, string[]> {
  const requirements = new Map(
    registry.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const owners = new Map<string, string[]>();
  for (const indexer of registry.indexers) {
    for (const binding of indexer.requirement_bindings) {
      if (binding.role !== "primary") continue;
      const requirement = requirements.get(binding.requirement_ref)!;
      for (const domain of binding.coverage_domains) {
        for (const target of bindingTargets(requirement, binding)) {
          const modules = target.module_refs.length === 0 ? [null] : target.module_refs;
          for (const moduleRef of modules) {
            const ref = canonicalOwnerCellRef({
              requirementRef: requirement.id,
              coverageDomain: domain,
              sourceRef: target.source_ref,
              moduleRef,
            });
            owners.set(ref, [...(owners.get(ref) ?? []), indexer.id]);
          }
        }
      }
    }
  }
  return owners;
}

export function validateFinalizedIndexerRegistry(registry: IndexerRegistry): void {
  validateIndexerReferences(registry);
  const owners = primaryOwnerCounts(registry);
  for (const [ownerRef, indexers] of owners) {
    if (indexers.length > 1) {
      throw new TypeError(
        `Indexer primary ownership is ambiguous for ${ownerRef}: ${indexers.join(", ")}`,
      );
    }
  }
  for (const requirement of registry.requirements) {
    for (const [domain, coverage] of Object.entries(requirement.coverage_domains)) {
      if (coverage !== "required") continue;
      for (const target of requirement.target_scope.targets) {
        const modules = target.module_refs.length === 0 ? [null] : target.module_refs;
        for (const moduleRef of modules) {
          const ref = canonicalOwnerCellRef({
            requirementRef: requirement.id,
            coverageDomain: domain,
            sourceRef: target.source_ref,
            moduleRef,
          });
          if ((owners.get(ref)?.length ?? 0) !== 1) {
            throw new TypeError(`Required owner cell has no primary Indexer: ${ref}`);
          }
        }
      }
    }
  }
}

export async function loadIndexerRegistry(rootDir: string): Promise<LoadedIndexerRegistry> {
  const resolvedRoot = await realpath(resolve(rootDir));
  const absolutePath = resolve(resolvedRoot, DEFAULT_INDEXER_REGISTRY_PATH);
  const resolvedRegistryPath = await realpath(absolutePath);
  const registryRelativePath = relative(resolvedRoot, resolvedRegistryPath);
  if (registryRelativePath.startsWith("..") || isAbsolute(registryRelativePath)) {
    throw new TypeError(`${DEFAULT_INDEXER_REGISTRY_PATH} must stay inside the Context workspace`);
  }
  const registry = parseIndexerRegistry(
    await readFile(resolvedRegistryPath, "utf8"),
    absolutePath,
  );
  const digests = indexerRegistryDigests(registry);
  return {
    path: DEFAULT_INDEXER_REGISTRY_PATH,
    absolutePath,
    registry,
    requirementSet: requirementSetFromRegistry(registry),
    ...digests,
  };
}
