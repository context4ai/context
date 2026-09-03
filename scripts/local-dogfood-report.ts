import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  indexerProtocolDigest,
  loadSourcesRegistry,
  parseIndexerRegistry,
} from "../packages/context/src/index.js";
import {
  readProjectCloseStatus,
} from "../packages/context-cli/src/project/close.js";
import {
  readProjectIndexerCandidateCompileStatus,
} from "../packages/context-cli/src/project/indexerCandidateCompileActions.js";
import {
  INDEXER_MAIN_RUN_CURRENT_PATH,
  observeIndexerMainRunStore,
} from "../packages/context-cli/src/project/indexerMainRunStore.js";
import {
  readPostAuthorCurrentEnvelope,
  readPostAuthorCurrentState,
} from "../packages/context-cli/src/project/indexerPostAuthorStorePersistence.js";
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
import { indexerOwnerDomainAuthorities } from
  "../packages/context-cli/src/project/indexerMaterialGapAuthority.js";
import { readIndexerMaterialGapState } from
  "../packages/context-cli/src/project/indexerMaterialGapStore.js";
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

type RunState = "accepted" | "failed" | "pending" | "running" | "stale";

export interface LocalDogfoodEvaluationInput {
  force_approved: boolean;
  main_run: {
    present: boolean;
    states: readonly RunState[];
  };
  post_author: {
    present: boolean;
    states: readonly RunState[];
    envelope_current: boolean;
  };
  candidate_compile: {
    state: "missing" | "current" | "stale" | "invalid";
    file_count: number;
    approved_binding_count: number;
    draft_count: number;
  };
  close: { state: "missing" | "ready" | "stale" };
  material_gaps: { blocking_count: number };
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
  if (!input.main_run.present) reasons.push("main-run-missing");
  if (input.main_run.states.some((state) => state !== "accepted")) {
    reasons.push(input.main_run.states.includes("stale")
      ? "main-result-stale"
      : "main-run-incomplete");
  }
  if (
    input.post_author.present &&
    input.post_author.states.length > 0 &&
    (input.post_author.states.some((state) => state !== "accepted") ||
      !input.post_author.envelope_current)
  ) {
    reasons.push(input.post_author.states.includes("stale")
      ? "post-author-result-stale"
      : "post-author-incomplete");
  }
  if (input.candidate_compile.state !== "current") {
    reasons.push(`candidate-compile-${input.candidate_compile.state}`);
  }
  if (input.candidate_compile.file_count === 0) {
    reasons.push("artifact-output-empty");
  }
  if (
    input.candidate_compile.approved_binding_count !==
    input.candidate_compile.file_count
  ) {
    reasons.push("candidate-approved-binding-mismatch");
  }
  if (input.candidate_compile.draft_count > 0) {
    reasons.push("draft-candidate-present");
  }
  if (input.close.state !== "ready") reasons.push(`close-${input.close.state}`);
  if (input.material_gaps.blocking_count > 0) reasons.push("required-material-gap");
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

function states(values: readonly { state: string }[]): RunState[] {
  return values.map((item) => item.state).filter((state): state is RunState =>
    ["accepted", "failed", "pending", "running", "stale"].includes(state)
  );
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
  const indexerRegistry = parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const mainRun = await observeIndexerMainRunStore(projectRoot).catch((error: unknown) => {
    if (error instanceof Error && /not prepared/u.test(error.message)) return undefined;
    throw error;
  });
  const authorWorksetDigests = uniqueSorted((mainRun?.ledger.entries ?? [])
    .filter((entry) => entry.stage === "author")
    .map((entry) => entry.workset_digest));
  // Candidate status may repair a post-close approved binding under the
  // project write lock. Resolve it before the other readers so this report
  // cannot race itself through verify/status collection.
  const compile = await readProjectIndexerCandidateCompileStatus(projectRoot);
  const [
    postAuthorStates,
    postAuthorEnvelopes,
    close,
    verify,
    approved,
    packages,
    runtimePresence,
    indexersDigest,
    projectEntryDigest,
    materialGapState,
  ] = await Promise.all([
    Promise.all(authorWorksetDigests.map((digest) =>
      readPostAuthorCurrentState(projectRoot, digest)
    )),
    Promise.all(authorWorksetDigests.map((digest) =>
      readPostAuthorCurrentEnvelope(projectRoot, digest)
    )),
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
    readIndexerMaterialGapState(projectRoot),
  ]);
  // readProjectIndexerCandidateCompileStatus has already matched every current
  // compile file to either its exact approved page or one current Candidate.
  // Reuse that result instead of requiring transient digest fields in reader
  // Markdown or reading every approved file a second time.
  const approvedBindings = compile.state === "current" && compile.compile !== undefined
    ? compile.compile.files.length - compile.candidates.length
    : 0;
  const currentPostAuthorPairs = postAuthorStates.flatMap((state, index) =>
    state === undefined ? [] : [{ state, envelope: postAuthorEnvelopes[index] }]
  );
  const currentPostAuthorStates = currentPostAuthorPairs.map((item) => item.state);
  const postAuthorEntries = currentPostAuthorStates.flatMap((state) => state.ledger.entries);
  const postAuthorEnvelopeCurrent = currentPostAuthorPairs.every(({ state, envelope }) =>
    state.spec.plan.state === "not-required" ||
    (envelope !== undefined && envelope.ledger_digest === state.ledger.ledger_digest)
  );
  const completedRuntimePathsPresent = runtimePresence
    .filter((item) => item.present)
    .map((item) => item.path);
  const domainStateByOwner = new Map(
    indexerOwnerDomainAuthorities(indexerRegistry).map((authority) => [
      authority.owner_cell_ref,
      authority.domain_state,
    ]),
  );
  const materialGapEntries = materialGapState?.ledger.entries ?? [];
  const blockingMaterialGaps = materialGapEntries.filter((entry) =>
    domainStateByOwner.get(entry.owner_cell_ref) !== "optional"
  );
  const evaluationInput: LocalDogfoodEvaluationInput = {
    force_approved: input.forceApproved ?? false,
    main_run: {
      present: mainRun !== undefined,
      states: states(mainRun?.ledger.entries ?? []),
    },
    post_author: {
      present: currentPostAuthorStates.length > 0,
      states: states(postAuthorEntries),
      envelope_current: postAuthorEnvelopeCurrent,
    },
    candidate_compile: {
      state: compile.state,
      file_count: compile.compile?.files.length ?? 0,
      approved_binding_count: approvedBindings,
      draft_count: compile.candidates.filter((candidate) => candidate.status === "draft").length,
    },
    close: { state: close.state },
    material_gaps: { blocking_count: blockingMaterialGaps.length },
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
    force_approved: evaluationInput.force_approved,
    workspace: projectRoot,
    inputs: {
      source_registry_digest: indexerRequirementSourceBoundaryDigest(registry),
      indexers_digest: indexersDigest,
      project_entry_digest: projectEntryDigest,
    },
    main_run: mainRun === undefined
      ? { present: false, path: INDEXER_MAIN_RUN_CURRENT_PATH }
      : {
          present: true,
          path: INDEXER_MAIN_RUN_CURRENT_PATH,
          ledger_digest: mainRun.ledger.ledger_digest,
          stage: mainRun.ledger.entries[0]?.stage ?? null,
          entries: mainRun.ledger.entries.length,
          states: Object.fromEntries(
            uniqueSorted(mainRun.ledger.entries.map((entry) => entry.state))
              .map((state) => [state, mainRun.ledger.entries.filter((entry) =>
                entry.state === state
              ).length]),
          ),
        },
    post_author: currentPostAuthorStates.length === 0
      ? { present: false }
      : {
          present: true,
          author_worksets: currentPostAuthorStates.length,
          entries: postAuthorEntries.length,
          states: Object.fromEntries(
            uniqueSorted(postAuthorEntries.map((entry) => entry.state))
              .map((state) => [state, postAuthorEntries.filter((entry) =>
                entry.state === state
              ).length]),
          ),
          envelope_current: postAuthorEnvelopeCurrent,
        },
    candidate_compile: {
      state: compile.state,
      path: ".tmp/context-runtime/indexer/candidate-compile/current.json",
      compile_digest: compile.compile?.compile_digest ?? null,
      file_count: compile.compile?.files.length ?? 0,
      approved_binding_count: approvedBindings,
      draft_count: evaluationInput.candidate_compile.draft_count,
      diagnostic: compile.diagnostic ?? null,
    },
    approved_knowledge: { count: approved.length },
    material_gaps: {
      present: materialGapState !== undefined,
      total_count: materialGapEntries.length,
      blocking_count: blockingMaterialGaps.length,
      optional_count: materialGapEntries.length - blockingMaterialGaps.length,
    },
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
