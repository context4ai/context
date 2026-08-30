import {
  confirmIndexerRequirementWorkset,
  validateIndexerRequirementWorksetReport,
} from "@c4a/context";
import { Command } from "commander";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import {
  applyProjectIndexerRequirements,
  compareProjectIndexerRequirements,
  inspectProjectIndexerRequirements,
} from "./indexerRequirementProject.js";
import {
  listCliBundledIndexers,
  loadCliReleaseCapabilityManifest,
} from "./indexerCliBundledProvider.js";
import { validateProjectIndexerSelectionProposal } from "./indexerSelectionProposal.js";
import { routeProjectIndexerProviderSelection } from "./indexerProviderRouting.js";
import { validateAndStageProjectIndexerCustomizationDraft } from
  "./indexerCustomizationDraftStage.js";
import { prepareProjectIndexerCustomizationProposal } from
  "./indexerCustomizationProjectPreparation.js";
import {
  buildProjectIndexerMainAuthorWorksets,
  buildProjectIndexerMainPartitionWorksets,
  buildProjectIndexerQuestionTargetInventory,
  buildProjectIndexerSubjectCatalog,
  buildProjectIndexerTargetResolutionViews,
  auditProjectIndexerProjectedArtifactFanOut,
  observeProjectIndexerMainWorksets,
  validateProjectIndexerMainRun,
} from "./indexerMainLifecycleActions.js";
import {
  acceptProjectIndexerMainRunStore,
  convergeProjectIndexerMainPartitionRunStore,
  failProjectIndexerMainRunStore,
  observeProjectIndexerMainRunStore,
  prepareProjectIndexerMainRunStore,
  startProjectIndexerMainRunStore,
} from "./indexerMainRunStoreActions.js";
import { buildProjectIndexerCatalogFallback } from
  "./indexerCatalogFallbackActions.js";
import {
  acceptProjectIndexerPostAuthorRun,
  buildProjectIndexerPostAuthorWorksets,
  composeProjectIndexerPostAuthorEnvelope,
  failProjectIndexerPostAuthorRun,
  observeProjectIndexerPostAuthorState,
  resolveProjectIndexerEffectiveComposers,
  startProjectIndexerPostAuthorRun,
} from "./indexerPostAuthorActions.js";
import { reconcileProjectIndexerResults } from "./indexerResultReconciliationActions.js";
import { registerIndexerMaterialAnswerCommands } from "./indexerMaterialAnswerCommands.js";
import { registerIndexerRequirementGateCommands } from "./indexerRequirementGateCommands.js";
import { registerIndexerSubjectIdentityCommands } from "./indexerSubjectIdentityCommands.js";
import { registerIndexerMarkdownProviderCommands } from "./indexerMarkdownProviderCommands.js";
import { registerIndexerAuditCommands } from "./indexerAuditCommands.js";
import { registerIndexerProfileAuditCommands } from "./indexerProfileAuditCommands.js";
import { compileProjectIndexerCandidates } from "./indexerCandidateCompileActions.js";
import { reportProjectIndexerIncrementalImpact } from
  "./indexerIncrementalImpactActions.js";
import { reportProjectIndexerBenchmark } from "./indexerBenchmarkActions.js";
import {
  dispatchProjectIndexerProviderResolution,
  stageProjectIndexerProviderResolution,
} from "./indexerProviderProjectFlow.js";
import type { HostActionResult } from "@c4a/agent-graph";
import type { IndexerProviderHostManagedOutput } from "./indexerProviderDispatcher.js";
import {
  applyProjectIndexerProposal,
  stageProjectIndexerProposal,
} from "./indexerProjectFlow.js";
import { authorizeProjectIndexerDependencies } from "./indexerDependencyAuthorization.js";
import { observeProjectIndexerApply } from "./indexerProjectObservation.js";
import { authorizeProjectIndexerProgramExecution } from
  "./indexerProgramExecutionAuthorization.js";
