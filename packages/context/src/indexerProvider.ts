import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import {
  INDEXER_EVIDENCE_KINDS,
  INDEXER_LAYER_FRAGMENT_KINDS,
  INDEXER_PROGRAM_CAPABILITIES,
  INDEXER_PROVIDER_MANIFEST_NAME,
  addDuplicateIssues,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolIdSchema,
  indexerSemverSchema,
  indexerSnakeCaseIdSchema,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import { indexerSubjectKeyContractSchema } from "./indexerProfileContract.js";

const executionArgumentSchema = z.string().superRefine((value, context) => {
  if (
    value.length > 1024 ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes("$") ||
    value.includes("`") ||
    /[|&;<>()[\]{}*?!~]/u.test(value)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "must be a bounded literal argument without shell syntax or interpolation",
    });
  }
});

export const indexerExecutionSchema = z.object({
  runtime: z.literal("node"),
  entry: portableIndexerPathSchema,
  args: z.array(executionArgumentSchema),
}).strict();

const activationSignalSchema = z.object({
  id: indexerIdSchema,
  description: z.string().min(1),
}).strict();

const activationProbeSchema = z.object({
  execution: indexerExecutionSchema,
  protocol: z.literal("context.indexer.activation/v1"),
  capabilities: z.tuple([z.literal("parser-facts.read")]),
  optional: z.boolean(),
}).strict();

const activationSchema = z.object({
  target_kinds: z.array(indexerIdSchema).min(1),
  required_signals: z.array(activationSignalSchema).min(1),
  supporting_signals: z.array(activationSignalSchema),
  negative_signals: z.array(activationSignalSchema),
  agent_questions: z.array(z.string().min(1)).optional(),
  detector: activationProbeSchema.optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.target_kinds, context, "target_kinds");
  addDuplicateIssues(value.agent_questions ?? [], context, "agent_questions");
  const signals = [
    ...value.required_signals,
    ...value.supporting_signals,
    ...value.negative_signals,
  ];
  addDuplicateIssues(signals.map((signal) => signal.id), context, "activation signals");
});

const preAuthorityFragmentKindSchema = z.enum([
  "fact-enrichment",
  "template-variables",
]);

const mainIndexOperationSchema = z.object({
  id: z.literal("main-index"),
  consumes: z.literal("context.indexer.main-workset/v1"),
  produces: z.literal("context.indexer.main-result/v1"),
  accepts_layer_fragments: z.array(preAuthorityFragmentKindSchema).optional(),
}).strict();

const materialAnswerOperationSchema = z.object({
  id: z.literal("material-answer"),
  consumes: z.literal("context.indexer.material-question-workset/v1"),
  produces: z.literal("context.indexer.material-answer-result/v1"),
  supported_evidence_kinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)).min(1),
  accepts_layer_fragments: z.array(preAuthorityFragmentKindSchema).optional(),
}).strict();

export const indexerProviderOperationSchema = z.discriminatedUnion("id", [
  mainIndexOperationSchema,
  materialAnswerOperationSchema,
]);

const factEnrichmentFragmentSchema = z.object({
  kind: z.literal("fact-enrichment"),
  phase: z.literal("pre-authority"),
  produces: z.literal("context.indexer.layer-fragment/v1"),
}).strict();

const templateVariablesFragmentSchema = z.object({
  kind: z.literal("template-variables"),
  phase: z.literal("pre-authority"),
  produces: z.literal("context.indexer.layer-fragment/v1"),
}).strict();

const derivedArtifactFragmentSchema = z.object({
  kind: z.literal("derived-artifact-proposal"),
  phase: z.literal("post-author"),
  produces: z.literal("context.indexer.layer-fragment/v1"),
}).strict();

export const indexerProviderLayerFragmentSchema = z.discriminatedUnion("kind", [
  factEnrichmentFragmentSchema,
  templateVariablesFragmentSchema,
  derivedArtifactFragmentSchema,
]);

export const indexerComposerContractSchema = z.object({
  instruction: portableIndexerPathSchema,
  primary_requirements: z.object({
    fact_kinds: z.array(indexerIdSchema).min(1),
    artifact_kinds: z.array(indexerIdSchema).min(1),
  }).strict(),
  derived_artifact_policy: z.object({
    fragment_protocol: z.literal("context.indexer.layer-fragment/v1"),
    fragment_kind: z.literal("derived-artifact-proposal"),
    artifact_policy_variant: indexerIdSchema,
    artifact_kinds: z.array(indexerIdSchema).min(1),
  }).strict(),
  empty_result: z.object({
    result_protocol: z.literal("context.indexer.layer-fragment-result/v1"),
    behavior: z.literal("empty-fragment-set"),
  }).strict(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.primary_requirements.fact_kinds,
    context,
    "composer primary fact kinds",
  );
  addDuplicateIssues(
    value.primary_requirements.artifact_kinds,
    context,
    "composer primary Artifact kinds",
  );
  addDuplicateIssues(
    value.derived_artifact_policy.artifact_kinds,
    context,
    "composer derived Artifact kinds",
  );
});

