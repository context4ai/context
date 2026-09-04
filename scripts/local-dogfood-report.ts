import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  indexerProtocolDigest,
  loadSourcesRegistry,
} from "../packages/context/src/index.js";
import {
  readProjectCloseStatus,
} from "../packages/context-cli/src/project/close.js";
import {
  CANDIDATE_SNAPSHOT_ROOT,
  LIFECYCLE_ROOT,
  REVIEW_ACTION_ROOT,
  REVIEW_RUNTIME_ROOT,
  STRUCTURE_REPORT_ROOT,
} from "../packages/context-cli/src/project/lifecyclePaths.js";
import {
  collectPackageFreshness,
  listApprovedKnowledge,
} from "../packages/context-cli/src/project/packageBuilder.js";
import {
  PACKAGE_BUILD_INVENTORY_PATH,
} from "../packages/context-cli/src/project/packageBuildInventory.js";
import {
  indexerRequirementSourceBoundaryDigest,
} from "../packages/context-cli/src/project/indexerRequirementProject.js";
import { verifyProjectWorkspace } from
  "../packages/context-cli/src/project/verify.js";
import { loadContextProjectModule } from
  "../packages/context-cli/src/project/workspace.js";

const WORKLOAD_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const REPORT_FILE = "real-dogfood-report.json";
const COMPLETED_RUNTIME_PATHS = [
  LIFECYCLE_ROOT,
  REVIEW_RUNTIME_ROOT,
  REVIEW_ACTION_ROOT,
  STRUCTURE_REPORT_ROOT,
  CANDIDATE_SNAPSHOT_ROOT,
] as const;

export interface LocalDogfoodEvaluationInput {
  force_approved: boolean;
  approved_knowledge: { count: number };
  close: { state: "missing" | "ready" | "stale" };
  verify: { evidence_status: "pass" | "pass-with-unverifiable-evidence" | "fail" };
  packages: readonly { state: "missing" | "ready" | "stale" }[];
  completed_runtime_paths_present: readonly string[];
}

export interface LocalDogfoodEvaluation {
  outcome: "conformant" | "nonconformant";
  reason_codes: string[];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function evaluateLocalDogfoodSummary(
  input: LocalDogfoodEvaluationInput,
): LocalDogfoodEvaluation {
  const reasons: string[] = [];
  if (input.force_approved) reasons.push("force-approved-workload");
  if (input.approved_knowledge.count === 0) reasons.push("approved-knowledge-empty");
  if (input.close.state !== "ready") reasons.push(`close-${input.close.state}`);
  if (input.verify.evidence_status === "fail") reasons.push("verify-failed");
  if (input.packages.length === 0) reasons.push("build-package-missing");
  if (input.packages.some((item) => item.state !== "ready")) {
    reasons.push("build-manifest-stale");
  }
  if (
    input.close.state === "ready" &&
    input.completed_runtime_paths_present.length > 0
  ) {
    reasons.push("close-temporary-state-not-cleaned");
  }
  const reasonCodes = uniqueSorted(reasons);
  return {
    outcome: reasonCodes.length === 0 ? "conformant" : "nonconformant",
    reason_codes: reasonCodes,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return false;
    throw error;
  }
}

async function fileDigest(path: string): Promise<string | null> {
  try {
    const content = await readFile(path);
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return null;
    throw error;
  }
}

function issueCounts(issues: readonly { severity: string; code: string }[]) {
  const byReason = new Map<string, number>();
  for (const issue of issues) {
    byReason.set(issue.code, (byReason.get(issue.code) ?? 0) + 1);
  }
  return {
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity !== "error").length,
    reason_codes: Object.fromEntries([...byReason].sort(([left], [right]) =>
      left.localeCompare(right)
    )),
  };
}

