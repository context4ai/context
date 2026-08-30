import { createHash } from "node:crypto";
import {
  readOptionalRushJsonc,
  readOptionalRushJsoncValue,
} from "./rushJsonc.js";

export const RUSH_SUBSPACES_FILE = "common/config/rush/subspaces.json";
export const RUSH_COMMAND_LINE_FILE = "common/config/rush/command-line.json";
export const RUSH_VERSION_POLICIES_FILE = "common/config/rush/version-policies.json";

interface RushSubspacesConfig {
  subspacesEnabled?: boolean;
  preventSelectingAllSubspaces?: boolean;
  subspaceNames?: unknown[];
}

interface RushPhaseConfig {
  name?: unknown;
  dependencies?: {
    self?: unknown[];
    upstream?: unknown[];
  };
  ignoreMissingScript?: boolean;
  allowWarningsOnSuccess?: boolean;
}

interface RushCommandConfig {
  name?: unknown;
  commandKind?: unknown;
  phases?: unknown[];
  shellCommand?: unknown;
  ignoreDependencyOrder?: boolean;
  ignoreMissingScript?: boolean;
  enableParallelism?: boolean;
  incremental?: boolean;
}

interface RushCommandLineConfig {
  phases?: RushPhaseConfig[];
  commands?: RushCommandConfig[];
}

interface RushVersionPolicyConfig {
  policyName?: unknown;
  definitionName?: unknown;
  mainProject?: unknown;
}

export interface RushWorkspaceFactProject {
  packageName: string;
  subspaceName: string;
  shouldPublish: boolean;
  versionPolicyName: string | null;
  scripts: Readonly<Record<string, string>>;
}

export interface RushSubspaceIndex {
  name: string;
  registered: boolean;
  projectNames: string[];
}

export interface RushBuildPhaseImplementation {
  packageName: string;
  scriptDefined: boolean;
  scriptDigest: string | null;
}

export interface RushBuildPhaseIndex {
  name: string;
  selfDependencies: string[];
  upstreamDependencies: string[];
  ignoreMissingScript: boolean;
  allowWarningsOnSuccess: boolean;
  projectImplementations: RushBuildPhaseImplementation[];
}

export interface RushBuildCommandIndex {
  name: string;
  commandKind: "bulk" | "global" | "phased";
  phases: string[];
  usesShellCommand: boolean;
  shellCommandDigest: string | null;
  ignoreDependencyOrder: boolean;
  ignoreMissingScript: boolean;
  enableParallelism: boolean;
  incremental: boolean;
}

export interface RushReleaseUnitIndex {
  unitRef: string;
  mode: "lock-step" | "individual" | "standalone";
  policyName: string | null;
  definitionName: "lockStepVersion" | "individualVersion" | null;
  mainProject: string | null;
  projectNames: string[];
}

export interface RushWorkspaceFactDiagnostic {
  code: "rush-subspace-unregistered" | "rush-version-policy-unresolved";
  projectName: string;
  value: string;
}

export interface RushWorkspaceFacts {
  subspacesFile: string | null;
  subspacesEnabled: boolean;
  preventSelectingAllSubspaces: boolean;
  subspaces: RushSubspaceIndex[];
  commandLineFile: string | null;
  buildPhases: RushBuildPhaseIndex[];
  buildCommands: RushBuildCommandIndex[];
  versionPoliciesFile: string | null;
  releaseUnits: RushReleaseUnitIndex[];
  projectReleaseUnitRefs: Readonly<Record<string, string | null>>;
  diagnostics: RushWorkspaceFactDiagnostic[];
}

function strings(value: unknown[] | undefined, label: string): string[] {
  const values = value ?? [];
  if (values.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`${label} must contain only non-empty strings`);
  }
  return [...new Set(values as string[])].sort();
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return requiredString(value, label);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function buildSubspaces(input: {
  config: RushSubspacesConfig | null;
  projects: readonly RushWorkspaceFactProject[];
}): Pick<
  RushWorkspaceFacts,
  "subspacesEnabled" | "preventSelectingAllSubspaces" | "subspaces" | "diagnostics"
