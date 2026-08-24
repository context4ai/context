import { resolve } from "node:path";
import { DEFAULT_PATH_FILTER } from "@c4a/core";
import type {
  ExtractCustomPhaseDefinition,
  ExtractTsPhaseDefinition,
  RepoProjectSourceDefinition,
} from "@c4a/context";
import { detectModuleBoundaries, type ModuleBoundaryResult } from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { SourceSelection } from "./extractCandidateTypes.js";
import { diagnoseRepoSource, ensureRepoSource, listRepoSources } from "./repoSources.js";

async function selectRepoSourcesForDefinition(input: {
  projectRoot: string;
  source: RepoProjectSourceDefinition;
  materialize: boolean;
}): Promise<SourceSelection[]> {
  if (input.source.kind === "source.repo") {
    const status = input.materialize
      ? await ensureRepoSource({ projectRoot: input.projectRoot, source: input.source })
      : await diagnoseRepoSource({ projectRoot: input.projectRoot, source: input.source });
    return [{ record: input.source, status }];
  }

  const records = await listRepoSources(input.projectRoot);
  const selected = input.source.kind === "source.collection"
    ? records
    : (() => {
        const requestedSource = input.source;
        return records.filter((source) => source.name === requestedSource.name || source.id === requestedSource.name);
      })();

  if (input.source.kind === "source.collection" && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, "no repo sources are registered for extraction", {
      category: ErrorCategory.SourceNotFound,
      sourceType: input.source.type,
      code: "repo-source-registration-required",
      next: "context status --format json",
    });
  }

  if (input.source.kind === "source.ref" && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `repo source is not registered: ${input.source.name}`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: input.source.name,
    });
  }

  return Promise.all(selected.map(async (record) => ({
    record,
    status: input.materialize
      ? await ensureRepoSource({ projectRoot: input.projectRoot, source: record })
      : await diagnoseRepoSource({ projectRoot: input.projectRoot, source: record }),
  })));
}

export async function selectRepoSourcesForExtraction(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition;
  materialize: boolean;
}): Promise<SourceSelection[]> {
  const definitions = input.phase.kind === "phase.extract.ts"
    ? [input.phase.source]
    : input.phase.sources;
  const selected = (await Promise.all(definitions.map((source) => selectRepoSourcesForDefinition({
    projectRoot: input.projectRoot,
    source,
    materialize: input.materialize,
  })))).flat();
  return [...new Map(selected.map((source) => [source.record.name, source])).values()]
    .sort((left, right) => left.record.name.localeCompare(right.record.name));
}

export async function selectRepoSources(input: {
  projectRoot: string;
  phase: ExtractTsPhaseDefinition;
  materialize: boolean;
}): Promise<SourceSelection[]> {
  return selectRepoSourcesForExtraction(input);
}

export function assertReadyExtractionSources(sources: readonly SourceSelection[]): void {
  const notReady = sources.filter((source) => !source.status.ready);
  if (notReady.length > 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, "repo source is not ready for extraction", {
      category: ErrorCategory.WorkspaceStateInvalid,
      sources: notReady.map((source) => ({
        name: source.record.name,
        diagnostics: source.status.diagnostics,
        agent_hints: source.status.agent_hints,
      })),
    });
  }
}

async function inspectSourceModules(input: {
  projectRoot: string;
  source: SourceSelection;
}): Promise<{
  source: SourceSelection;
  modules: ModuleBoundaryResult[];
}> {
  const repoPath = resolve(input.projectRoot, input.source.status.materializedAt);
  return {
    source: input.source,
    modules: await detectModuleBoundaries(
      repoPath,
      input.source.status.head ?? input.source.status.ref,
      DEFAULT_PATH_FILTER,
    ),
  };
}

export async function assertSingleModuleSourceBoundaries(input: {
  projectRoot: string;
  sources: readonly SourceSelection[];
}): Promise<void> {
  const inspections = await Promise.all(input.sources.map((source) => inspectSourceModules({
    projectRoot: input.projectRoot,
    source,
  })));
  const ambiguous = inspections.filter((inspection) => inspection.modules.length > 1);
  if (ambiguous.length === 0) return;

  throw new ContextError(
    ExitCode.UserError,
    "repo source contains multiple code modules; register the intended package or subdirectory as its own source before extraction",
    {
      category: ErrorCategory.UserInputInvalid,
      code: "extract-source-scope-ambiguous",
      sources: ambiguous.map((inspection) => ({
        name: inspection.source.record.name,
        materializedAt: inspection.source.status.materializedAt,
        modules: inspection.modules.map((module) => ({
          name: module.name,
          path: module.path,
        })),
      })),
      next: "context status --format json",
    },
  );
}