export const indexerComposerDeclarationSchema = z.object({
  id: indexerIdSchema,
  supported_profiles: z.array(indexerIdSchema).min(1),
  contract: indexerComposerContractSchema.optional(),
}).strict();

export type IndexerComposerContract = z.infer<typeof indexerComposerContractSchema>;
export type IndexerComposerDeclaration = z.infer<typeof indexerComposerDeclarationSchema>;

export const indexerToolSourceDeclarationSchema = z.object({
  id: indexerIdSchema,
  handler: indexerProtocolIdSchema,
  request: indexerProtocolIdSchema,
  produces: z.literal("context.indexer.tool-snapshot/v1"),
  operations: z.array(indexerIdSchema).min(1),
  optional: z.literal(true),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.operations, context, "tool source operations");
});

export type IndexerToolSourceDeclaration = z.infer<
  typeof indexerToolSourceDeclarationSchema
>;

const logicalUnitSchema = z.object({
  id: indexerIdSchema,
  identity: indexerIdSchema,
  artifacts: z.object({
    recommended: z.array(indexerIdSchema).min(1),
    supported_policy_variants: z.array(indexerIdSchema).min(1),
  }).strict().optional(),
}).strict();

export const indexerPartitionStrategyDeclarationSchema = z.object({
  id: indexerIdSchema,
  profiles: z.array(indexerIdSchema).min(1),
  priority: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.profiles, context, "partition strategy profiles");
});

const contractOverlayResourceSchema = z.object({
  id: indexerIdSchema,
  protocol: z.literal("context.indexer.contract-overlay/v1"),
  extends: z.object({
    profile: indexerIdSchema,
    version: indexerSemverSchema,
  }).strict(),
  resource: portableIndexerPathSchema,
  integrity: indexerDigestSchema,
}).strict();

const providesSchema = z.object({
  profiles: z.array(indexerIdSchema).min(1),
  operations: z.array(indexerProviderOperationSchema).min(1),
  layer_fragments: z.array(indexerProviderLayerFragmentSchema).optional(),
  composers: z.array(indexerComposerDeclarationSchema).optional(),
  source_roles: z.array(indexerIdSchema).optional(),
  tool_sources: z.array(indexerToolSourceDeclarationSchema).optional(),
  logical_units: z.array(logicalUnitSchema).optional(),
  partition_strategies: z.array(indexerPartitionStrategyDeclarationSchema).optional(),
  contract_overlays: z.array(contractOverlayResourceSchema).optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.profiles, context, "profiles");
  addDuplicateIssues(value.operations.map((operation) => operation.id), context, "operations");
  addDuplicateIssues(
    (value.layer_fragments ?? []).map((fragment) => fragment.kind),
    context,
    "layer_fragments",
  );
  addDuplicateIssues((value.composers ?? []).map((composer) => composer.id), context, "composers");
  addDuplicateIssues(value.source_roles ?? [], context, "source_roles");
  addDuplicateIssues(
    (value.tool_sources ?? []).map((toolSource) => toolSource.id),
    context,
    "tool_sources",
  );
  addDuplicateIssues(
    (value.logical_units ?? []).map((logicalUnit) => logicalUnit.id),
    context,
    "logical_units",
  );
  addDuplicateIssues(
    (value.partition_strategies ?? []).map((strategy) => strategy.id),
    context,
    "partition_strategies",
  );
  addDuplicateIssues(
    (value.contract_overlays ?? []).map((overlay) => overlay.id),
    context,
    "contract_overlays",
  );
  value.operations.forEach((operation, index) => {
    addDuplicateIssues(
      operation.accepts_layer_fragments ?? [],
      context,
      `operations.${index}.accepts_layer_fragments`,
    );
    if (operation.id === "material-answer") {
      addDuplicateIssues(
        operation.supported_evidence_kinds,
        context,
        `operations.${index}.supported_evidence_kinds`,
      );
    }
  });
  (value.composers ?? []).forEach((composer, index) => {
    addDuplicateIssues(
      composer.supported_profiles,
      context,
      `composers.${index}.supported_profiles`,
    );
  });
});

const indexerProgramSchema = z.object({
  execution: indexerExecutionSchema,
  protocol: z.literal("context.indexer.program/v1"),
  capabilities: z.array(z.enum(INDEXER_PROGRAM_CAPABILITIES)).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.capabilities, context, "capabilities");
});

