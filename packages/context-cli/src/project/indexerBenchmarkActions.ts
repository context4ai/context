import {
  buildIndexerBenchmarkReport,
  validateCurrentIndexerBenchmarkManifest,
  validateCurrentIndexerBenchmarkReport,
  type IndexerBenchmarkReport,
} from "@c4a/context";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

async function assertOracleOutsideAgentWorkspace(input: {
  projectRoot: string;
  oraclePath: string;
}): Promise<void> {
  const [workspace, oracle] = await Promise.all([
    realpath(input.projectRoot),
    realpath(input.oraclePath),
  ]);
  const relation = relative(workspace, oracle);
  if (relation.length === 0 || (!relation.startsWith("..") && !isAbsolute(relation))) {
    throw new TypeError(
      "benchmark oracle must be loaded from outside the execution Agent workspace",
    );
  }
}

export async function reportProjectIndexerBenchmark(input: {
  projectRoot: string;
  oraclePath: string;
  manifest: unknown;
  currentAuthority: unknown;
  observation: unknown;
  oracleEvaluation: unknown;
  override: unknown;
}): Promise<IndexerBenchmarkReport> {
  await assertOracleOutsideAgentWorkspace(input);
  const manifest = validateCurrentIndexerBenchmarkManifest({
    value: input.manifest,
    current_authority: input.currentAuthority,
  });
  const report = buildIndexerBenchmarkReport({
    manifest,
    observation: input.observation,
    oracle_evaluation: input.oracleEvaluation,
    override: input.override,
  });
  return validateCurrentIndexerBenchmarkReport({
    value: report,
    manifest,
    observation: input.observation,
    oracle_evaluation: input.oracleEvaluation,
    override: input.override,
  });
}
