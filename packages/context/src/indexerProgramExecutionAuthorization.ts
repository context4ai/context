import { z } from "zod";
import {
  indexerExecutionSchema,
  indexerProviderManifestSchema,
  type IndexerExecution,
  type IndexerProviderManifest,
} from "./indexerProvider.js";
import {
  buildIndexerProgramAuthorization,
  indexerProgramCapabilitySetDigest,
  indexerProgramExecutionDigest,
  indexerProgramIdentityDigest,
  indexerRequestedProgramPolicyDigest,
  resolvedProviderBundleSchema,
  resolvedProviderStableFingerprint,
  type IndexerProgramAuthorization,
  type ResolvedProviderBundle,
} from "./indexerProviderResolution.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const reportProviderSchema = z.object({
  indexer_id: indexerIdSchema,
  provider_id: indexerIdSchema,
  skill: indexerIdSchema,
  version: indexerSemverSchema,
  bundle_integrity: indexerDigestSchema,
  manifest_digest: indexerDigestSchema,
  provider_fingerprint: indexerDigestSchema,
  issuer: indexerIdSchema,
  declared_trust: z.enum(["first-party", "verified", "project-authorized", "untrusted"]),
}).strict();

const reportProgramSchema = z.discriminatedUnion("origin", [
  z.object({
    origin: z.literal("provider-bundle"),
    path: portableIndexerPathSchema,
    content_digest: indexerDigestSchema,
    program_digest: indexerDigestSchema,
  }).strict(),
  z.object({
    origin: z.literal("project-local"),
    path: portableIndexerPathSchema,
    content_digest: indexerDigestSchema,
    program_digest: indexerDigestSchema,
  }).strict(),
]);

export const indexerProgramExecutionAuthorizationReportSchema = z.object({
  protocol: z.literal("context.indexer.program-execution-authorization-report/v1"),
  project_ref: z.string().min(1),
  provider: reportProviderSchema,
  resource: z.literal("program"),
  program: reportProgramSchema,
  execution: indexerExecutionSchema,
  execution_digest: indexerDigestSchema,
  capabilities: z.array(z.enum([
    "source.read",
    "parser-facts.read",
    "indexer-result.write",
  ])).min(1),
  capability_set_digest: indexerDigestSchema,
  dependency_set_digest: indexerDigestSchema,
  scope_digest: indexerDigestSchema,
  limits: z.object({
    timeout_ms: z.number().int().min(100).max(300_000),
    max_stdin_bytes: z.number().int().positive().max(64 * 1024 * 1024),
    max_stdout_bytes: z.number().int().positive().max(64 * 1024 * 1024),
    max_stderr_bytes: z.number().int().positive().max(4 * 1024 * 1024),
  }).strict(),
  execution_policy_digest: indexerDigestSchema,
  requested_level: z.literal("trusted-program"),
  sandboxed_program: z.literal(false),
  report_digest: indexerDigestSchema,
}).strict();

export type IndexerProgramExecutionAuthorizationReport = z.infer<
  typeof indexerProgramExecutionAuthorizationReportSchema
>;

function reportPayload(
  value: IndexerProgramExecutionAuthorizationReport,
): Omit<IndexerProgramExecutionAuthorizationReport, "report_digest"> {
  return {
    protocol: value.protocol,
    project_ref: value.project_ref,
    provider: value.provider,
    resource: value.resource,
    program: value.program,
    execution: value.execution,
    execution_digest: value.execution_digest,
    capabilities: value.capabilities,
    capability_set_digest: value.capability_set_digest,
    dependency_set_digest: value.dependency_set_digest,
    scope_digest: value.scope_digest,
    limits: value.limits,
    execution_policy_digest: value.execution_policy_digest,
    requested_level: value.requested_level,
    sandboxed_program: value.sandboxed_program,
  };
}

