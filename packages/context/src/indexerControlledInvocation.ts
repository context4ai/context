import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  indexerExecutionSchema,
  indexerProviderManifestSchema,
  type IndexerExecution,
  type IndexerProviderManifest,
} from "./indexerProvider.js";
import {
  indexerProgramCapabilitySetDigest,
  indexerProgramExecutionDigest,
  indexerProgramIdentityDigest,
  indexerRequestedProgramPolicyDigest,
  resolvedProviderBundleSchema,
  resolvedProviderStableFingerprint,
  validateIndexerProgramAuthorization,
  type IndexerProgramAuthorization,
  type ResolvedProviderBundle,
} from "./indexerProviderResolution.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
} from "./indexerProtocolCommon.js";

const packageCoordinateSchema = z.string().regex(
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u,
);
const lockIntegritySchema = z.string().regex(
  /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/u,
);

const fixedDependencySchema = z.object({
  package: packageCoordinateSchema,
  version: indexerSemverSchema,
  lock_integrity: lockIntegritySchema,
  resolved_digest: indexerDigestSchema,
}).strict();

export const indexerFixedDependencySetSchema = z.object({
  protocol: z.literal("context.indexer.fixed-dependency-set/v1"),
  dependencies: z.array(fixedDependencySchema),
  dependency_set_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.dependencies.map((dependency) => dependency.package), context, "dependencies");
});

export type IndexerFixedDependencySet = z.infer<typeof indexerFixedDependencySetSchema>;

const sourceScopeSchema = z.object({
  source_ref: indexerCanonicalRefSchema,
  module_refs: z.array(indexerCanonicalRefSchema),
  scope_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.module_refs, context, "module_refs");
});

const executionLimitsSchema = z.object({
  timeout_ms: z.number().int().min(100).max(300_000),
  max_stdin_bytes: z.number().int().positive().max(64 * 1024 * 1024),
  max_stdout_bytes: z.number().int().positive().max(64 * 1024 * 1024),
  max_stderr_bytes: z.number().int().positive().max(4 * 1024 * 1024),
}).strict();

export type IndexerExecutionLimits = z.infer<typeof executionLimitsSchema>;

const invocationProviderSchema = z.object({
  indexer_id: indexerIdSchema,
  provider_id: indexerIdSchema,
  skill: indexerIdSchema,
  version: indexerSemverSchema,
  bundle_integrity: indexerDigestSchema,
  manifest_digest: indexerDigestSchema,
  provider_fingerprint: indexerDigestSchema,
}).strict();

const invocationAuthorizationSchema = z.object({
  level: z.literal("trusted-program"),
  sandboxed_program: z.literal(false),
  trust_basis: z.enum([
    "first-party",
    "verified",
    "project-authorized-exact-digest",
  ]),
  authority_digest: indexerDigestSchema,
  policy_digest: indexerDigestSchema,
}).strict();

const invocationResourceSchema = z.enum([
  "program",
  "activation-detector",
  "authoring-inspector",
]);

const invocationProgramSchema = z.object({
  origin: z.enum(["provider-bundle", "project-local"]),
  path: z.string().min(1),
  content_digest: indexerDigestSchema,
  program_digest: indexerDigestSchema,
}).strict();

export const indexerControlledInvocationSchema = z.object({
  protocol: z.literal("context.indexer.controlled-invocation/v1"),
  resource: invocationResourceSchema,
  program: invocationProgramSchema.nullable(),
  provider: invocationProviderSchema,
  execution: indexerExecutionSchema,
  capabilities: z.array(z.enum([
    "source.read",
    "parser-facts.read",
    "indexer-result.write",
  ])).min(1),
  dependencies: indexerFixedDependencySetSchema,
  authorized_scope: sourceScopeSchema,
  authorization: invocationAuthorizationSchema,
  environment: z.literal("empty"),
  shell: z.literal(false),
  limits: executionLimitsSchema,
  invocation_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.capabilities, context, "capabilities");
});

export type IndexerControlledInvocation = z.infer<typeof indexerControlledInvocationSchema>;

export function assertIndexerCanonicalOrder(
  values: readonly string[],
  field: string,
): void {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (values.some((value, index) => value !== sorted[index])) {
    throw new TypeError(`${field} must use canonical order`);
  }
}

