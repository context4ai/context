import {
  buildIndexerEvidenceAdapterResult,
  createIndexerEvidenceAdapterFact,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterProtocolDigest,
  materializeIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterFact,
  type IndexerEvidenceAdapterMaterialization,
  type IndexerEvidenceAdapterResult,
} from "@c4a/core";
import type { RushProjectIndex, RushWorkspaceIndex } from "./index.js";

export interface RushEvidenceAdapterInvocation {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  input_digest: string;
  precedence: number;
  workspace_module_ref: string | null;
  project_module_refs: Readonly<Record<string, string>>;
  role?: "primary-owner" | "enricher";
}

interface RushEvidenceFile {
  normalizedPath: string;
  moduleRef: string | null;
  facts: IndexerEvidenceAdapterFact[];
}

function projectPayload(project: RushProjectIndex): unknown {
  return {
    packageName: project.packageName,
    packageNameMatches: project.packageNameMatches,
    projectFolder: project.projectFolder,
    subspaceName: project.subspaceName,
    tags: project.tags,
    shouldPublish: project.shouldPublish,
    versionPolicyName: project.versionPolicyName,
    publishFolder: project.publishFolder,
    releaseUnitRef: project.releaseUnitRef,
    workspaceDependents: project.workspaceDependents,
  };
}