import {
  authorizeProjectIndexerContractOverlay,
  validateProjectIndexerContractOverlay,
} from "./indexerContractOverlayValidation.js";
import {
  confirmProjectIndexerOverlayQuestionAmendment,
  proposeProjectIndexerOverlayQuestionAmendment,
  rebindProjectIndexerSelectionToOverlayRequirement,
} from "./indexerOverlayQuestionLifecycle.js";
import { findContextProjectRoot } from "./workspace.js";

type OutputFormat = "json" | "yaml";

function commandOptions(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

function stringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim();
}

function requiredStringOption(
  options: Record<string, unknown>,
  name: string,
  flag: string,
): string {
  const value = stringOption(options, name);
  if (value !== undefined) return value;
  throw new ContextError(ExitCode.UserError, `${flag} requires a non-empty value`, {
    category: ErrorCategory.UserInputInvalid,
    flag,
  });
}

function outputFormat(options: Record<string, unknown>): OutputFormat {
  const value = stringOption(options, "format") ?? "json";
  if (value === "json" || value === "yaml") return value;
  throw new ContextError(ExitCode.UserError, "--format must be json or yaml", {
    category: ErrorCategory.UserInputInvalid,
    flag: "--format",
  });
}

function writeOutput(value: unknown, format: OutputFormat): void {
  process.stdout.write(format === "json"
    ? `${JSON.stringify(value, null, 2)}\n`
    : YAML.stringify(value));
}

function projectRoot(action: string): string {
  const project = findContextProjectRoot(process.cwd());
  if (project !== null) return project.projectRoot;
  throw new ContextError(ExitCode.WorkspaceStateError, `${action} requires a Context workspace`, {
    category: ErrorCategory.WorkspaceNotFound,
    next: "Run this command from a Context project after registering its sources.",
  });
}

async function readInput(path: string, label: string): Promise<unknown> {
  return readYamlOrJsonInput({
    path,
    label,
    missingNext: `Pass ${path === "-" ? "stdin" : "a payload file"}.`,
    readFailureNext: "Fix the input path or pass - for stdin, then retry.",
    parseFailureNext: "Fix the YAML/JSON payload and retry.",
  });
}

function requirementCommand(group: Command, name: string, description: string): Command {
  return group.command(name)
    .description(description)
    .option("--format <format>", "output format: json | yaml", "json");
}