export function buildIndexerFixedDependencySet(
  dependencies: readonly z.input<typeof fixedDependencySchema>[],
): IndexerFixedDependencySet {
  const parsed = dependencies.map((dependency) => fixedDependencySchema.parse(dependency))
    .sort((left, right) => compareIndexerCanonicalText(left.package, right.package));
  if (new Set(parsed.map((dependency) => dependency.package)).size !== parsed.length) {
    throw new TypeError("fixed dependencies must contain one exact version per package");
  }
  const base = {
    protocol: "context.indexer.fixed-dependency-set/v1" as const,
    dependencies: parsed,
  };
  return indexerFixedDependencySetSchema.parse({
    ...base,
    dependency_set_digest: indexerProtocolDigest(base),
  });
}

export function validateIndexerFixedDependencySet(value: unknown): IndexerFixedDependencySet {
  const dependencies = indexerFixedDependencySetSchema.parse(value);
  const rebuilt = buildIndexerFixedDependencySet(dependencies.dependencies);
  if (rebuilt.dependency_set_digest !== dependencies.dependency_set_digest) {
    throw new TypeError("fixed dependency set digest is invalid");
  }
  assertIndexerCanonicalOrder(
    dependencies.dependencies.map((dependency) => dependency.package),
    "dependencies",
  );
  return dependencies;
}

function buildSourceScope(input: {
  source_ref: string;
  module_refs: readonly string[];
}): z.infer<typeof sourceScopeSchema> {
  const moduleRefs = [...input.module_refs].sort(compareIndexerCanonicalText);
  const base = { source_ref: input.source_ref, module_refs: moduleRefs };
  return sourceScopeSchema.parse({ ...base, scope_digest: indexerProtocolDigest(base) });
}

function invocationPayload(
  value: IndexerControlledInvocation,
): Omit<IndexerControlledInvocation, "invocation_digest"> {
  return {
    protocol: value.protocol,
    resource: value.resource,
    program: value.program,
    provider: value.provider,
    execution: value.execution,
    capabilities: value.capabilities,
    dependencies: value.dependencies,
    authorized_scope: value.authorized_scope,
    authorization: value.authorization,
    environment: value.environment,
    shell: value.shell,
    limits: value.limits,
  };
}

function controlledPolicyDigest(invocation: IndexerControlledInvocation): string {
  const policy = invocation.authorization;
  return indexerProtocolDigest({
    protocol: "context.indexer.controlled-policy/v1",
    level: policy.level,
    sandboxed_program: policy.sandboxed_program,
    trust_basis: policy.trust_basis,
    authority_digest: policy.authority_digest,
    resource: invocation.resource,
    program_digest: invocation.program?.program_digest ?? null,
    capabilities: invocation.capabilities,
    dependency_set_digest: invocation.dependencies.dependency_set_digest,
    scope_digest: invocation.authorized_scope.scope_digest,
    environment: invocation.environment,
    shell: invocation.shell,
    limits: invocation.limits,
  });
}

function exactProvider(input: {
  manifest: IndexerProviderManifest;
  bundle: ResolvedProviderBundle;
}): IndexerControlledInvocation["provider"] {
  const manifest = indexerProviderManifestSchema.parse(input.manifest);
  const bundle = resolvedProviderBundleSchema.parse(input.bundle);
  if (manifest.id !== bundle.request.skill || manifest.version !== bundle.request.version) {
    throw new TypeError("controlled invocation manifest does not match its resolved Provider");
  }
  if (bundle.resolved.manifest_digest !== bundle.files.find(
    (file) => file.path === "context-indexer.yaml",
  )?.digest) {
    throw new TypeError("controlled invocation has an invalid Provider manifest digest");
  }
  return {
    indexer_id: bundle.request.indexer_id,
    provider_id: bundle.request.provider_id,
    skill: bundle.request.skill,
    version: bundle.request.version,
    bundle_integrity: bundle.resolved.integrity,
    manifest_digest: bundle.resolved.manifest_digest,
    provider_fingerprint: resolvedProviderStableFingerprint(bundle),
  };
}