/** Converts the Rush structural catalog into the same ABI used by language parsers. */
export function rushWorkspaceIndexToEvidenceAdapterResult(
  index: RushWorkspaceIndex,
  invocation: RushEvidenceAdapterInvocation,
): IndexerEvidenceAdapterResult {
  const allowedModules = new Set(invocation.authorized_scope.module_refs);
  const assertAllowedModule = (moduleRef: string | null): void => {
    if (moduleRef !== null && !allowedModules.has(moduleRef)) {
      throw new TypeError(`Rush Evidence ABI module ${moduleRef} escapes authorized scope`);
    }
  };
  assertAllowedModule(invocation.workspace_module_ref);
  for (const moduleRef of Object.values(invocation.project_module_refs)) {
    assertAllowedModule(moduleRef);
  }

  const role = invocation.role ?? "primary-owner";
  const ownsDenominators = role === "primary-owner";
  const files = new Map<string, RushEvidenceFile>();
  const ensureFile = (normalizedPath: string, moduleRef: string | null): RushEvidenceFile => {
    const current = files.get(normalizedPath);
    if (current) {
      if (current.moduleRef !== moduleRef) {
        throw new TypeError(`Rush evidence file ${normalizedPath} has conflicting module owners`);
      }
      return current;
    }
    const created = { normalizedPath, moduleRef, facts: [] };
    files.set(normalizedPath, created);
    return created;
  };
  const addFact = (
    file: RushEvidenceFile,
    input: {
      qualifiedItemPath: string;
      kind: string;
      signature: unknown;
      payload: unknown;
      denominator: IndexerEvidenceAdapterFact["denominator"];
    },
  ): void => {
    file.facts.push(createIndexerEvidenceAdapterFact({
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: file.moduleRef,
      normalized_path: file.normalizedPath,
      qualified_item_path: input.qualifiedItemPath,
      kind: input.kind,
      signature: input.signature,
      payload: input.payload,
      denominator: ownsDenominators ? input.denominator : "none",
    }));
  };

  const workspaceFile = ensureFile(index.rushFile, invocation.workspace_module_ref);
  addFact(workspaceFile, {
    qualifiedItemPath: "workspace",
    kind: "rush-workspace",
    signature: { rushFile: index.rushFile },
    payload: {
      rushVersion: index.rushVersion,
      pnpmVersion: index.pnpmVersion,
      nodeSupportedVersionRange: index.nodeSupportedVersionRange,
      selectedTags: index.selectedTags,
    },
    denominator: "protocol-item",
  });

  const subspacesFile = index.subspacesFile === null
    ? workspaceFile
    : ensureFile(index.subspacesFile, invocation.workspace_module_ref);
  index.subspaces.forEach((subspace) => addFact(subspacesFile, {
    qualifiedItemPath: `subspace:${subspace.name}`,
    kind: "rush-subspace",
    signature: { name: subspace.name },
    payload: {
      ...subspace,
      enabled: index.subspacesEnabled,
      preventSelectingAllSubspaces: index.preventSelectingAllSubspaces,
    },
    denominator: "protocol-item",
  }));

  if (index.commandLineFile !== null) {
    const commandLineFile = ensureFile(
      index.commandLineFile,
      invocation.workspace_module_ref,
    );
    index.buildPhases.forEach((phase) => addFact(commandLineFile, {
      qualifiedItemPath: `phase:${phase.name}`,
      kind: "rush-build-phase",
      signature: {
        name: phase.name,
        selfDependencies: phase.selfDependencies,
        upstreamDependencies: phase.upstreamDependencies,
      },
      payload: phase,
      denominator: "protocol-item",
    }));
    index.buildCommands.forEach((command) => addFact(commandLineFile, {
      qualifiedItemPath: `command:${command.name}`,
      kind: "rush-build-command",
      signature: {
        name: command.name,
        commandKind: command.commandKind,
        phases: command.phases,
      },
      payload: command,
      denominator: "protocol-item",
    }));
  }

  const releaseFile = index.versionPoliciesFile === null
    ? workspaceFile
    : ensureFile(index.versionPoliciesFile, invocation.workspace_module_ref);
  index.releaseUnits.forEach((unit) => addFact(releaseFile, {
    qualifiedItemPath: `release-unit:${unit.unitRef}`,
    kind: "rush-release-unit",
    signature: { unitRef: unit.unitRef, mode: unit.mode },
    payload: unit,
    denominator: "protocol-item",
  }));

  const diagnostics: IndexerEvidenceAdapterResult["diagnostics"] = [];
  for (const project of index.projects) {
    const projectModuleRef = invocation.project_module_refs[project.projectFolder]
      ?? invocation.workspace_module_ref;
    assertAllowedModule(projectModuleRef);
    const projectFile = project.packageJsonFile
      ? ensureFile(project.packageJsonFile, projectModuleRef)
      : workspaceFile;
    addFact(projectFile, {
      qualifiedItemPath: `project:${project.packageName}`,
      kind: "rush-project",
      signature: { packageName: project.packageName, projectFolder: project.projectFolder },
      payload: projectPayload(project),
      denominator: "protocol-item",
    });
    project.entrySignals.forEach((signal) => addFact(projectFile, {
      qualifiedItemPath: `project:${project.packageName}:entry:${signal}`,
      kind: "rush-entry-signal",
      signature: { packageName: project.packageName, signal },
      payload: { signal },
      denominator: "protocol-item",
    }));
    project.workspaceDependencies.forEach((dependency) => addFact(projectFile, {
      qualifiedItemPath: `project:${project.packageName}:dependency:${dependency.packageName}`,
      kind: "rush-workspace-dependency",
      signature: {
        packageName: project.packageName,
        dependency: dependency.packageName,
        kinds: dependency.kinds,
      },
      payload: dependency,
      denominator: "protocol-item",
    }));
    project.workspaceDependents.forEach((dependent) => addFact(projectFile, {
      qualifiedItemPath: `project:${project.packageName}:dependent:${dependent}`,
      kind: "rush-workspace-dependent",
      signature: { packageName: project.packageName, dependent },
      payload: { packageName: project.packageName, dependent },
      denominator: "protocol-item",
    }));
    if (!project.packageJsonFile || !project.packageNameMatches) {
      diagnostics.push({
        code: project.packageJsonFile
          ? "rush-package-name-mismatch"
          : "rush-package-manifest-missing",
        severity: "warning",
        fact_ref: indexerEvidenceAdapterFileRef({
          source_ref: invocation.authorized_scope.source_ref,
          module_ref: projectFile.moduleRef,
          normalized_path: projectFile.normalizedPath,
        }),
        detail_digest: indexerEvidenceAdapterProtocolDigest(projectPayload(project)),
      });
    }
  }

  for (const diagnostic of index.diagnostics) {
    diagnostics.push({
      code: diagnostic.code,
      severity: "warning",
      fact_ref: indexerEvidenceAdapterFileRef({
        source_ref: invocation.authorized_scope.source_ref,
        module_ref: workspaceFile.moduleRef,
        normalized_path: workspaceFile.normalizedPath,
      }),
      detail_digest: indexerEvidenceAdapterProtocolDigest(diagnostic),
    });
  }

  for (const boundary of index.ownerBoundaries) {
    const ownerFile = ensureFile(boundary.file, invocation.workspace_module_ref);
    addFact(ownerFile, {
      qualifiedItemPath: "owner-boundary",
      kind: "rush-owner-boundary",
      signature: { file: boundary.file },
      payload: boundary,
      denominator: "protocol-item",
    });
  }

  const evidenceFiles = [...files.values()].map((file) => {
    addFact(file, {
      qualifiedItemPath: "file",
      kind: "source-file",
      signature: { path: file.normalizedPath, catalog: "rush" },
      payload: { path: file.normalizedPath },
      denominator: "eligible-file",
    });
    return {
      file_ref: indexerEvidenceAdapterFileRef({
        source_ref: invocation.authorized_scope.source_ref,
        module_ref: file.moduleRef,
        normalized_path: file.normalizedPath,
      }),
      source_ref: invocation.authorized_scope.source_ref,
      module_ref: file.moduleRef,
      normalized_path: file.normalizedPath,
      role,
      coverage_tier: "ast-catalog" as const,
      disposition: "analyzed" as const,
      facts: file.facts,
    };
  });
  const parserOutputDigest = indexerEvidenceAdapterProtocolDigest(index);
  return buildIndexerEvidenceAdapterResult({
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: invocation.adapter,
    authorized_scope: invocation.authorized_scope,
    input_digest: invocation.input_digest,
    precedence: invocation.precedence,
    files: evidenceFiles,
    diagnostics,
    toolchain: [{
      step: "parse-rush-workspace",
      package: invocation.adapter.package,
      export: invocation.adapter.export,
      version: invocation.adapter.version,
      digest: invocation.adapter.digest,
      capabilities: [
        "parser.rush",
        "rush-build-commands",
        "rush-entry-signals",
        "rush-build-phases",
        "rush-release-units",
        "rush-subspaces",
        "rush-owner-boundaries",
        "rush-workspace-dependencies",
        "rush-workspace-topology",
      ],
      input_digest: invocation.input_digest,
      output_digest: parserOutputDigest,
    }],
  });
}

/** Builds the Rush wire result and its process-local structured fact sidecar. */
export function rushWorkspaceIndexToEvidenceAdapterMaterialization(
  index: RushWorkspaceIndex,
  invocation: RushEvidenceAdapterInvocation,
): IndexerEvidenceAdapterMaterialization {
  return materializeIndexerEvidenceAdapterResult(
    rushWorkspaceIndexToEvidenceAdapterResult(index, invocation),
  );
}