export function validateIndexerProgramExecutionAuthorizationReport(
  value: unknown,
): IndexerProgramExecutionAuthorizationReport {
  const report = indexerProgramExecutionAuthorizationReportSchema.parse(value);
  const sortedCapabilities = [...report.capabilities].sort(compareIndexerCanonicalText);
  if (report.capabilities.some((capability, index) => capability !== sortedCapabilities[index])) {
    throw new TypeError("Indexer program authorization capabilities must use canonical order");
  }
  if (new Set(report.capabilities).size !== report.capabilities.length) {
    throw new TypeError("Indexer program authorization capabilities must be unique");
  }
  if (report.program.origin === "provider-bundle" &&
    (report.provider.declared_trust === "first-party" ||
      report.provider.declared_trust === "verified")) {
    throw new TypeError("allowlisted Provider programs do not require project authorization");
  }
  if (report.program.origin === "project-local" &&
    !/^src\/indexer\/[a-z0-9][a-z0-9._-]*\/index\.ts$/u.test(report.program.path)) {
    throw new TypeError("project-local program authorization requires the fixed Indexer entry path");
  }
  if (report.execution.entry !== report.program.path) {
    throw new TypeError("Indexer program authorization execution must use the authorized program path");
  }
  if (indexerProgramExecutionDigest(report.execution) !== report.execution_digest) {
    throw new TypeError("Indexer program authorization execution digest is invalid");
  }
  if (indexerProgramIdentityDigest({
    origin: report.program.origin,
    path: report.program.path,
    content_digest: report.program.content_digest,
    provider_integrity: report.provider.bundle_integrity,
    execution_digest: report.execution_digest,
  }) !== report.program.program_digest) {
    throw new TypeError("Indexer program authorization program digest is invalid");
  }
  if (indexerProgramCapabilitySetDigest(report.capabilities) !== report.capability_set_digest) {
    throw new TypeError("Indexer program authorization capability set digest is invalid");
  }
  if (indexerRequestedProgramPolicyDigest({
    execution_digest: report.execution_digest,
    capability_set_digest: report.capability_set_digest,
    dependency_set_digest: report.dependency_set_digest,
    scope_digest: report.scope_digest,
    limits: report.limits,
  }) !== report.execution_policy_digest) {
    throw new TypeError("Indexer program authorization policy digest is invalid");
  }
  if (indexerProtocolDigest(reportPayload(report)) !== report.report_digest) {
    throw new TypeError("Indexer program execution authorization report digest is invalid");
  }
  return report;
}

