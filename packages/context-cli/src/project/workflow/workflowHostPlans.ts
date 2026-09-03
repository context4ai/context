import type { Route } from "@c4a/agent-graph";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowCommand,
  ContextWorkflowObservation,
} from "./workflowTypes.js";

export interface ResolvedHostPlan {
  commands: ContextWorkflowCommand[];
  configuration?: ContextResolvedWorkflowRoute["configuration"];
}

type HostPlanResolver = (
  observation: ContextWorkflowObservation,
) => ResolvedHostPlan;

function command(
  value: string,
  effect: ContextWorkflowCommand["effect"],
  managedExecution: ContextWorkflowCommand["managed_execution"] =
    effect === "write" ? "automatic" : "agent-required",
  execution?: ContextWorkflowCommand["execution"],
): ContextWorkflowCommand {
  return {
    command: value,
    effect,
    availability: "immediate",
    managed_execution: managedExecution,
    ...(execution === undefined ? {} : { execution }),
  };
}

function withJsonFormat(value: string): string {
  return value.includes(" --format ") ? value : `${value} --format json`;
}

function reviewOpenCommand(
  observation: ContextWorkflowObservation,
): string | undefined {
  if (
    observation.draftCandidates <= 0 ||
    observation.draftCollections.length === 0
  ) {
    return undefined;
  }
  return observation.draftCollections.length === 1
    ? `context review html ${observation.draftCollections[0]} --open`
    : "context review html --all --open";
}

function reviewApproveCommand(
  observation: ContextWorkflowObservation,
): string | undefined {
  if (
    observation.draftCandidates <= 0 ||
    observation.draftCollections.length === 0
  ) {
    return undefined;
  }
  return observation.draftCollections.length === 1
    ? `context review approve-all ${observation.draftCollections[0]} --managed --format json`
    : "context review approve-all --all --managed --format json";
}

function reviewForceApproveCommand(
  observation: ContextWorkflowObservation,
): string | undefined {
  if (
    observation.draftCandidates <= 0 ||
    observation.draftCollections.length === 0
  ) {
    return undefined;
  }
  return observation.draftCollections.length === 1
    ? `context review approve-all ${observation.draftCollections[0]} --force --format json`
    : "context review approve-all --all --force --format json";
}

function workspaceRepairPlan(
  observation: ContextWorkflowObservation,
): ResolvedHostPlan {
  void observation;
  return { commands: [command("context verify --format json --compact", "read")] };
}

function verificationRepairPlan(
  observation: ContextWorkflowObservation,
): ResolvedHostPlan {
  const recapture = observation.pendingCaptureCommands[0];
  if (recapture !== undefined) {
    return {
      commands: [command(withJsonFormat(recapture), "external", "automatic")],
    };
  }
  return { commands: [command("context verify --format json --compact", "read")] };
}