function controlledProgramIdentity(input: {
  bundle: ResolvedProviderBundle;
  execution: IndexerExecution;
  local_program?: {
    path: string;
    content_digest: string;
  };
}): NonNullable<IndexerControlledInvocation["program"]> {
  const origin = input.local_program === undefined ? "provider-bundle" : "project-local";
  const path = input.local_program?.path ?? input.execution.entry;
  if (path !== input.execution.entry) {
    throw new TypeError("controlled invocation execution must use its authorized program path");
  }
  const contentDigest = input.local_program?.content_digest ?? input.bundle.files.find(
    (file) => file.path === path,
  )?.digest;
  if (contentDigest === undefined) {
    throw new TypeError("controlled invocation program is absent from the Provider Bundle");
  }
  return invocationProgramSchema.parse({
    origin,
    path,
    content_digest: contentDigest,
    program_digest: indexerProgramIdentityDigest({
      origin,
      path,
      content_digest: contentDigest,
      provider_integrity: input.bundle.resolved.integrity,
      execution_digest: indexerProgramExecutionDigest(input.execution),
    }),
  });
}

function trustAuthorization(input: {
  bundle: ResolvedProviderBundle;
  project_ref: string;
  project_authorization?: IndexerProgramAuthorization;
  resource: IndexerControlledInvocation["resource"];
  execution: IndexerExecution;
  program: IndexerControlledInvocation["program"];
  capabilities: readonly string[];
  dependencies: IndexerFixedDependencySet;
  scope_digest: string;
  limits: IndexerExecutionLimits;
}): IndexerControlledInvocation["authorization"] {
  const bundle = resolvedProviderBundleSchema.parse(input.bundle);
  const trust = bundle.resolved.trust;
  let trustBasis: IndexerControlledInvocation["authorization"]["trust_basis"];
  let authorityDigest: string;
  if (
    (trust === "first-party" || trust === "verified") &&
    input.program?.origin !== "project-local"
  ) {
    trustBasis = trust;
    authorityDigest = indexerProtocolDigest({
      issuer: bundle.resolved.issuer,
      trust,
      authority_ref: bundle.receipt.authority_ref,
    });
  } else {
    const authorization = input.project_authorization === undefined
      ? undefined
      : validateIndexerProgramAuthorization(input.project_authorization);
    const executionDigest = indexerProgramExecutionDigest(input.execution);
    const capabilitySetDigest = indexerProgramCapabilitySetDigest(input.capabilities);
    if (
      authorization === undefined ||
      input.resource !== "program" ||
      authorization.project_ref !== input.project_ref ||
      authorization.provider_integrity !== bundle.resolved.integrity ||
      authorization.provider_fingerprint !== resolvedProviderStableFingerprint(bundle) ||
      authorization.manifest_digest !== bundle.resolved.manifest_digest ||
      authorization.resource !== "program" ||
      input.program === null ||
      authorization.program_origin !== input.program.origin ||
      authorization.program_digest !== input.program.program_digest ||
      authorization.execution_digest !== executionDigest ||
      authorization.capability_set_digest !== capabilitySetDigest ||
      authorization.dependency_set_digest !== input.dependencies.dependency_set_digest ||
      authorization.scope_digest !== input.scope_digest ||
      authorization.execution_policy_digest !== indexerRequestedProgramPolicyDigest({
        execution_digest: executionDigest,
        capability_set_digest: capabilitySetDigest,
        dependency_set_digest: input.dependencies.dependency_set_digest,
        scope_digest: input.scope_digest,
        limits: input.limits,
      }) ||
      authorization.sandboxed_program !== false
    ) {
      throw new TypeError("untrusted controlled invocation has no exact project authorization");
    }
    trustBasis = "project-authorized-exact-digest";
    authorityDigest = indexerProtocolDigest(authorization);
  }
  const policy = {
    level: "trusted-program" as const,
    sandboxed_program: false as const,
    trust_basis: trustBasis,
    authority_digest: authorityDigest,
  };
  return {
    ...policy,
    policy_digest: indexerProtocolDigest({
      protocol: "context.indexer.controlled-policy/v1",
      ...policy,
      resource: input.resource,
      program_digest: input.program?.program_digest ?? null,
      capabilities: input.capabilities,
      dependency_set_digest: input.dependencies.dependency_set_digest,
      scope_digest: input.scope_digest,
      environment: "empty",
      shell: false,
      limits: input.limits,
    }),
  };
}