const instructionResourceSchema = z.object({
  path: portableIndexerPathSchema,
  profiles: z.array(indexerIdSchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.profiles, context, "profiles");
});

const templateResourceSchema = z.object({
  id: indexerIdSchema,
  profile: indexerIdSchema,
  path: portableIndexerPathSchema,
}).strict();

const providerResourcesSchema = z.object({
  program: indexerProgramSchema.optional(),
  instructions: z.array(instructionResourceSchema).optional(),
  templates: z.array(templateResourceSchema).optional(),
  config_schema: portableIndexerPathSchema.optional(),
  forbidden_fallbacks: z.array(indexerIdSchema).optional(),
  completion_checks: z.array(indexerIdSchema).optional(),
}).strict().superRefine((value, context) => {
  if (
    value.program === undefined &&
    (value.instructions?.length ?? 0) === 0 &&
    (value.templates?.length ?? 0) === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "provider must declare a program, instructions, or templates",
    });
  }
  addDuplicateIssues(
    (value.templates ?? []).map((template) => `${template.profile}:${template.id}`),
    context,
    "templates",
  );
  addDuplicateIssues(value.forbidden_fallbacks ?? [], context, "forbidden_fallbacks");
  addDuplicateIssues(value.completion_checks ?? [], context, "completion_checks");
});

const customizationSchema = z.object({
  supports: z.array(z.enum([
    "config",
    "instructions-append",
    "template-override",
    "program-extend",
  ])).min(1),
  guide: portableIndexerPathSchema.optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.supports, context, "supports");
});

const qualityGuidanceSchema = z.object({
  metric_ids: z.array(indexerIdSchema).min(1),
  repair: portableIndexerPathSchema.optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.metric_ids, context, "metric_ids");
});

const variantAxisSchema = z.object({
  id: indexerSnakeCaseIdSchema,
  type: z.literal("enum"),
  values: z.array(indexerIdSchema).min(1),
  required: z.boolean(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.values, context, "values");
});

const variantSchema = z.object({
  axes: z.array(variantAxisSchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.axes.map((axis) => axis.id), context, "axes");
});

const compositionSchema = z.object({
  extensions: z.array(z.object({
    profile: indexerIdSchema,
    extends: indexerIdSchema,
    variant_schema: variantSchema.optional(),
    subject_key_schema: indexerSubjectKeyContractSchema,
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.extensions.map((extension) => extension.profile),
    context,
    "extensions",
  );
});

const authoringInspectorSchema = z.object({
  execution: indexerExecutionSchema,
  protocol: z.literal("context.indexer.inspector/v1"),
  capabilities: z.array(z.enum(["parser-facts.read", "source.read"])).min(1),
  output: z.literal("provider-enrichment-facts"),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.capabilities, context, "capabilities");
  if (!value.capabilities.includes("parser-facts.read")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "authoring inspector must request parser-facts.read",
      path: ["capabilities"],
    });
  }
});

export const indexerProviderManifestSchema = z.object({
  protocol: z.literal("context.indexer.provider/v1"),
  id: indexerIdSchema,
  version: indexerSemverSchema,
  domains: z.array(indexerIdSchema).min(1),
  activation: activationSchema,
  provides: providesSchema,
  authoring_inspector: authoringInspectorSchema.optional(),
  provider: providerResourcesSchema,
  customization: customizationSchema.optional(),
  quality_guidance: qualityGuidanceSchema.optional(),
  composition: compositionSchema.optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.domains, context, "domains");
  const profiles = new Set(value.provides.profiles);
  (value.provider.instructions ?? []).forEach((instruction, index) => {
    instruction.profiles.forEach((profile) => {
      if (!profiles.has(profile)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `instruction references undeclared profile ${profile}`,
          path: ["provider", "instructions", index, "profiles"],
        });
      }
    });
  });
  (value.provider.templates ?? []).forEach((template, index) => {
    if (!profiles.has(template.profile)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `template references undeclared profile ${template.profile}`,
        path: ["provider", "templates", index, "profile"],
      });
    }
  });
  (value.provides.partition_strategies ?? []).forEach((strategy, index) => {
    strategy.profiles.forEach((profile) => {
      if (!profiles.has(profile)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `partition strategy references undeclared profile ${profile}`,
          path: ["provides", "partition_strategies", index, "profiles"],
        });
      }
    });
  });
  (value.provides.composers ?? []).forEach((composer, index) => {
    if (
      composer.contract !== undefined &&
      !(value.provides.layer_fragments ?? []).some((fragment) =>
        fragment.kind === "derived-artifact-proposal" && fragment.phase === "post-author"
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `composer ${composer.id} contract requires a post-author derived-artifact-proposal capability`,
        path: ["provides", "composers", index, "contract"],
      });
    }
  });
  for (const profile of profiles) {
    const priorities = (value.provides.partition_strategies ?? [])
      .filter((strategy) => strategy.profiles.includes(profile))
      .map((strategy) => strategy.priority);
    if (new Set(priorities).size !== priorities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `partition strategy priorities must be unique for profile ${profile}`,
        path: ["provides", "partition_strategies"],
      });
    }
  }
  const extensions = value.composition?.extensions ?? [];
  const extensionProfiles = new Set(extensions.map((extension) => extension.profile));
  extensions.forEach((extension, index) => {
    if (!extension.profile.includes("/")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "extension profile must be namespaced",
        path: ["composition", "extensions", index, "profile"],
      });
    }
    if (!profiles.has(extension.profile)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `extension profile ${extension.profile} is not declared by provides.profiles`,
        path: ["composition", "extensions", index, "profile"],
      });
    }
  });
  value.provides.profiles.filter((profile) => profile.includes("/")).forEach((profile) => {
    if (!extensionProfiles.has(profile)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `namespaced profile ${profile} requires one composition extension`,
        path: ["composition", "extensions"],
      });
    }
  });
});

