import { isAbsolute } from "node:path";
import { z } from "zod";
import type { IndexerExecution, IndexerProviderManifest } from "./indexerProvider.js";
import {
  compareIndexerCanonicalText,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";
import {
  indexerDistributionSchema,
  type IndexerDistribution,
} from "./indexerRegistry.js";

export const providerResolutionRequestSchema = z.object({
  indexer_id: indexerIdSchema,
  provider_id: indexerIdSchema,
  skill: indexerIdSchema,
  version: indexerSemverSchema,
  distribution: indexerDistributionSchema,
}).strict();

const resolvedBundleFileSchema = z.object({
  path: portableIndexerPathSchema,
  digest: indexerDigestSchema,
}).strict();

const absoluteTransportPathSchema = z.string().superRefine((value, context) => {
  if (!isAbsolute(value) || value.includes("\0")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "transport path must be an absolute runtime-only path",
    });
  }
});

export const resolvedProviderBundleSchema = z.object({
  protocol: z.literal("context.indexer.resolved-provider-bundle/v1"),
  request: providerResolutionRequestSchema,
  resolved: z.object({
    integrity: indexerDigestSchema,
    manifest_digest: indexerDigestSchema,
    issuer: indexerIdSchema,
    trust: z.enum(["first-party", "verified", "project-authorized", "untrusted"]),
  }).strict(),
  transport: z.object({
    kind: z.enum(["directory", "archive"]),
    path: absoluteTransportPathSchema,
    expires_at: z.string().datetime({ offset: true }),
  }).strict(),
  files: z.array(resolvedBundleFileSchema).min(1),
  receipt: z.object({
    resolver: indexerIdSchema,
    resolved_at: z.string().datetime({ offset: true }),
    authority_ref: z.string().min(1),
    receipt_digest: indexerDigestSchema,
  }).strict(),
}).strict().superRefine((value, context) => {
  const paths = value.files.map((file) => file.path);
  const duplicate = paths.find((path, index) => paths.indexOf(path) !== index);
  if (duplicate !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `files must not contain duplicate path ${duplicate}`,
      path: ["files"],
    });
  }
  const sorted = [...paths].sort(compareIndexerCanonicalText);
  if (paths.some((path, index) => path !== sorted[index])) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "files must be sorted by portable path",
      path: ["files"],
    });
  }
  if (value.resolved.integrity !== indexerProviderBundleIntegrity(value.files)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "integrity must match the complete sorted Bundle file ledger",
      path: ["resolved", "integrity"],
    });
  }
  const manifest = value.files.find((file) => file.path === "context-indexer.yaml");
  if (manifest === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "files must contain context-indexer.yaml",
      path: ["files"],
    });
  } else if (manifest.digest !== value.resolved.manifest_digest) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "manifest_digest must match the context-indexer.yaml file digest",
      path: ["resolved", "manifest_digest"],
    });
  }
});

export type ResolvedProviderBundle = z.infer<typeof resolvedProviderBundleSchema>;
export type ProviderResolutionRequest = z.infer<typeof providerResolutionRequestSchema>;

export interface ExpectedProviderResolution {
  indexerId: string;
  providerId: string;
  skill: string;
  version: string;
  integrity: string;
  distribution: IndexerDistribution;
}

function normalizedFiles(files: readonly ResolvedProviderBundle["files"][number][]): unknown[] {
  return [...files]
    .sort((left, right) => compareIndexerCanonicalText(left.path, right.path))
    .map((file) => ({ path: file.path, digest: file.digest }));
}

export function indexerProviderBundleIntegrity(
  files: readonly ResolvedProviderBundle["files"][number][],
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.provider-bundle-integrity/v1",
    files: normalizedFiles(files),
  });
}

export function resolvedProviderReceiptDigest(bundle: ResolvedProviderBundle): string {
  return indexerProtocolDigest({
    request: bundle.request,
    resolved: bundle.resolved,
    transport: bundle.transport,
    files: normalizedFiles(bundle.files),
    resolver: bundle.receipt.resolver,
    authority_ref: bundle.receipt.authority_ref,
    resolved_at: bundle.receipt.resolved_at,
  });
}