export function registerProjectIndexerCommands(program: Command): void {
  const indexer = program.command("indexer")
    .description("Inspect, confirm, and apply Indexer requirements and Providers");

  requirementCommand(
    indexer,
    "capabilities",
    "Read the machine capability manifest shipped by this exact CLI release",
  ).action(async (...args: unknown[]) => {
    const options = commandOptions(args);
    writeOutput(await loadCliReleaseCapabilityManifest(), outputFormat(options));
  });

  registerIndexerMaterialAnswerCommands(indexer);
  registerIndexerRequirementGateCommands(indexer);
  registerIndexerSubjectIdentityCommands(indexer);
  registerIndexerMarkdownProviderCommands(indexer);
  registerIndexerAuditCommands(indexer);
  registerIndexerProfileAuditCommands(indexer);

  requirementCommand(
    indexer,
    "catalog",
    "List only the Indexer entry Skills shipped by this exact CLI release",
  )
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      writeOutput(await listCliBundledIndexers(), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "inspect-index-requirements",
    "Normalize and validate an IndexRequirementSet against registered source boundaries",
  )
    .requiredOption("--input <file>", "inspection payload path, or - for stdin")
    .option("--view <view>", "output view: full | summary", "full")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      const result = await inspectProjectIndexerRequirements({
        projectRoot: projectRoot("inspect-index-requirements"),
        value: await readInput(inputPath, "inspect-index-requirements"),
      });
      const view = stringOption(options, "view") ?? "full";
      if (view !== "full" && view !== "summary") {
        throw new ContextError(ExitCode.UserError, "--view must be full or summary", {
          category: ErrorCategory.UserInputInvalid,
          flag: "--view",
        });
      }
      writeOutput(view === "summary" ? {
        protocol: "context.indexer.requirement-summary-view/v1",
        project_ref: result.project_ref,
        requirement_set_digest: result.requirement_set_digest,
        source_boundary_digest: result.source_boundary_digest,
        scenarios: result.summary,
      } : result, outputFormat(options));
    });

  requirementCommand(
    indexer,
    "compare-index-requirements",
    "Compare an inspected target against the currently applied requirement set",
  )
    .requiredOption("--input <file>", "requirement inspection path, or - for stdin")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await compareProjectIndexerRequirements({
        projectRoot: projectRoot("compare-index-requirements"),
        inspection: await readInput(inputPath, "compare-index-requirements"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "confirm-index-requirements",
    "Confirm one exact requirement workset with managed or human authority",
  )
    .requiredOption("--input <file>", "requirement workset report path, or - for stdin")
    .requiredOption("--authority <authority>", "managed | human")
    .requiredOption("--confirmed-by <identity>", "stable confirming authority identity")
    .option("--confirmed-at <timestamp>", "RFC 3339 confirmation timestamp")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      const authority = requiredStringOption(options, "authority", "--authority");
      if (authority !== "managed" && authority !== "human") {
        throw new ContextError(ExitCode.UserError, "--authority must be managed or human", {
          category: ErrorCategory.UserInputInvalid,
          flag: "--authority",
        });
      }
      const report = validateIndexerRequirementWorksetReport(
        await readInput(inputPath, "confirm-index-requirements"),
      );
      writeOutput(confirmIndexerRequirementWorkset({
        report,
        authority,
        confirmed_by: requiredStringOption(options, "confirmedBy", "--confirmed-by"),
        confirmed_at: stringOption(options, "confirmedAt") ?? new Date().toISOString(),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "apply-index-requirements",
    "Atomically write an inspected, compared, and confirmed requirement target",
  )
    .requiredOption("--inspection <file>", "requirement inspection path")
    .requiredOption("--report <file>", "requirement workset report path")
    .requiredOption("--confirmation <file>", "requirement workset confirmation path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inspectionPath = requiredStringOption(options, "inspection", "--inspection");
      const reportPath = requiredStringOption(options, "report", "--report");
      const confirmationPath = requiredStringOption(options, "confirmation", "--confirmation");
      writeOutput(await applyProjectIndexerRequirements({
        projectRoot: projectRoot("apply-index-requirements"),
        inspection: await readInput(inspectionPath, "apply-index-requirements inspection"),
        report: await readInput(reportPath, "apply-index-requirements report"),
        confirmation: await readInput(
          confirmationPath,
          "apply-index-requirements confirmation",
        ),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "route-indexer-provider-selection",
    "Route multi-Skill selection, community fallback, owner conflicts, and capability gaps",
  )
    .requiredOption("--input <file>", "Provider route input path, or - for stdin")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await routeProjectIndexerProviderSelection({
        projectRoot: projectRoot("route-indexer-provider-selection"),
        value: await readInput(inputPath, "route-indexer-provider-selection"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "validate-indexer-customization",
    "Validate and content-address stage one CLI gap-bound customization draft",
  )
    .requiredOption("--input <file>", "customization draft path, or - for stdin")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await validateAndStageProjectIndexerCustomizationDraft({
        projectRoot: projectRoot("validate-indexer-customization"),
        draft: await readInput(inputPath, "validate-indexer-customization"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "prepare-indexer-customization-project",
    "Finalize staged customization selection and stage one exact project proposal",
  )
    .requiredOption("--input <file>", "customization project preparation input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await prepareProjectIndexerCustomizationProposal({
        projectRoot: projectRoot("prepare-indexer-customization-project"),
        value: await readInput(inputPath, "prepare-indexer-customization-project"),
      }), outputFormat(options));
    });

  const lifecycleActions = [
    {
      name: "build-question-target-inventory",
      description: "Build the contract-derived question target denominator",
      run: buildProjectIndexerQuestionTargetInventory,
    },
    {
      name: "build-main-index-partition-worksets",
      description: "Build immutable main-index partition worksets and their set",
      run: buildProjectIndexerMainPartitionWorksets,
    },
    {
      name: "validate-main-index-run",
      description: "Validate one partition or author run and emit its accepted record",
      run: validateProjectIndexerMainRun,
    },
    {
      name: "build-subject-catalog",
      description: "Merge approved Nodes with fully validated partition subjects",
      run: buildProjectIndexerSubjectCatalog,
    },
    {
      name: "build-target-resolution-views",
      description: "Resolve exact enrich-or-independent SubjectKey queries",
      run: buildProjectIndexerTargetResolutionViews,
    },
    {
      name: "build-main-index-author-worksets",
      description: "Build one immutable author workset per validated partition group",
      run: buildProjectIndexerMainAuthorWorksets,
    },
    {
      name: "audit-projected-artifact-fan-out",
      description: "Audit projected Artifact ownership before Candidate materialization",
      run: auditProjectIndexerProjectedArtifactFanOut,
    },
    {
      name: "compile-indexer-candidates",
      description: "Compile Candidate Artifacts from the exact accepted author IndexerResult set",
      run: compileProjectIndexerCandidates,
    },
    {
      name: "report-indexer-incremental-impact",
      description: "Report exact Artifact and Section impact from current Merkle dependencies",
      run: reportProjectIndexerIncrementalImpact,
    },
  ] as const;
  for (const action of lifecycleActions) {
    requirementCommand(indexer, action.name, action.description)
      .requiredOption("--input <file>", `${action.name} input path, or - for stdin`)
      .action(async (...args: unknown[]) => {
        const options = commandOptions(args);
        const inputPath = requiredStringOption(options, "input", "--input");
        writeOutput(await action.run({
          projectRoot: projectRoot(action.name),
          value: await readInput(inputPath, action.name),
        }), outputFormat(options));
      });
  }

  requirementCommand(
    indexer,
    "reconcile-indexer-results",
    "Reconcile accepted primary results into authoritative coverage and material gaps",
  )
    .requiredOption("--input <file>", "reconcile-indexer-results input path, or - for stdin")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await reconcileProjectIndexerResults({
        projectRoot: projectRoot("reconcile-indexer-results"),
        value: await readInput(inputPath, "reconcile-indexer-results"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "report-benchmark",
    "Build a digest-bound forward-test report from an independently loaded oracle",
  )
    .requiredOption("--manifest <file>", "benchmark manifest path")
    .requiredOption("--current <file>", "current source and toolchain authority path")
    .requiredOption("--observation <file>", "post-run structured observation path")
    .requiredOption("--oracle <file>", "read-only oracle evaluation outside the Agent workspace")
    .requiredOption("--override <file>", "explicit none or human-approved override path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const manifestPath = requiredStringOption(options, "manifest", "--manifest");
      const currentPath = requiredStringOption(options, "current", "--current");
      const observationPath = requiredStringOption(options, "observation", "--observation");
      const oraclePath = requiredStringOption(options, "oracle", "--oracle");
      const overridePath = requiredStringOption(options, "override", "--override");
      writeOutput(await reportProjectIndexerBenchmark({
        projectRoot: projectRoot("report-benchmark"),
        oraclePath,
        manifest: await readInput(manifestPath, "report-benchmark manifest"),
        currentAuthority: await readInput(currentPath, "report-benchmark current authority"),
        observation: await readInput(observationPath, "report-benchmark observation"),
        oracleEvaluation: await readInput(oraclePath, "report-benchmark oracle evaluation"),
        override: await readInput(overridePath, "report-benchmark override"),
      }), outputFormat(options));
    });

  const mainRunStoreActions = [
    {
      name: "prepare-main-index-run-ledger",
      description: "Recover the content-addressed main run ledger and cache hits",
      run: prepareProjectIndexerMainRunStore,
    },
    {
      name: "start-main-index-run",
      description: "Persist one pending main workset as running and issue its exact request",
      run: startProjectIndexerMainRunStore,
    },
    {
      name: "converge-main-index-partition-run",
      description: "Accept a semantic partition or durably advance its next strategy",
      run: convergeProjectIndexerMainPartitionRunStore,
    },
    {
      name: "build-main-index-catalog-fallback",
      description: "Build and accept the deterministic catalog fallback without an Agent run",
      run: buildProjectIndexerCatalogFallback,
    },
    {
      name: "accept-main-index-run",
      description: "Atomically accept a validated main Result, receipts, and ledger transition",
      run: acceptProjectIndexerMainRunStore,
    },
    {
      name: "fail-main-index-run",
      description: "Persist one exact main workset failure and dependency set",
      run: failProjectIndexerMainRunStore,
    },
    {
      name: "observe-main-index-run-ledger",
      description: "Publish current main counts and next refs from the persisted ledger",
      run: observeProjectIndexerMainRunStore,
    },
  ] as const;
  for (const action of mainRunStoreActions) {
    requirementCommand(indexer, action.name, action.description)
      .requiredOption("--input <file>", `${action.name} input path, or - for stdin`)
      .action(async (...args: unknown[]) => {
        const options = commandOptions(args);
        const inputPath = requiredStringOption(options, "input", "--input");
        writeOutput(await action.run({
          projectRoot: projectRoot(action.name),
          value: await readInput(inputPath, action.name),
        }), outputFormat(options));
      });
  }

  requirementCommand(
    indexer,
    "observe-main-index-worksets",
    "Join the current main workset set with run records and publish Graph Facts",
  )
    .requiredOption("--input <file>", "main workset observation input path, or - for stdin")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(observeProjectIndexerMainWorksets(
        await readInput(inputPath, "observe-main-index-worksets"),
      ), outputFormat(options));
    });

  const postAuthorActions = [
    {
      name: "resolve-effective-composers",
      description: "Resolve selected, declared, and current-profile composers",
      run: resolveProjectIndexerEffectiveComposers,
    },
    {
      name: "build-post-author-composer-worksets",
      description: "Materialize PrimaryResultView and independent composer worksets",
      run: buildProjectIndexerPostAuthorWorksets,
    },
    {
      name: "start-post-author-composer-run",
      description: "Start one pending or stale composer workset and issue its request",
      run: startProjectIndexerPostAuthorRun,
    },
    {
      name: "accept-post-author-composer-run",
      description: "Validate and accept one exact post-author fragment Result",
      run: acceptProjectIndexerPostAuthorRun,
    },
    {
      name: "fail-post-author-composer-run",
      description: "Record one exact post-author composer failure",
      run: failProjectIndexerPostAuthorRun,
    },
    {
      name: "observe-post-author-composer-worksets",
      description: "Publish post-author counts, next refs, receipts, and envelope state",
      run: observeProjectIndexerPostAuthorState,
    },
    {
      name: "compose-indexer-post-author-fragments",
      description: "Compose a current envelope only after every composer Result is accepted",
      run: composeProjectIndexerPostAuthorEnvelope,
    },
  ] as const;
  for (const action of postAuthorActions) {
    requirementCommand(indexer, action.name, action.description)
      .requiredOption("--input <file>", `${action.name} input path, or - for stdin`)
      .action(async (...args: unknown[]) => {
        const options = commandOptions(args);
        const inputPath = requiredStringOption(options, "input", "--input");
        writeOutput(await action.run({
          projectRoot: projectRoot(action.name),
          value: await readInput(inputPath, action.name),
        }), outputFormat(options));
      });
  }

  requirementCommand(
    indexer,
    "validate-indexer-selection-proposal",
    "Statically validate Provider ownership and requests before resolving any Bundle",
  )
    .requiredOption("--input <file>", "selection proposal input path, or - for stdin")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await validateProjectIndexerSelectionProposal({
        projectRoot: projectRoot("validate-indexer-selection-proposal"),
        value: await readInput(inputPath, "validate-indexer-selection-proposal"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "resolve-indexer-providers",
    "Dispatch one statically authorized Provider request to the CLI or current Host",
  )
    .requiredOption("--selection <file>", "selection proposal input path")
    .requiredOption("--input <file>", "exact resolution request path")
    .option("--host-result <file>", "Agent Graph Host Action result path")
    .option("--host-output <file>", "managed Host output payload path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const selectionPath = requiredStringOption(options, "selection", "--selection");
      const inputPath = requiredStringOption(options, "input", "--input");
      const hostResultPath = stringOption(options, "hostResult");
      const hostOutputPath = stringOption(options, "hostOutput");
      if (hostOutputPath !== undefined && hostResultPath === undefined) {
        throw new ContextError(ExitCode.UserError, "--host-output requires --host-result", {
          category: ErrorCategory.UserInputInvalid,
          flag: "--host-output",
        });
      }
      const hostResult = hostResultPath === undefined
        ? undefined
        : await readInput(hostResultPath, "resolve-indexer-providers Host result") as HostActionResult;
      const managedOutput = hostOutputPath === undefined
        ? undefined
        : await readInput(
            hostOutputPath,
            "resolve-indexer-providers managed output",
          ) as IndexerProviderHostManagedOutput;
      writeOutput(await dispatchProjectIndexerProviderResolution({
        projectRoot: projectRoot("resolve-indexer-providers"),
        selection: await readInput(selectionPath, "resolve-indexer-providers selection"),
        request: await readInput(inputPath, "resolve-indexer-providers request"),
        ...(hostResult === undefined ? {} : { host_result: hostResult }),
        ...(managedOutput === undefined ? {} : { managed_output: managedOutput }),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "stage-indexer-provider-bundle",
    "Copy one resolved Provider envelope into content-addressed runtime staging",
  )
    .requiredOption("--selection <file>", "selection proposal input path")
    .requiredOption("--request <file>", "exact resolution request path")
    .requiredOption("--input <file>", "completed Provider resolution output path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const selectionPath = requiredStringOption(options, "selection", "--selection");
      const requestPath = requiredStringOption(options, "request", "--request");
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await stageProjectIndexerProviderResolution({
        projectRoot: projectRoot("stage-indexer-provider-bundle"),
        selection: await readInput(selectionPath, "stage-indexer-provider-bundle selection"),
        request: await readInput(requestPath, "stage-indexer-provider-bundle request"),
        resolution: await readInput(inputPath, "stage-indexer-provider-bundle resolution"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "stage-indexer-project-proposal",
    "Validate and stage one content-addressed registry/customization proposal without source writes",
  )
    .requiredOption("--input <file>", "project proposal input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await stageProjectIndexerProposal({
        projectRoot: projectRoot("stage-indexer-project-proposal"),
        proposal: await readInput(inputPath, "stage-indexer-project-proposal"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "authorize-indexer-dependencies",
    "Authorize and lock one exact staged dependency intent set with install scripts disabled",
  )
    .requiredOption("--proposal <digest>", "staged proposal digest")
    .requiredOption("--input <file>", "exact dependency resolution input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const proposalDigest = requiredStringOption(options, "proposal", "--proposal");
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await authorizeProjectIndexerDependencies({
        projectRoot: projectRoot("authorize-indexer-dependencies"),
        proposal_digest: proposalDigest,
        resolution: await readInput(inputPath, "authorize-indexer-dependencies"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "authorize-indexer-program-execution",
    "Authorize one exact non-allowlisted Provider program for trusted execution",
  )
    .requiredOption("--input <file>", "digest-bound program authorization input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      projectRoot("authorize-indexer-program-execution");
      writeOutput(authorizeProjectIndexerProgramExecution(
        await readInput(inputPath, "authorize-indexer-program-execution"),
      ), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "validate-indexer-contract-overlays",
    "Recompute one data-only contract overlay and resolve its exact trust path",
  )
    .requiredOption("--input <file>", "digest-bound overlay validation input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      projectRoot("validate-indexer-contract-overlays");
      writeOutput(validateProjectIndexerContractOverlay(
        await readInput(inputPath, "validate-indexer-contract-overlays"),
      ), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "authorize-indexer-contract-overlay",
    "Authorize one exact current-project data-only overlay after conformance passes",
  )
    .requiredOption("--input <file>", "digest-bound overlay authorization input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      projectRoot("authorize-indexer-contract-overlay");
      writeOutput(authorizeProjectIndexerContractOverlay(
        await readInput(inputPath, "authorize-indexer-contract-overlay"),
      ), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "propose-overlay-question-amendment",
    "Propose namespaced question bindings only from one current trusted overlay",
  )
    .requiredOption("--input <file>", "trusted overlay question proposal input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      projectRoot("propose-overlay-question-amendment");
      writeOutput(proposeProjectIndexerOverlayQuestionAmendment(
        await readInput(inputPath, "propose-overlay-question-amendment"),
      ), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "confirm-overlay-question-amendment",
    "Confirm one exact overlay question amendment without writing project state",
  )
    .requiredOption("--input <file>", "overlay question amendment path")
    .requiredOption("--authority <authority>", "managed | human")
    .requiredOption("--confirmed-by <identity>", "stable confirming authority identity")
    .option("--confirmed-at <timestamp>", "RFC 3339 confirmation timestamp")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const authority = requiredStringOption(options, "authority", "--authority");
      if (authority !== "managed" && authority !== "human") {
        throw new ContextError(ExitCode.UserError, "--authority must be managed or human", {
          category: ErrorCategory.UserInputInvalid,
          flag: "--authority",
        });
      }
      const inputPath = requiredStringOption(options, "input", "--input");
      projectRoot("confirm-overlay-question-amendment");
      writeOutput(confirmProjectIndexerOverlayQuestionAmendment({
        amendment: await readInput(inputPath, "confirm-overlay-question-amendment"),
        authority,
        confirmed_by: requiredStringOption(options, "confirmedBy", "--confirmed-by"),
        confirmed_at: stringOption(options, "confirmedAt") ?? new Date().toISOString(),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "rebind-indexer-selection-to-requirement",
    "Revalidate an overlay question target and build one coupled registry proposal",
  )
    .requiredOption("--input <file>", "digest-bound overlay question rebind input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await rebindProjectIndexerSelectionToOverlayRequirement({
        projectRoot: projectRoot("rebind-indexer-selection-to-requirement"),
        value: await readInput(inputPath, "rebind-indexer-selection-to-requirement"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "apply-indexer-project",
    "Revalidate staged Providers and atomically apply one exact project proposal",
  )
    .requiredOption("--proposal <digest>", "staged proposal digest")
    .requiredOption("--validation-input <file>", "current finalized selection validation input")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const proposalDigest = requiredStringOption(options, "proposal", "--proposal");
      const validationPath = requiredStringOption(
        options,
        "validationInput",
        "--validation-input",
      );
      writeOutput(await applyProjectIndexerProposal({
        projectRoot: projectRoot("apply-indexer-project"),
        proposal_digest: proposalDigest,
        validation: await readInput(validationPath, "apply-indexer-project validation"),
      }), outputFormat(options));
    });

  requirementCommand(
    indexer,
    "observe-indexer-project",
    "Observe the complete applied target set and rerun finalized selection validation",
  )
    .requiredOption("--input <file>", "apply receipt and staging validation input path")
    .action(async (...args: unknown[]) => {
      const options = commandOptions(args);
      const inputPath = requiredStringOption(options, "input", "--input");
      writeOutput(await observeProjectIndexerApply({
        projectRoot: projectRoot("observe-indexer-project"),
        value: await readInput(inputPath, "observe-indexer-project"),
      }), outputFormat(options));
    });
}