export type IndexerExecution = z.infer<typeof indexerExecutionSchema>;
export type IndexerProviderOperation = z.infer<typeof indexerProviderOperationSchema>;
export type IndexerProviderLayerFragment = z.infer<typeof indexerProviderLayerFragmentSchema>;
export type IndexerProviderManifest = z.infer<typeof indexerProviderManifestSchema>;

function parseYamlDocument(source: string, label: string): unknown {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new TypeError(
      `${label} is not valid YAML: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return document.toJS();
}

export function parseIndexerProviderManifest(
  source: string,
  label = INDEXER_PROVIDER_MANIFEST_NAME,
): IndexerProviderManifest {
  const parsed = indexerProviderManifestSchema.safeParse(parseYamlDocument(source, label));
  if (!parsed.success) {
    throw new TypeError(
      `${label} does not satisfy context.indexer.provider/v1: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

function referencedProviderPaths(manifest: IndexerProviderManifest): string[] {
  return [
    ...(manifest.activation.detector === undefined
      ? []
      : [manifest.activation.detector.execution.entry]),
    ...(manifest.authoring_inspector === undefined
      ? []
      : [manifest.authoring_inspector.execution.entry]),
    ...(manifest.provider.program === undefined
      ? []
      : [manifest.provider.program.execution.entry]),
    ...(manifest.provider.instructions ?? []).map((item) => item.path),
    ...(manifest.provider.templates ?? []).map((item) => item.path),
    ...(manifest.provides.composers ?? []).flatMap((item) =>
      item.contract === undefined ? [] : [item.contract.instruction]
    ),
    ...(manifest.provider.config_schema === undefined
      ? []
      : [manifest.provider.config_schema]),
    ...(manifest.customization?.guide === undefined
      ? []
      : [manifest.customization.guide]),
    ...(manifest.quality_guidance?.repair === undefined
      ? []
      : [manifest.quality_guidance.repair]),
    ...(manifest.provides.contract_overlays ?? []).map((overlay) => overlay.resource),
  ];
}

async function assertBundleFile(bundleRoot: string, path: string): Promise<void> {
  const candidate = resolve(bundleRoot, path);
  const resolvedPath = await realpath(candidate).catch(() => undefined);
  if (resolvedPath === undefined) {
    throw new TypeError(`Provider Bundle resource is unavailable: ${path}`);
  }
  const relativePath = relative(bundleRoot, resolvedPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new TypeError(`Provider Bundle resource escapes the Bundle root: ${path}`);
  }
  if (!(await stat(resolvedPath)).isFile()) {
    throw new TypeError(`Provider Bundle resource must be a file: ${path}`);
  }
}

export async function loadIndexerProviderManifest(
  bundleRoot: string,
): Promise<IndexerProviderManifest> {
  const resolvedRoot = await realpath(resolve(bundleRoot));
  const manifestPath = resolve(resolvedRoot, INDEXER_PROVIDER_MANIFEST_NAME);
  await assertBundleFile(resolvedRoot, INDEXER_PROVIDER_MANIFEST_NAME);
  const manifest = parseIndexerProviderManifest(
    await readFile(manifestPath, "utf8"),
    manifestPath,
  );
  await Promise.all(
    [...new Set(referencedProviderPaths(manifest))].map((path) =>
      assertBundleFile(resolvedRoot, path)
    ),
  );
  return manifest;
}

export function isIndexerProviderProtocol(value: string): boolean {
  return indexerProtocolIdSchema.safeParse(value).success;
}

export function isIndexerLayerFragmentKind(value: string): boolean {
  return (INDEXER_LAYER_FRAGMENT_KINDS as readonly string[]).includes(value);
}
