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
  if (observation.compilePhaseResolution?.state === "ambiguous") {
    return {
      commands: [],
      configuration: {
        file: "src/index.ts",
        action:
          "Make the compileProse lifecycle owner unique for each source and collection reported by diagnostic.compile-route-ambiguous.",
      },
    };
  }
  if ((observation.compileBatch?.missingStructureDigests.length ?? 0) > 0) {
    return {
      commands: [],
      configuration: {
        file: "src/index.ts",
        action:
          "Restore the missing confirmed structure snapshot or declare a new align/compile lifecycle for the affected source and collection.",
      },
    };
  }
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
  if (observation.compileDocumentNext !== undefined) {
    return {
      commands: [command(withJsonFormat(observation.compileDocumentNext), "write")],
    };
  }
  return { commands: [command("context verify --format json --compact", "read")] };
}

const HOST_PLAN_RESOLVERS: Readonly<Record<string, HostPlanResolver>> = {
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
  "context.extract.inspect-capabilities": (observation) => ({
    commands: observation.repoSources.length === 0
      ? []
      : [command("context source inspect --repo-only --format json", "read")],
  }),
  "context.project.configure-extraction": () => ({
    commands: [],
    configuration: {
      file: "src/index.ts",
      action:
        "Declare extraction for every user-confirmed repository module and scope.",
    },
  }),
  "context.extract.preview-batch": (observation) => {
    const phases = [...new Set([
      ...observation.staleSourcePhases,
      ...observation.pendingExtractPhases,
    ])];
    return {
      commands: [command(
        `context run --preview-extraction-batch${phases.map((phase) => ` --preview-phase ${JSON.stringify(phase)}`).join("")} --format json`,
        "write",
        "automatic",
        { target: "subprocess" },
      )],
    };
  },
  "context.code-index.migrate": () => ({
    commands: [command(
      "context migrate codeindex --format json",
      "write",
      "automatic",
      { target: "subprocess" },
    )],
  }),
  "context.extract.next": (observation) => {
    const phase = observation.staleSourcePhases[0] ??
      observation.pendingExtractPhases[0];
    const definition = observation.phases.find((candidate) => candidate.id === phase);
    const projectCode = definition?.kind === "phase.extract.custom" || definition?.kind === "phase.custom";
    return {
      commands: phase === undefined
        ? []
        : [command(
            `context run ${phase} --format json`,
            "write",
            "automatic",
            projectCode ? { target: "subprocess" } : undefined,
          )],
    };
  },
  "context.code-index-audit.submit": () => ({
    commands: [command(
      "context review code-index --input .tmp/agent-payloads/code-index-audit-decision.json --format json",
      "write",
      "agent-required",
    )],
  }),
  "context.project.revise-code-index": (observation) => {
    const decision = observation.codeIndexAudit?.decision;
    const units = decision?.revision_plan?.units ?? [];
    const actions = decision?.revision_plan?.actions ?? [];
    return {
      commands: [],
      configuration: {
        file: "src/index.ts",
        action: [
          units.length === 0
            ? "Revise the code-index units identified by the current Agent audit."
            : `Revise code-index units ${units.join(", ")}.`,
          actions.length === 0
            ? "Improve aggregation, explanatory sections, evidence scope, source coverage, or structured handoffs as reported."
            : `Apply this accepted revision plan: ${actions.join("; ")}.`,
          "Then run context status --format json; the Route will preview, extract, and audit the new revision before review.",
        ].join(" "),
      },
    };
  },
  "context.project.apply-code-index-guidance": (observation) => {
    const units = observation.codeIndexAudit?.guidance_units ?? [];
    return {
      commands: [],
      configuration: {
        file: "src/index.ts",
        action: [
          `Apply the user's current guidance to code-index units ${units.map((unit) => unit.unit_id).join(", ") || "reported by the current audit"}.`,
          "Change only the confirmed source scope, profile, supplied material, extraction inventory, or Section construction.",
          "Do not restart modules that already pass. Then run context status --format json and continue from the returned Route.",
        ].join(" "),
      },
    };
  },
  "context.document.inspect-classification": (observation) => ({
    commands: observation.unclassifiedDocumentTargets.map((target) =>
      command(target.command, "read")
    ),
  }),
  "context.project.configure-prose": (observation) => ({
    commands: [],
    configuration: {
      file: "src/index.ts",
      action: observation.pendingStructureTargets
        .flatMap((target) => target.suggestions)
        .join("; ") ||
        "Declare align, compile, and review for the confirmed document source and collection.",
    },
  }),
  "context.align.next": (observation) => ({
    commands: observation.pendingStructureTargets.map((target) =>
      command(target.command, "read")
    ),
  }),
  "context.structure.inspect": (observation) => ({
    commands: [
      observation.alignDocumentStructureSummaryNext,
      observation.alignDocumentValidateNext,
    ].flatMap((value) =>
      value === undefined ? [] : [command(value, "read")]
    ),
  }),
  "context.structure.confirm": (observation) => ({
    commands: observation.alignDocumentConfirmNext === undefined
      ? []
      : [command(observation.alignDocumentConfirmNext, "write")],
  }),
  "context.compile.next": (observation) => ({
    commands: observation.compileDocumentNext === undefined
      ? []
      : [command(observation.compileDocumentNext, "write")],
  }),
  "context.review.preserve-approved-identities": (observation) => {
    const source = observation.reviewIdentityConflicts.sourceKeys[0];
    return {
      commands: source === undefined
        ? []
        : [command(
            `context review reconcile-identities --source ${source} --strategy preserve-approved --format json`,
            "write",
          )],
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