export async function buildLocalDogfoodReport(input: {
  workspace: string;
  workload: string;
  mode?: "real-workload" | "local-simulation";
  forceApproved?: boolean;
}) {
  if (!WORKLOAD_PATTERN.test(input.workload)) {
    throw new TypeError("workload must be a portable lowercase slug");
  }
  const projectRoot = resolve(input.workspace);
  const loaded = await loadContextProjectModule(projectRoot);
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const [
    close,
    verify,
    approved,
    packages,
    runtimePresence,
    indexersDigest,
    projectEntryDigest,
  ] = await Promise.all([
    readProjectCloseStatus(projectRoot),
    verifyProjectWorkspace(projectRoot),
    listApprovedKnowledge(projectRoot),
    collectPackageFreshness(projectRoot, loaded.project.packages),
    Promise.all(COMPLETED_RUNTIME_PATHS.map(async (path) => ({
      path,
      present: await exists(join(projectRoot, path)),
    }))),
    fileDigest(join(projectRoot, "src", "indexers.yaml")),
    fileDigest(join(projectRoot, "src", "index.ts")),
  ]);
  const completedRuntimePathsPresent = runtimePresence
    .filter((item) => item.present)
    .map((item) => item.path);
  const evaluationInput: LocalDogfoodEvaluationInput = {
    force_approved: input.forceApproved ?? false,
    approved_knowledge: { count: approved.length },
    close: { state: close.state },
    verify: { evidence_status: verify.evidenceStatus },
    packages: packages.map((pkg) => ({ state: pkg.state })),
    completed_runtime_paths_present: completedRuntimePathsPresent,
  };
  const evaluation = evaluateLocalDogfoodSummary(evaluationInput);
  const reportPayload = {
    report_format: "context-local-dogfood-summary",
    format_version: 1,
    workload: input.workload,
    mode: input.mode ?? "real-workload",
    distribution: input.mode === "local-simulation"
      ? { formal_business_bundle: "not-implemented" }
      : { formal_business_bundle: "external" },
    force_approved: evaluationInput.force_approved,
    workspace: projectRoot,
    inputs: {
      source_registry_digest: indexerRequirementSourceBoundaryDigest(registry),
      indexers_digest: indexersDigest,
      project_entry_digest: projectEntryDigest,
    },
    approved_knowledge: { count: approved.length },
    close: {
      state: close.state,
      input_hash: close.inputHash ?? null,
      temporary_paths_present: completedRuntimePathsPresent,
    },
    verify: {
      evidence_status: verify.evidenceStatus,
      ...issueCounts(verify.issues),
    },
    packages: packages.map((pkg) => ({
      name: pkg.name,
      state: pkg.state,
      input_file_count: pkg.inputFiles,
      output_file_count: pkg.outputFiles,
      manifest_path: `.tmp/context-runtime/packages/${pkg.name}.json`,
      inventory_path: `dist/${pkg.name}/${PACKAGE_BUILD_INVENTORY_PATH}`,
    })),
    evaluation,
  };
  return {
    ...reportPayload,
    report_digest: indexerProtocolDigest(reportPayload),
    generated_at: new Date().toISOString(),
  };
}

export async function writeLocalDogfoodReport(input: {
  workspace: string;
  workload: string;
  mode?: "real-workload" | "local-simulation";
  forceApproved?: boolean;
  outputRoot?: string;
}) {
  const report = await buildLocalDogfoodReport(input);
  const outputRoot = resolve(input.outputRoot ?? process.cwd(), ".tmp", "00-index");
  const outputDirectory = resolve(outputRoot, input.workload);
  if (!outputDirectory.startsWith(`${outputRoot}/`)) {
    throw new TypeError("dogfood output must stay under .tmp/00-index/<workload>");
  }
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, REPORT_FILE);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { outputPath, report };
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspace = option(args, "--workspace");
  const workload = option(args, "--workload");
  const mode = option(args, "--mode");
  const outputRoot = option(args, "--output-root");
  const forceApproved = args.includes("--force-approved");
  if (workspace === undefined || workload === undefined) {
    throw new TypeError("usage: --workspace <context-project> --workload <slug> [--mode real-workload|local-simulation] [--output-root <directory>] [--force-approved]");
  }
  if (mode !== undefined && mode !== "real-workload" && mode !== "local-simulation") {
    throw new TypeError("--mode must be real-workload or local-simulation");
  }
  const result = await writeLocalDogfoodReport({
    workspace,
    workload,
    ...(mode === undefined ? {} : { mode }),
    ...(outputRoot === undefined ? {} : { outputRoot }),
    forceApproved,
  });
  process.stdout.write(`${JSON.stringify({
    output_path: result.outputPath,
    outcome: result.report.evaluation.outcome,
    reason_codes: result.report.evaluation.reason_codes,
    report_digest: result.report.report_digest,
  }, null, 2)}\n`);
  if (result.report.evaluation.outcome !== "conformant") process.exitCode = 2;
}

const executedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (executedPath === fileURLToPath(import.meta.url)) {
  await main();
}