export function resolvedProviderStableFingerprint(bundle: ResolvedProviderBundle): string {
  return indexerProtocolDigest({
    protocol: bundle.protocol,
    request: bundle.request,
    resolved: bundle.resolved,
    files: normalizedFiles(bundle.files),
    authority_ref: bundle.receipt.authority_ref,
  });
}

function sameDistribution(left: IndexerDistribution, right: IndexerDistribution): boolean {
  return left.kind === right.kind && left.locator === right.locator;
}

export function validateResolvedProviderBundle(
  value: unknown,
  expected: ExpectedProviderResolution,
  now = new Date(),
): ResolvedProviderBundle {
  const parsed = resolvedProviderBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `resolved Provider Bundle is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const bundle = parsed.data;
  const mismatches = [
    bundle.request.indexer_id === expected.indexerId ? undefined : "indexer_id",
    bundle.request.provider_id === expected.providerId ? undefined : "provider_id",
    bundle.request.skill === expected.skill ? undefined : "skill",
    bundle.request.version === expected.version ? undefined : "version",
    sameDistribution(bundle.request.distribution, expected.distribution)
      ? undefined
      : "distribution",
    bundle.resolved.integrity === expected.integrity ? undefined : "integrity",
  ].filter((field): field is string => field !== undefined);
  if (mismatches.length > 0) {
    throw new TypeError(
      `resolved Provider Bundle does not match the staged selection: ${mismatches.join(", ")}`,
    );
  }
  if (Date.parse(bundle.transport.expires_at) <= now.getTime()) {
    throw new TypeError("resolved Provider Bundle transport has expired");
  }
  const expectedReceipt = resolvedProviderReceiptDigest(bundle);
  if (bundle.receipt.receipt_digest !== expectedReceipt) {
    throw new TypeError("resolved Provider Bundle receipt digest does not match its delivery");
  }
  return bundle;
}

const cliBundledDistributionSchema = z.object({
  kind: z.literal("cli-bundled"),
  locator: z.string().regex(/^cli-bundled:\/\/[A-Za-z0-9._~/-]+$/u),
}).strict();

const cliReleaseBundleSchema = z.object({
  skill: indexerIdSchema,
  version: indexerSemverSchema,
  distribution: cliBundledDistributionSchema,
  integrity: indexerDigestSchema,
  manifest_digest: indexerDigestSchema,
  files: z.array(resolvedBundleFileSchema).min(1),
}).strict();

export const indexerCliReleaseManifestSchema = z.object({
  protocol: z.literal("context.indexer.cli-release-manifest/v1"),
  package: z.literal("@c4a/context-cli"),
  version: indexerSemverSchema,
  issuer: z.literal("context4ai/context"),
  bundles: z.array(cliReleaseBundleSchema),
}).strict().superRefine((value, context) => {
  const identities = value.bundles.map((bundle) =>
    `${bundle.skill}@${bundle.version}\u0000${bundle.distribution.locator}`
  );
  const duplicate = identities.find((identity, index) => identities.indexOf(identity) !== index);
  if (duplicate !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `bundles must not contain duplicate identity ${duplicate}`,
      path: ["bundles"],
    });
  }
  value.bundles.forEach((bundle, index) => {
    const paths = bundle.files.map((file) => file.path);
    const sorted = [...paths].sort(compareIndexerCanonicalText);
    const manifest = bundle.files.find((file) => file.path === "context-indexer.yaml");
    if (manifest === undefined || manifest.digest !== bundle.manifest_digest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bundle manifest digest must match context-indexer.yaml",
        path: ["bundles", index, "manifest_digest"],
      });
    }
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bundle files must be unique",
        path: ["bundles", index, "files"],
      });
    }
    if (paths.some((path, pathIndex) => path !== sorted[pathIndex])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bundle files must be sorted by portable path",
        path: ["bundles", index, "files"],
      });
    }
    if (bundle.integrity !== indexerProviderBundleIntegrity(bundle.files)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bundle integrity must match the complete file ledger",
        path: ["bundles", index, "integrity"],
      });
    }
  });
});

export type IndexerCliReleaseManifest = z.infer<typeof indexerCliReleaseManifestSchema>;

export const indexerHostExecutionCapabilitiesSchema = z.object({
  protocol: z.literal("context.indexer.host-execution-capabilities/v1"),
  adapter: indexerIdSchema,
  adapter_version: indexerSemverSchema,
  sandboxed_program: z.literal(false),
}).strict();

export type IndexerHostExecutionCapabilities = z.infer<
  typeof indexerHostExecutionCapabilitiesSchema
>;

export const indexerProgramAuthorizationSchema = z.object({
  protocol: z.literal("context.indexer.program-authorization/v1"),
  project_ref: z.string().min(1),
  provider_integrity: indexerDigestSchema,
  provider_fingerprint: indexerDigestSchema,
  manifest_digest: indexerDigestSchema,
  resource: z.literal("program"),
  program_origin: z.enum(["provider-bundle", "project-local"]),
  program_digest: indexerDigestSchema,
  execution_digest: indexerDigestSchema,
  capability_set_digest: indexerDigestSchema,
  dependency_set_digest: indexerDigestSchema,
  scope_digest: indexerDigestSchema,
  execution_policy_digest: indexerDigestSchema,
  report_digest: indexerDigestSchema,
  authority_ref: z.string().min(1),
  authority_scope_digest: indexerDigestSchema,
  sandboxed_program: z.literal(false),
  receipt_digest: indexerDigestSchema,
}).strict();

export type IndexerProgramAuthorization = z.infer<typeof indexerProgramAuthorizationSchema>;

function programAuthorizationPayload(
  value: IndexerProgramAuthorization,
): Omit<IndexerProgramAuthorization, "receipt_digest"> {
  return {
    protocol: value.protocol,
    project_ref: value.project_ref,
    provider_integrity: value.provider_integrity,
    provider_fingerprint: value.provider_fingerprint,
    manifest_digest: value.manifest_digest,
    resource: value.resource,
    program_origin: value.program_origin,
    program_digest: value.program_digest,
    execution_digest: value.execution_digest,
    capability_set_digest: value.capability_set_digest,
    dependency_set_digest: value.dependency_set_digest,
    scope_digest: value.scope_digest,
    execution_policy_digest: value.execution_policy_digest,
    report_digest: value.report_digest,
    authority_ref: value.authority_ref,
    authority_scope_digest: value.authority_scope_digest,
    sandboxed_program: value.sandboxed_program,
  };
}

export function indexerProgramExecutionDigest(
  execution: IndexerExecution,
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.program-execution/v1",
    execution,
  });
}

export function indexerProgramIdentityDigest(input: {
  origin: "provider-bundle" | "project-local";
  path: string;
  content_digest: string;
  provider_integrity: string;
  execution_digest: string;
}): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.program-identity/v1",
    ...input,
  });
}

export function indexerProgramCapabilitySetDigest(
  capabilities: readonly string[],
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.program-capability-set/v1",
    capabilities: [...capabilities].sort(compareIndexerCanonicalText),
  });
}

export function indexerRequestedProgramPolicyDigest(input: {
  execution_digest: string;
  capability_set_digest: string;
  dependency_set_digest: string;
  scope_digest: string;
  limits: {
    timeout_ms: number;
    max_stdin_bytes: number;
    max_stdout_bytes: number;
    max_stderr_bytes: number;
  };
}): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.requested-program-policy/v1",
    resource: "program",
    execution_digest: input.execution_digest,
    capability_set_digest: input.capability_set_digest,
    dependency_set_digest: input.dependency_set_digest,
    scope_digest: input.scope_digest,
    environment: "empty",
    shell: false,
    sandboxed_program: false,
    limits: input.limits,
  });
}

export function validateIndexerProgramAuthorization(
  value: unknown,
): IndexerProgramAuthorization {
  const authorization = indexerProgramAuthorizationSchema.parse(value);
  if (indexerProtocolDigest(programAuthorizationPayload(authorization)) !== authorization.receipt_digest) {
    throw new TypeError("Indexer program authorization receipt digest is invalid");
  }
  return authorization;
}

export function buildIndexerProgramAuthorization(
  input: Omit<IndexerProgramAuthorization, "protocol" | "sandboxed_program" | "receipt_digest">,
): IndexerProgramAuthorization {
  const payload: Omit<IndexerProgramAuthorization, "receipt_digest"> = {
    protocol: "context.indexer.program-authorization/v1",
    ...input,
    sandboxed_program: false,
  };
  return validateIndexerProgramAuthorization({
    ...payload,
    receipt_digest: indexerProtocolDigest(payload),
  });
}

export type IndexerProgramExecutionLevel =
  | "declarative"
  | "trusted-program"
  | "sandboxed-program"
  | "advisory-only";

export interface IndexerProgramExecutionPolicy {
  protocol: "context.indexer.program-execution-policy/v1";
  level: IndexerProgramExecutionLevel;
  sandboxedProgram: false;
  executable: boolean;
  reason:
    | "provider-is-declarative"
    | "first-party-provider"
    | "verified-provider"
    | "project-authorized-exact-digest"
    | "untrusted-program-without-sandbox";
}

export function deriveIndexerProgramExecutionPolicy(input: {
  manifest: IndexerProviderManifest;
  bundle: ResolvedProviderBundle;
  host: IndexerHostExecutionCapabilities;
  authorization?: IndexerProgramAuthorization;
  projectRef: string;
}): IndexerProgramExecutionPolicy {
  const host = indexerHostExecutionCapabilitiesSchema.parse(input.host);
  if (input.manifest.provider.program === undefined) {
    return {
      protocol: "context.indexer.program-execution-policy/v1",
      level: "declarative",
      sandboxedProgram: host.sandboxed_program,
      executable: true,
      reason: "provider-is-declarative",
    };
  }
  if (input.bundle.resolved.trust === "first-party") {
    return {
      protocol: "context.indexer.program-execution-policy/v1",
      level: "trusted-program",
      sandboxedProgram: false,
      executable: true,
      reason: "first-party-provider",
    };
  }
  if (input.bundle.resolved.trust === "verified") {
    return {
      protocol: "context.indexer.program-execution-policy/v1",
      level: "trusted-program",
      sandboxedProgram: false,
      executable: true,
      reason: "verified-provider",
    };
  }
  const authorization = input.authorization === undefined
    ? undefined
    : validateIndexerProgramAuthorization(input.authorization);
  const program = input.manifest.provider.program;
  if (
    authorization?.project_ref === input.projectRef &&
    authorization.provider_integrity === input.bundle.resolved.integrity &&
    authorization.provider_fingerprint === resolvedProviderStableFingerprint(input.bundle) &&
    authorization.manifest_digest === input.bundle.resolved.manifest_digest &&
    authorization.resource === "program" &&
    authorization.program_origin === "provider-bundle" &&
    program !== undefined &&
    authorization.program_digest === indexerProgramIdentityDigest({
      origin: "provider-bundle",
      path: program.execution.entry,
      content_digest: input.bundle.files.find(
        (file) => file.path === program.execution.entry,
      )?.digest ?? "missing",
      provider_integrity: input.bundle.resolved.integrity,
      execution_digest: indexerProgramExecutionDigest(program.execution),
    }) &&
    authorization.execution_digest === indexerProgramExecutionDigest(program.execution) &&
    authorization.sandboxed_program === false
  ) {
    return {
      protocol: "context.indexer.program-execution-policy/v1",
      level: "trusted-program",
      sandboxedProgram: false,
      executable: true,
      reason: "project-authorized-exact-digest",
    };
  }
  return {
    protocol: "context.indexer.program-execution-policy/v1",
    level: "advisory-only",
    sandboxedProgram: false,
    executable: false,
    reason: "untrusted-program-without-sandbox",
  };
}
