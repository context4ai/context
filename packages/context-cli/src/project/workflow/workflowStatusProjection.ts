import type { KnowledgeCollection } from "@c4a/context";
import type {
  ProjectRouting,
  ProjectStatus,
} from "../statusTypes.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowObservation,
  ContextWorkflowStatus,
} from "./workflowTypes.js";

export interface ContextProjectRouteProjection {
  state: string;
  next: string;
  routing: ProjectRouting;
  pendingReview?: NonNullable<ProjectStatus["pendingReview"]>;
}

function pendingReview(
  observation: ContextWorkflowObservation,
  route: ContextResolvedWorkflowRoute | undefined,
): NonNullable<ProjectStatus["pendingReview"]> | undefined {
  const decisionSource = route?.reason_code === "route.review.apply-managed"
    ? "managed-session" as const
    : route?.gate?.id === "knowledge-review"
      ? "user-review" as const
      : undefined;
  if (
    decisionSource === undefined ||
    observation.draftCandidates <= 0 ||
    observation.draftCollections.length === 0
  ) {
    return undefined;
  }
  const collections = [...observation.draftCollections] as
    KnowledgeCollection[];
  if (collections.length === 1) {
    const collection = collections[0]!;
    return {
      scope: "collection",
      collections,
      collection,
      count: observation.draftCandidates,
      command: `context review html ${collection} --open`,
      decisionSource,
      ...(observation.candidateSetDigest === undefined
        ? {}
        : { candidateSetDigest: observation.candidateSetDigest }),
    };
  }
  return {
    scope: "all",
    collections,
    count: observation.draftCandidates,
    command: "context review html --all --open",
    decisionSource,
    ...(observation.candidateSetDigest === undefined
      ? {}
      : { candidateSetDigest: observation.candidateSetDigest }),
  };
}

function nextText(
  workflow: ContextWorkflowStatus,
  route: ContextResolvedWorkflowRoute | undefined,
): string {
  if (workflow.status === "complete") {
    return "Current declared scope is verified and built.";
  }
  if (route === undefined) {
    return workflow.diagnostics[0]?.message ??
      "No legal Context action is available for the current workspace facts.";
  }
  const firstCommand = route.commands.find(
    (item) => item.availability === "immediate",
  );
  const summary = (route.summary ?? route.reason_code).replace(
    /[.:;]\s*$/u,
    "",
  );
  if (firstCommand !== undefined) {
    return `${summary}: ${firstCommand.command}`;
  }
  if (route.configuration !== undefined) {
    return `${summary}: update ${route.configuration.file}.`;
  }
  if (route.availability === "requires-user") {
    return route.summary === undefined
      ? `Human decision required: ${route.reason_code}.`
      : `Human decision required: ${route.summary}`;
  }
  return route.summary ?? route.reason_code;
}

export function projectWorkflowRoute(input: {
  workflow: ContextWorkflowStatus;
  observation: ContextWorkflowObservation;
}): ContextProjectRouteProjection {
  const route = input.workflow.current;
  const state = route?.reason_code ?? `workflow.${input.workflow.status}`;
  const gateRequired =
    route?.availability === "requires-user" && route.gate !== undefined;
  const next = nextText(input.workflow, route);
  const review = pendingReview(input.observation, route);
  const routing: ProjectRouting = {
    current_state: state,
    recommended_action: next,
    reason: route?.reason_code ??
      input.workflow.diagnostics[0]?.code ??
      "route.current-scope-complete",
    alternatives: input.workflow.alternatives.map((alternative) =>
      alternative.reason_code
    ),
    human_gate: {
      required: gateRequired,
      kind: route?.gate?.id ?? "none",
      confirmation: gateRequired
        ? "required-in-current-conversation"
        : "not-required",
      persistence: !gateRequired
        ? "not-applicable"
        : "defined-by-resolution-action",
      ...(route?.gate?.resolution === "session-authority"
        ? { resolution: "managed-session" as const }
        : {}),
    },
    commands_available: (route?.commands.length ?? 0) > 0,
    command_plan: (route?.commands ?? []).map((item) => ({
      command: item.command,
      availability: item.availability,
    })),
    ...(route?.configuration === undefined
      ? {}
      : { configuration: route.configuration }),
    downstream_impact:
      "After the selected action, Context re-observes facts and resolves a new Agent Graph route.",
    do_not: [],
  };
  return {
    state,
    next,
    routing,
    ...(review === undefined ? {} : { pendingReview: review }),
  };
}