export function buildIndexerControlledInvocation(input: {
  resource: IndexerControlledInvocation["resource"];
  manifest: IndexerProviderManifest;
  bundle: ResolvedProviderBundle;
  execution: IndexerExecution;
  capabilities: readonly IndexerControlledInvocation["capabilities"][number][];
  dependencies: IndexerFixedDependencySet;
  scope: { source_ref: string; module_refs: readonly string[] };
  limits: IndexerExecutionLimits;
  project_ref: string;
  project_authorization?: IndexerProgramAuthorization;
  local_program?: {
    path: string;
    content_digest: string;
  };
}): IndexerControlledInvocation {
  const scope = buildSourceScope(input.scope);
  const dependencies = validateIndexerFixedDependencySet(input.dependencies);
  const capabilities = [...input.capabilities].sort(compareIndexerCanonicalText);
  const execution = indexerExecutionSchema.parse(input.execution);
  const program = input.resource === "program"
    ? controlledProgramIdentity({
      bundle: input.bundle,
      execution,
      ...(input.local_program === undefined ? {} : { local_program: input.local_program }),
    })
    : null;
  const base: Omit<IndexerControlledInvocation, "invocation_digest"> = {
    protocol: "context.indexer.controlled-invocation/v1",
    resource: input.resource,
    program,
    provider: exactProvider(input),
    execution,
    capabilities,
    dependencies,
    authorized_scope: scope,
    authorization: trustAuthorization({
      bundle: input.bundle,
      project_ref: input.project_ref,
      ...(input.project_authorization === undefined
        ? {}
        : { project_authorization: input.project_authorization }),
      resource: input.resource,
      execution,
      program,
      capabilities,
      dependencies,
      scope_digest: scope.scope_digest,
      limits: input.limits,
    }),
    environment: "empty",
    shell: false,
    limits: executionLimitsSchema.parse(input.limits),
  };
  return indexerControlledInvocationSchema.parse({
    ...base,
    invocation_digest: indexerProtocolDigest(base),
  });
}

export function validateIndexerControlledInvocation(
  value: unknown,
): IndexerControlledInvocation {
  const invocation = indexerControlledInvocationSchema.parse(value);
  if ((invocation.resource === "program") !== (invocation.program !== null)) {
    throw new TypeError("controlled invocation program identity does not match its resource");
  }
  if (invocation.program !== null) {
    if (invocation.program.path !== invocation.execution.entry) {
      throw new TypeError("controlled invocation execution does not match its program identity");
    }
    if (
      invocation.program.origin === "project-local" &&
      !/^src\/indexer\/[a-z0-9][a-z0-9._-]*\/index\.ts$/u.test(invocation.program.path)
    ) {
      throw new TypeError("controlled invocation project-local program path is invalid");
    }
    const programDigest = indexerProgramIdentityDigest({
      origin: invocation.program.origin,
      path: invocation.program.path,
      content_digest: invocation.program.content_digest,
      provider_integrity: invocation.provider.bundle_integrity,
      execution_digest: indexerProgramExecutionDigest(invocation.execution),
    });
    if (programDigest !== invocation.program.program_digest) {
      throw new TypeError("controlled invocation program identity digest is invalid");
    }
  }
  validateIndexerFixedDependencySet(invocation.dependencies);
  assertIndexerCanonicalOrder(invocation.capabilities, "capabilities");
  assertIndexerCanonicalOrder(
    invocation.authorized_scope.module_refs,
    "authorized_scope.module_refs",
  );
  const scope = buildSourceScope(invocation.authorized_scope);
  if (scope.scope_digest !== invocation.authorized_scope.scope_digest) {
    throw new TypeError("controlled invocation authorized scope digest is invalid");
  }
  if (controlledPolicyDigest(invocation) !== invocation.authorization.policy_digest) {
    throw new TypeError("controlled invocation execution policy digest is invalid");
  }
  if (indexerProtocolDigest(invocationPayload(invocation)) !== invocation.invocation_digest) {
    throw new TypeError("controlled invocation digest is invalid");
  }
  return invocation;
}