> {
  const configured = strings(input.config?.subspaceNames, "Rush subspaceNames");
  const names = [...new Set(["default", ...configured])].sort();
  const registered = new Set(names);
  const projectNames = new Map<string, string[]>();
  const diagnostics: RushWorkspaceFactDiagnostic[] = [];
  for (const project of input.projects) {
    const members = projectNames.get(project.subspaceName) ?? [];
    members.push(project.packageName);
    projectNames.set(project.subspaceName, members);
    if (input.config?.subspacesEnabled === true && !registered.has(project.subspaceName)) {
      diagnostics.push({
        code: "rush-subspace-unregistered",
        projectName: project.packageName,
        value: project.subspaceName,
      });
      names.push(project.subspaceName);
    }
  }
  return {
    subspacesEnabled: input.config?.subspacesEnabled === true,
    preventSelectingAllSubspaces: input.config?.preventSelectingAllSubspaces === true,
    subspaces: [...new Set(names)].sort().map((name) => ({
      name,
      registered: registered.has(name),
      projectNames: [...new Set(projectNames.get(name) ?? [])].sort(),
    })),
    diagnostics,
  };
}

function buildPhases(input: {
  config: RushCommandLineConfig | null;
  projects: readonly RushWorkspaceFactProject[];
}): RushBuildPhaseIndex[] {
  return (input.config?.phases ?? []).map((phase) => {
    const name = requiredString(phase.name, "Rush phase name");
    if (!name.startsWith("_phase:")) {
      throw new TypeError(`Rush phase name must start with _phase:: ${name}`);
    }
    return {
      name,
      selfDependencies: strings(phase.dependencies?.self, `${name} self dependencies`),
      upstreamDependencies: strings(
        phase.dependencies?.upstream,
        `${name} upstream dependencies`,
      ),
      ignoreMissingScript: phase.ignoreMissingScript === true,
      allowWarningsOnSuccess: phase.allowWarningsOnSuccess === true,
      projectImplementations: input.projects.map((project) => {
        const script = project.scripts[name];
        return {
          packageName: project.packageName,
          scriptDefined: script !== undefined,
          scriptDigest: script === undefined ? null : digest(script),
        };
      }).sort((left, right) => left.packageName.localeCompare(right.packageName)),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function buildCommands(config: RushCommandLineConfig | null): RushBuildCommandIndex[] {
  return (config?.commands ?? []).map((command) => {
    const name = requiredString(command.name, "Rush command name");
    const kind = requiredString(command.commandKind, `${name} commandKind`);
    if (kind !== "bulk" && kind !== "global" && kind !== "phased") {
      throw new TypeError(`Rush command ${name} has unsupported commandKind ${kind}`);
    }
    const commandKind: RushBuildCommandIndex["commandKind"] = kind;
    const shellCommand = optionalString(command.shellCommand, `${name} shellCommand`);
    return {
      name,
      commandKind,
      phases: strings(command.phases, `${name} phases`),
      usesShellCommand: shellCommand !== null,
      shellCommandDigest: shellCommand === null ? null : digest(shellCommand),
      ignoreDependencyOrder: command.ignoreDependencyOrder === true,
      ignoreMissingScript: command.ignoreMissingScript === true,
      enableParallelism: command.enableParallelism === true,
      incremental: command.incremental === true,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function buildReleaseUnits(input: {
  policies: RushVersionPolicyConfig[] | null;
  projects: readonly RushWorkspaceFactProject[];
}): Pick<RushWorkspaceFacts, "releaseUnits" | "projectReleaseUnitRefs" | "diagnostics"> {
  const policies = new Map<string, {
    definitionName: "lockStepVersion" | "individualVersion";
    mainProject: string | null;
  }>();
  for (const policy of input.policies ?? []) {
    const name = requiredString(policy.policyName, "Rush version policy name");
    const definitionName = requiredString(
      policy.definitionName,
      `${name} definitionName`,
    );
    if (definitionName !== "lockStepVersion" && definitionName !== "individualVersion") {
      throw new TypeError(`Rush version policy ${name} has unsupported definition ${definitionName}`);
    }
    if (policies.has(name)) throw new TypeError(`duplicate Rush version policy ${name}`);
    policies.set(name, {
      definitionName,
      mainProject: optionalString(policy.mainProject, `${name} mainProject`),
    });
  }
  const releaseUnits: RushReleaseUnitIndex[] = [];
  const projectReleaseUnitRefs: Record<string, string | null> = {};
  const diagnostics: RushWorkspaceFactDiagnostic[] = [];
  for (const [policyName, policy] of policies) {
    const members = input.projects.filter((project) =>
      project.versionPolicyName === policyName
    ).map((project) => project.packageName).sort();
    if (policy.definitionName === "lockStepVersion" && members.length > 0) {
      const unitRef = `policy:${policyName}`;
      releaseUnits.push({
        unitRef,
        mode: "lock-step",
        policyName,
        definitionName: policy.definitionName,
        mainProject: policy.mainProject,
        projectNames: members,
      });
      members.forEach((projectName) => projectReleaseUnitRefs[projectName] = unitRef);
    }
  }
  for (const project of input.projects) {
    if (project.versionPolicyName !== null) {
      const policy = policies.get(project.versionPolicyName);
      if (policy === undefined) {
        projectReleaseUnitRefs[project.packageName] = null;
        diagnostics.push({
          code: "rush-version-policy-unresolved",
          projectName: project.packageName,
          value: project.versionPolicyName,
        });
      } else if (policy.definitionName === "individualVersion") {
        const unitRef = `project:${project.packageName}`;
        projectReleaseUnitRefs[project.packageName] = unitRef;
        releaseUnits.push({
          unitRef,
          mode: "individual",
          policyName: project.versionPolicyName,
          definitionName: policy.definitionName,
          mainProject: policy.mainProject,
          projectNames: [project.packageName],
        });
      }
      continue;
    }
    if (project.shouldPublish) {
      const unitRef = `project:${project.packageName}`;
      projectReleaseUnitRefs[project.packageName] = unitRef;
      releaseUnits.push({
        unitRef,
        mode: "standalone",
        policyName: null,
        definitionName: null,
        mainProject: null,
        projectNames: [project.packageName],
      });
    } else {
      projectReleaseUnitRefs[project.packageName] = null;
    }
  }
  return {
    releaseUnits: releaseUnits.sort((left, right) =>
      left.unitRef.localeCompare(right.unitRef)
    ),
    projectReleaseUnitRefs,
    diagnostics,
  };
}

export async function loadRushWorkspaceFacts(input: {
  root: string;
  projects: readonly RushWorkspaceFactProject[];
}): Promise<RushWorkspaceFacts> {
  const [subspacesConfig, commandLineConfig, versionPolicies] = await Promise.all([
    readOptionalRushJsonc<RushSubspacesConfig>(input.root, RUSH_SUBSPACES_FILE),
    readOptionalRushJsonc<RushCommandLineConfig>(input.root, RUSH_COMMAND_LINE_FILE),
    readOptionalRushJsoncValue<RushVersionPolicyConfig[]>(
      input.root,
      RUSH_VERSION_POLICIES_FILE,
    ),
  ]);
  const subspaces = buildSubspaces({ config: subspacesConfig, projects: input.projects });
  const releases = buildReleaseUnits({ policies: versionPolicies, projects: input.projects });
  return {
    subspacesFile: subspacesConfig === null ? null : RUSH_SUBSPACES_FILE,
    subspacesEnabled: subspaces.subspacesEnabled,
    preventSelectingAllSubspaces: subspaces.preventSelectingAllSubspaces,
    subspaces: subspaces.subspaces,
    commandLineFile: commandLineConfig === null ? null : RUSH_COMMAND_LINE_FILE,
    buildPhases: buildPhases({ config: commandLineConfig, projects: input.projects }),
    buildCommands: buildCommands(commandLineConfig),
    versionPoliciesFile: versionPolicies === null ? null : RUSH_VERSION_POLICIES_FILE,
    releaseUnits: releases.releaseUnits,
    projectReleaseUnitRefs: releases.projectReleaseUnitRefs,
    diagnostics: [...subspaces.diagnostics, ...releases.diagnostics].sort((left, right) =>
      `${left.code}\0${left.projectName}`.localeCompare(`${right.code}\0${right.projectName}`)
    ),
  };
}
