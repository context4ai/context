import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  authorizeIndexerProgramExecution,
  buildIndexerProgramExecutionAuthorizationReport,
  buildProjectLocalIndexerProgramExecutionAuthorizationReport,
  indexerProtocolDigest,
  loadIndexerProviderManifest,
  validateIndexerProgramExecutionAuthorizationReport,
  validateIndexerProgramAuthorization,
  type IndexerProgramAuthorization,
  type IndexerProgramExecutionAuthorizationReport,
  type IndexerExecution,
  type IndexerProviderManifest,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import {
  validateStagedIndexerProviderBundle,
  type StagedIndexerProviderBundle,
} from "./indexerProviderStage.js";
import { validateIndexerProgramStaticSource } from "./indexerProgramStaticValidation.js";

export const INDEXER_PROGRAM_EXECUTION_AUTHORITY =
  "context.indexer-program-execution" as const;

export interface IndexerProgramExecutionAuthorizationInput {
  protocol: "context.indexer.program-execution-authorization-input/v1";
  report: IndexerProgramExecutionAuthorizationReport;
  authority_ref: string;
  authority_scope_digest: string;
  input_digest: string;
}

export interface IndexerProgramExecutionAuthorizationResult {
  protocol: "context.indexer.program-execution-authorization-result/v1";
  report_digest: string;
  authorization: IndexerProgramAuthorization;
  result_digest: string;
}

export function validateIndexerProgramExecutionAuthorizationResult(
  value: unknown,
): IndexerProgramExecutionAuthorizationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer program execution authorization result must be an object");
  }
  const result = value as Partial<IndexerProgramExecutionAuthorizationResult>;
  if (
    result.protocol !== "context.indexer.program-execution-authorization-result/v1" ||
    typeof result.report_digest !== "string" ||
    typeof result.result_digest !== "string"
  ) {
    throw new TypeError("Indexer program execution authorization result is incomplete");
  }
  const authorization = validateIndexerProgramAuthorization(result.authorization);
  const payload = {
    protocol: result.protocol,
    report_digest: result.report_digest,
    authorization,
  };
  if (
    authorization.report_digest !== result.report_digest ||
    indexerProtocolDigest(payload) !== result.result_digest
  ) {
    throw new TypeError("Indexer program execution authorization result digest is invalid");
  }
  return { ...payload, result_digest: result.result_digest };
}

function sameFiles(
  left: readonly { path: string; digest: string }[],
  right: readonly { path: string; digest: string }[],
): boolean {
  return left.length === right.length && left.every((file, index) =>
    file.path === right[index]?.path && file.digest === right[index]?.digest
  );
}

function inputPayload(value: IndexerProgramExecutionAuthorizationInput) {
  return {
    protocol: value.protocol,
    report: value.report,
    authority_ref: value.authority_ref,
    authority_scope_digest: value.authority_scope_digest,
  };
}

export function validateIndexerProgramExecutionAuthorizationInput(
  value: unknown,
): IndexerProgramExecutionAuthorizationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer program execution authorization input must be an object");
  }
  const input = value as Partial<IndexerProgramExecutionAuthorizationInput>;
  if (
    input.protocol !== "context.indexer.program-execution-authorization-input/v1" ||
    input.authority_ref !== INDEXER_PROGRAM_EXECUTION_AUTHORITY ||
    typeof input.authority_scope_digest !== "string" ||
    typeof input.input_digest !== "string"
  ) {
    throw new TypeError("Indexer program execution authorization input is incomplete");
  }
  const report = validateIndexerProgramExecutionAuthorizationReport(input.report);
  const normalized: IndexerProgramExecutionAuthorizationInput = {
    protocol: input.protocol,
    report,
    authority_ref: input.authority_ref,
    authority_scope_digest: input.authority_scope_digest,
    input_digest: input.input_digest,
  };
  if (indexerProtocolDigest(inputPayload(normalized)) !== normalized.input_digest) {
    throw new TypeError("Indexer program execution authorization input digest is invalid");
  }
  return normalized;
}