export function buildIndexerProgramExecutionAuthorizationReport(input: {
  project_ref: string;
  manifest: IndexerProviderManifest;
  bundle: ResolvedProviderBundle;
  dependency_set_digest: string;
  scope_digest: string;
  limits: IndexerProgramExecutionAuthorizationReport["limits"];
}): IndexerProgramExecutionAuthorizationReport {
  const manifest = indexerProviderManifestSchema.parse(input.manifest);
  const bundle = resolvedProviderBundleSchema.parse(input.bundle);
  if (manifest.id !== bundle.request.skill || manifest.version !== bundle.request.version) {
    throw new TypeError("program authorization manifest does not match the resolved Provider");
  }
  if (manifest.provider.program === undefined) {
    throw new TypeError("program authorization requires a Provider program");
  }
  if (bundle.resolved.trust === "first-party" || bundle.resolved.trust === "verified") {
    throw new TypeError("allowlisted Provider programs do not require project authorization");
  }
  const programFile = bundle.files.find(
    (file) => file.path === manifest.provider.program!.execution.entry,
  );
  if (programFile === undefined) {
    throw new TypeError("program authorization entry is absent from the Provider Bundle");
  }
  const capabilities = [...manifest.provider.program.capabilities].sort(
    compareIndexerCanonicalText,
  );
  const executionDigest = indexerProgramExecutionDigest(manifest.provider.program.execution);
  const capabilitySetDigest = indexerProgramCapabilitySetDigest(capabilities);
  const dependencySetDigest = indexerDigestSchema.parse(input.dependency_set_digest);
  const scopeDigest = indexerDigestSchema.parse(input.scope_digest);
  const limits = indexerProgramExecutionAuthorizationReportSchema.shape.limits.parse(input.limits);
  const payload: Omit<IndexerProgramExecutionAuthorizationReport, "report_digest"> = {
    protocol: "context.indexer.program-execution-authorization-report/v1",
    project_ref: input.project_ref,
    provider: {
      indexer_id: bundle.request.indexer_id,
      provider_id: bundle.request.provider_id,
      skill: bundle.request.skill,
      version: bundle.request.version,
      bundle_integrity: bundle.resolved.integrity,
      manifest_digest: bundle.resolved.manifest_digest,
      provider_fingerprint: resolvedProviderStableFingerprint(bundle),
      issuer: bundle.resolved.issuer,
      declared_trust: bundle.resolved.trust,
    },
    resource: "program",
    program: {
      origin: "provider-bundle",
      path: manifest.provider.program.execution.entry,
      content_digest: programFile.digest,
      program_digest: indexerProgramIdentityDigest({
        origin: "provider-bundle",
        path: manifest.provider.program.execution.entry,
        content_digest: programFile.digest,
        provider_integrity: bundle.resolved.integrity,
        execution_digest: executionDigest,
      }),
    },
    execution: manifest.provider.program.execution,
    execution_digest: executionDigest,
    capabilities,
    capability_set_digest: capabilitySetDigest,
    dependency_set_digest: dependencySetDigest,
    scope_digest: scopeDigest,
    limits,
    execution_policy_digest: indexerRequestedProgramPolicyDigest({
      execution_digest: executionDigest,
      capability_set_digest: capabilitySetDigest,
      dependency_set_digest: dependencySetDigest,
      scope_digest: scopeDigest,
      limits,
    }),
    requested_level: "trusted-program",
    sandboxed_program: false,
  };
  return validateIndexerProgramExecutionAuthorizationReport({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function buildProjectLocalIndexerProgramExecutionAuthorizationReport(input: {
  project_ref: string;
  base_manifest: IndexerProviderManifest;
  base_bundle: ResolvedProviderBundle;
  program_path: string;
  program_content_digest: string;
  execution: IndexerExecution;
  capabilities: IndexerProgramExecutionAuthorizationReport["capabilities"];
  dependency_set_digest: string;
  scope_digest: string;
  limits: IndexerProgramExecutionAuthorizationReport["limits"];
}): IndexerProgramExecutionAuthorizationReport {
  const manifest = indexerProviderManifestSchema.parse(input.base_manifest);
  const bundle = resolvedProviderBundleSchema.parse(input.base_bundle);
  if (manifest.id !== bundle.request.skill || manifest.version !== bundle.request.version) {
    throw new TypeError("local program authorization base Provider is inconsistent");
  }
  const path = portableIndexerPathSchema.parse(input.program_path);
  if (!/^src\/indexer\/[a-z0-9][a-z0-9._-]*\/index\.ts$/u.test(path)) {
    throw new TypeError("project-local program must use the fixed Indexer entry path");
  }
  const contentDigest = indexerDigestSchema.parse(input.program_content_digest);
  const execution = indexerExecutionSchema.parse(input.execution);
  const executionDigest = indexerProgramExecutionDigest(execution);
  const capabilities = [...input.capabilities].sort(compareIndexerCanonicalText);
  const capabilitySetDigest = indexerProgramCapabilitySetDigest(capabilities);
  const dependencySetDigest = indexerDigestSchema.parse(input.dependency_set_digest);
  const scopeDigest = indexerDigestSchema.parse(input.scope_digest);
  const limits = indexerProgramExecutionAuthorizationReportSchema.shape.limits.parse(input.limits);
  const payload: Omit<IndexerProgramExecutionAuthorizationReport, "report_digest"> = {
    protocol: "context.indexer.program-execution-authorization-report/v1",
    project_ref: input.project_ref,
    provider: {
      indexer_id: bundle.request.indexer_id,
      provider_id: bundle.request.provider_id,
      skill: bundle.request.skill,
      version: bundle.request.version,
      bundle_integrity: bundle.resolved.integrity,
      manifest_digest: bundle.resolved.manifest_digest,
      provider_fingerprint: resolvedProviderStableFingerprint(bundle),
      issuer: bundle.resolved.issuer,
      declared_trust: bundle.resolved.trust,
    },
    resource: "program",
    program: {
      origin: "project-local",
      path,
      content_digest: contentDigest,
      program_digest: indexerProgramIdentityDigest({
        origin: "project-local",
        path,
        content_digest: contentDigest,
        provider_integrity: bundle.resolved.integrity,
        execution_digest: executionDigest,
      }),
    },
    execution,
    execution_digest: executionDigest,
    capabilities,
    capability_set_digest: capabilitySetDigest,
    dependency_set_digest: dependencySetDigest,
    scope_digest: scopeDigest,
    limits,
    execution_policy_digest: indexerRequestedProgramPolicyDigest({
      execution_digest: executionDigest,
      capability_set_digest: capabilitySetDigest,
      dependency_set_digest: dependencySetDigest,
      scope_digest: scopeDigest,
      limits,
    }),
    requested_level: "trusted-program",
    sandboxed_program: false,
  };
  return validateIndexerProgramExecutionAuthorizationReport({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function authorizeIndexerProgramExecution(input: {
  report: unknown;
  authority_ref: string;
  authority_scope_digest: string;
}): IndexerProgramAuthorization {
  const report = validateIndexerProgramExecutionAuthorizationReport(input.report);
  return buildIndexerProgramAuthorization({
    project_ref: report.project_ref,
    provider_integrity: report.provider.bundle_integrity,
    provider_fingerprint: report.provider.provider_fingerprint,
    manifest_digest: report.provider.manifest_digest,
    resource: report.resource,
    program_origin: report.program.origin,
    program_digest: report.program.program_digest,
    execution_digest: report.execution_digest,
    capability_set_digest: report.capability_set_digest,
    dependency_set_digest: report.dependency_set_digest,
    scope_digest: report.scope_digest,
    execution_policy_digest: report.execution_policy_digest,
    report_digest: report.report_digest,
    authority_ref: input.authority_ref,
    authority_scope_digest: input.authority_scope_digest,
  });
}