const HOST_PLAN_RESOLVERS: Readonly<Record<string, HostPlanResolver>> = {
  "context.confirm-index-requirement-workset/v1": () => ({
    commands: [command(
      "context indexer confirm-index-requirement-workset --input .tmp/agent-payloads/indexer-requirement-confirmation.json --format json",
      "external",
      "agent-required",
    )],
  }),
  "context.route-indexer-provider-selection/v1": () => ({
    commands: [],
  }),
  "context.validate-indexer-selection-proposal/v1": () => ({
    commands: [],
  }),
  "context.validate-indexer-customization/v1": () => ({
    commands: [],
  }),
  "context.materialize-indexer-instructions/v1": () => ({
    commands: [],
  }),
  "context.materialize-indexer-workset-view/v1": () => ({
    commands: [],
  }),
  "context.inspect-indexer-project-proposal/v1": () => ({
    commands: [],
  }),
  "context.apply-indexer-project/v1": () => ({
    commands: [],
  }),
  "context.observe-indexer-project/v1": () => ({
    commands: [],
  }),
  "context.inspect-indexer-dependencies/v1": () => ({
    commands: [],
  }),
  "context.authorize-indexer-dependencies/v1": () => ({
    commands: [],
  }),
  "context.inspect-indexer-program-execution/v1": () => ({
    commands: [],
  }),
  "context.authorize-indexer-program-execution/v1": () => ({
    commands: [],
  }),
  "context.validate-indexer-contract-overlay/v1": () => ({
    commands: [],
  }),
  "context.confirm-subject-reidentification/v1": () => ({
    commands: [command(
      "context indexer confirm-subject-reidentification --input .tmp/agent-payloads/indexer-subject-reidentification-confirmation.json --format json",
      "external",
      "agent-required",
    )],
  }),
  "context.propose-overlay-question-amendment/v1": () => ({
    commands: [],
  }),
  "context.rebind-indexer-selection-to-requirement/v1": () => ({
    commands: [],
  }),
  "context.verification.repair-next": verificationRepairPlan,
  "context.project.repair-entry": () => ({
    commands: [],
    configuration: {
      file: "src/index.ts",
      action: "Repair the Context project entry reported by the current diagnostic.",
    },
  }),
  "context.workspace.inspect-diagnostics": workspaceRepairPlan,
  "context.project.configure-capture": (observation) => ({
    commands: [],
    configuration: {
      file: "src/index.ts",
      action: `Declare capture phases for ${observation.missingCaptureSources
        .map((source) => `${source.type}:${source.name}`)
        .join(", ")}.`,
    },
  }),
  "context.capture.next": (observation) => {
    const next = observation.pendingCaptureCommands[0];
    return {
      commands: next === undefined
        ? []
        : [command(withJsonFormat(next), "external", "automatic")],
    };
  },
  "context.review.inspect-current": (observation) => {
    const next = reviewOpenCommand(observation);
    return {
      commands: next === undefined ? [] : [command(next, "read")],
    };
  },
  "context.review.approve-current": (observation) => {
    const next = reviewApproveCommand(observation);
    return {
      commands: next === undefined ? [] : [command(next, "write")],
    };
  },
  "context.review.force-approve-current": (observation) => {
    const next = reviewForceApproveCommand(observation);
    return {
      commands: next === undefined ? [] : [command(next, "write")],
    };
  },
  "context.project.configure-package": () => ({
    commands: [],
    configuration: {
      file: "src/index.ts",
      action:
        "Declare the package output confirmed for the current approved knowledge.",
      contract: {
        target: "package-output",
        choices: [
          {
            id: "agent-knowledge-base",
            factory: "kbPackage",
            required: ["name", "template"],
            defaults: {
              template: "src/package-templates/kb",
            },
          },
          {
            id: "llm-text",
            factory: "llmsPackage",
            required: ["name", "template"],
            defaults: { template: "src/package-templates/llms" },
          },
          {
            id: "none",
            factory: null,
            required: [],
          },
        ],
        resource_delivery: {
          applies_to: "agent-knowledge-base",
          recommendation:
            "bundle referenced resources by default; Context keeps each image at or below 1 MiB and all bundled images within 40 MiB, compressing package output when needed; use git-raw only when the author explicitly configures it",
          choices: [
            { id: "bundle", value: { delivery: "bundle" }, default: true },
            {
              id: "git-raw",
              value: { delivery: "git-raw" },
              optional: ["remote", "urlPrefix"],
              requirement: "a Context workspace inside Git, or an explicit urlPrefix",
            },
            { id: "omit", value: { delivery: "omit" } },
          ],
        },
        reference_resources: [
          "context.sdk.package-outputs",
          "context.sdk.project-api",
        ],
        after_edit: "context status --format json",
      },
    },
  }),
  "context.document-optimization.next": (observation) => ({
    commands: observation.documentOptimization?.enabled === true && !observation.documentOptimization.current
      ? [command("context optimize-docs plan --format json", "read", "agent-required")]
      : [],
  }),
  "context.document-optimization.guidance": (observation) => ({
    commands: observation.documentOptimization?.guidance_required === true
      ? [command("context optimize-docs plan --format json", "read", "agent-required")]
      : [],
  }),
  "context.document-revision.next": (observation) => ({
    commands: observation.documentOptimization?.revision_requested === true
      ? [command("context optimize-docs revise-current --format json", "read", "agent-required")]
      : [],
  }),
  "context.logs.flush": () => ({
    commands: [command(
      "context logs flush --format json",
      "external",
      "agent-required",
      { target: "agent-host", requires_network_access: true },
    )],
  }),
};

export function planForHostHandler(
  handler: string,
  observation: ContextWorkflowObservation,
): ResolvedHostPlan {
  const resolver = HOST_PLAN_RESOLVERS[handler];
  if (resolver === undefined) {
    throw new Error(`Unsupported Context workflow host handler: ${handler}`);
  }
  return resolver(observation);
}

export function planForResolvedCommandPlan(
  commandPlan: Route["commandPlan"],
  observation: ContextWorkflowObservation,
): ResolvedHostPlan {
  const plans = commandPlan.map((item): ResolvedHostPlan => {
    if (item.handler !== undefined) {
      return planForHostHandler(item.handler, observation);
    }
    return {
      commands: item.command === undefined
        ? []
        : [command(item.command, item.effect)],
    };
  });
  const configurations = plans.flatMap((plan) =>
    plan.configuration === undefined ? [] : [plan.configuration]
  );
  if (configurations.length > 1) {
    throw new Error(
      "One Agent Graph Action resolved more than one Context project configuration request.",
    );
  }
  return {
    commands: plans.flatMap((plan) => plan.commands),
    ...(configurations[0] === undefined
      ? {}
      : { configuration: configurations[0] }),
  };
}