export async function buildProjectIndexerProgramExecutionAuthorizationReport(input: {
  project_ref: string;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  dependency_set_digest: string;
  scope_digest: string;
  limits: IndexerProgramExecutionAuthorizationReport["limits"];
}): Promise<IndexerProgramExecutionAuthorizationReport> {
  validateStagedIndexerProviderBundle(input.staged, input.bundle);
  const actualFiles = await collectIndexerBundleFiles(input.staged.stage_path);
  if (!sameFiles(actualFiles, input.staged.files)) {
    throw new TypeError("program authorization Provider stage changed after validation");
  }
  const manifest = await loadIndexerProviderManifest(input.staged.stage_path);
  if (manifest.provider.program !== undefined) {
    const entry = manifest.provider.program.execution.entry;
    validateIndexerProgramStaticSource({
      path: entry,
      source: await readFile(join(input.staged.stage_path, ...entry.split("/"))),
    });
  }
  return buildIndexerProgramExecutionAuthorizationReport({
    project_ref: input.project_ref,
    manifest,
    bundle: input.bundle,
    dependency_set_digest: input.dependency_set_digest,
    scope_digest: input.scope_digest,
    limits: input.limits,
  });
}

export async function buildProjectLocalIndexerProgramExecutionAuthorizationReportFromWorkspace(
  input: {
    projectRoot: string;
    project_ref: string;
    indexer_id: string;
    base_manifest: IndexerProviderManifest;
    base_bundle: ResolvedProviderBundle;
    execution: IndexerExecution;
    capabilities: IndexerProgramExecutionAuthorizationReport["capabilities"];
    dependency_set_digest: string;
    scope_digest: string;
    limits: IndexerProgramExecutionAuthorizationReport["limits"];
  },
): Promise<IndexerProgramExecutionAuthorizationReport> {
  const programPath = `src/indexer/${input.indexer_id}/index.ts`;
  if (input.execution.entry !== programPath) {
    throw new TypeError("project-local program execution must use its fixed Indexer entry path");
  }
  const absolutePath = join(input.projectRoot, ...programPath.split("/"));
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError("project-local Indexer program must be a regular non-symlink file");
  }
  const content = await readFile(absolutePath);
  validateIndexerProgramStaticSource({ path: programPath, source: content });
  return buildProjectLocalIndexerProgramExecutionAuthorizationReport({
    project_ref: input.project_ref,
    base_manifest: input.base_manifest,
    base_bundle: input.base_bundle,
    program_path: programPath,
    program_content_digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    execution: input.execution,
    capabilities: input.capabilities,
    dependency_set_digest: input.dependency_set_digest,
    scope_digest: input.scope_digest,
    limits: input.limits,
  });
}

export function buildIndexerProgramExecutionAuthorizationInput(input: {
  report: IndexerProgramExecutionAuthorizationReport;
  authority_ref: string;
  authority_scope_digest: string;
}): IndexerProgramExecutionAuthorizationInput {
  const payload = {
    protocol: "context.indexer.program-execution-authorization-input/v1" as const,
    report: validateIndexerProgramExecutionAuthorizationReport(input.report),
    authority_ref: input.authority_ref,
    authority_scope_digest: input.authority_scope_digest,
  };
  return validateIndexerProgramExecutionAuthorizationInput({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function authorizeProjectIndexerProgramExecution(
  value: unknown,
): IndexerProgramExecutionAuthorizationResult {
  const input = validateIndexerProgramExecutionAuthorizationInput(value);
  const authorization = authorizeIndexerProgramExecution({
    report: input.report,
    authority_ref: input.authority_ref,
    authority_scope_digest: input.authority_scope_digest,
  });
  const payload = {
    protocol: "context.indexer.program-execution-authorization-result/v1" as const,
    report_digest: input.report.report_digest,
    authorization,
  };
  return validateIndexerProgramExecutionAuthorizationResult({
    ...payload,
    result_digest: indexerProtocolDigest(payload),
  });
}
