import { join } from "node:path";
import type { HostActionResult } from "@c4a/agent-graph";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  loadIndexerRegistry,
  type IndexerInventoryMember,
  validateIndexerCurrentActionInput,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { collectProjectStatus } from "./status.js";
import { assertProjectWorkflowRevision } from "./statusCommand.js";
import { findContextProjectRoot } from "./workspace.js";
import { resolveCurrentIndexerAgentContext } from "./indexerCurrentWorkflowRoute.js";
import {
  acceptIndexerMainRunStore,
  convergeIndexerMainPartitionRunStore,
} from "./indexerMainRunStore.js";
import { buildIndexerPartitionRunResultFromSemantic } from
  "./indexerSemanticPartitionResult.js";
import { buildIndexerAuthorRunResultFromSemantic } from
  "./indexerSemanticAuthorResult.js";
import { contextWorkflowAuthorities } from "./workflow/workflowFacts.js";
import {
  CONTEXT_WORKFLOW_AUTHORITIES,
  type ContextWorkflowAuthority,
} from "./workflow/workflowTypes.js";
import {
  completeCurrentIndexerStructureReview,
  currentIndexerStructureReview,
} from "./indexerStructureReview.js";
import { advanceCurrentIndexerLifecycle } from "./indexerCurrentLifecycle.js";
import {
  advanceCurrentIndexerFinalization,
  confirmCurrentIndexerLayout,
  readCurrentIndexerFinalization,
} from "./indexerCurrentFinalization.js";
import {
  readCurrentIndexerComposerContext,
  resolveCurrentIndexerComposerContext,
} from "./indexerCurrentComposer.js";
import { buildIndexerPostAuthorResultFromSemantic } from
  "./indexerSemanticPostAuthorResult.js";
import {
  acceptIndexerPostAuthorRunStore,
  failIndexerPostAuthorRunStore,
} from "./indexerPostAuthorRunStore.js";
import {
  buildCurrentIndexerProviderSelectionRoute,
  completeCurrentIndexerProviderSelection,
  indexerRegistryNeedsProviderSelection,
} from "./indexerCurrentProviderSetup.js";
import {
  completeCurrentIndexerProviderFinalization,
  completeCurrentIndexerProviderProgramAuthorization,
  completeCurrentIndexerProviderResolution,
} from "./indexerCurrentProviderContinuation.js";
import { reopenCurrentAuthorWorksets } from "./documentRevision.js";

function semanticResultPath(projectRoot: string, requestDigest: string): string {
  return join(
    projectRoot,
    ".tmp",
    "context-runtime",
    "indexer",
    "semantic-results",
    `${requestDigest.slice("sha256:".length)}.json`,
  );
}

export async function completeCurrentIndexerAction(input: {
  cwd: string;
  revision: string;
  value: unknown;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
}) {
  const found = findContextProjectRoot(input.cwd);
  if (found === null) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "complete-current requires a Context project",
      { category: ErrorCategory.WorkspaceNotFound },
    );
  }
  const authorities = contextWorkflowAuthorities({
    managed: input.managed === true,
    ...(input.authorities === undefined ? {} : { authorities: input.authorities }),
  });
  await assertProjectWorkflowRevision({
    cwd: found.projectRoot,
    expectedRevision: input.revision,
    managed: input.managed === true,
    authorities,
  });
  const semantic = validateIndexerCurrentActionInput(input.value);
  if (semantic.stage === "provider-selection") {
    const loaded = await loadIndexerRegistry(found.projectRoot);
    if (!indexerRegistryNeedsProviderSelection(loaded.registry)) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current Provider selection is already complete",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    const currentRoute = await buildCurrentIndexerProviderSelectionRoute({
      projectRoot: found.projectRoot,
      registry: loaded.registry,
      authorities,
      managed: input.managed === true,
    });
    if (currentRoute.revision !== input.revision) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current Provider selection changed before completion",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    const outcome = await completeCurrentIndexerProviderSelection({
      projectRoot: found.projectRoot,
      currentRegistry: loaded.registry,
      semantic,
    });
    if (outcome === "selection-applied") {
      await advanceCurrentIndexerLifecycle(found.projectRoot);
    }
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      outcome,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "provider-resolution") {
    const outcome = await completeCurrentIndexerProviderResolution({
      projectRoot: found.projectRoot,
      hostResult: semantic.result as unknown as HostActionResult,
      ...(semantic.managed_output === undefined
        ? {}
        : {
            managedOutput: {
              ref: semantic.managed_output.ref,
              digest: semantic.managed_output.digest,
              value: semantic.managed_output.value,
            },
          }),
    });
    if (outcome === "selection-applied") {
      await advanceCurrentIndexerLifecycle(found.projectRoot);
    }
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      outcome,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "provider-program-authorization") {
    if (
      input.managed === true &&
      !authorities.includes(CONTEXT_WORKFLOW_AUTHORITIES.indexerProgramExecution)
    ) {
      throw new ContextError(
        ExitCode.UserError,
        "managed Provider program authorization requires indexer-program-execution authority",
        { category: ErrorCategory.UserInputInvalid },
      );
    }
    const outcome = await completeCurrentIndexerProviderProgramAuthorization({
      projectRoot: found.projectRoot,
      decision: semantic.decision,
    });
    if (outcome === "selection-applied") {
      await advanceCurrentIndexerLifecycle(found.projectRoot);
    }
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      outcome,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "provider-finalization") {
    await completeCurrentIndexerProviderFinalization(found.projectRoot);
    await advanceCurrentIndexerLifecycle(found.projectRoot);
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      outcome: "selection-applied",
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "layout-confirmation") {
    const current = await readCurrentIndexerFinalization(found.projectRoot);
    if (current?.state !== "layout-confirmation-required" || current.revision !== input.revision) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current layout confirmation is stale",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    if (semantic.decision === "rejected") {
      if (semantic.feedback === undefined) {
        throw new ContextError(
          ExitCode.UserError,
          "rejecting a layout requires revision feedback",
          { category: ErrorCategory.UserInputInvalid },
        );
      }
      const reopened = await reopenCurrentAuthorWorksets({
        projectRoot: found.projectRoot,
        target_ref: `layout:${current.revision}`,
        instruction: semantic.feedback,
      });
      const status = await collectProjectStatus(found.projectRoot, {
        managed: input.managed === true,
        authorities,
      });
      return {
        protocol: "context.indexer.current-action-completion/v1" as const,
        stage: semantic.stage,
        outcome: "rejected",
        reopened,
        workflow: status.workflow,
      };
    }
    await confirmCurrentIndexerLayout({
      projectRoot: found.projectRoot,
      revision: input.revision,
      actor_ref: "human:local-user",
    });
    await advanceCurrentIndexerFinalization(found.projectRoot);
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      outcome: "approved",
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "structure-review") {
    const structure = await currentIndexerStructureReview(found.projectRoot);
    if (structure === undefined || structure.revision !== input.revision) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current semantic structure review is stale",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    if (
      input.managed === true &&
      !authorities.includes(CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview)
    ) {
      throw new ContextError(
        ExitCode.UserError,
        "managed semantic structure review requires knowledge-review authority",
        { category: ErrorCategory.UserInputInvalid },
      );
    }
    const nextStage = await completeCurrentIndexerStructureReview({
      projectRoot: found.projectRoot,
      revision: input.revision,
      decision: semantic.decision,
      ...(semantic.feedback === undefined ? {} : { feedback: semantic.feedback }),
    });
    if (nextStage === "partition") {
      await advanceCurrentIndexerLifecycle(found.projectRoot);
    }
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      outcome: semantic.decision,
      workflow: status.workflow,
    };
  }
  if (semantic.stage === "post-author") {
    const current = await readCurrentIndexerComposerContext(found.projectRoot);
    if (current === undefined) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "the current workflow route no longer has a Composer workset",
        { category: ErrorCategory.WorkflowRevisionStale },
      );
    }
    if (semantic.outcome === "failed") {
      await failIndexerPostAuthorRunStore({
        projectRoot: found.projectRoot,
        plan: current.plan,
        ledger: current.ledger,
        composer_ref: current.request.composer_ref,
        reason_code: semantic.diagnostics[0]!.code,
        dependency_digests: [indexerProtocolDigest(semantic.diagnostics)],
      });
    } else {
      if (current.composer.contract === undefined) {
        throw new TypeError(`Composer ${current.composer.id} has no executable contract`);
      }
      const result = buildIndexerPostAuthorResultFromSemantic({
        request: current.request,
        primary_artifact_result: current.record.artifact_result,
        semantic,
        allowed_artifact_kinds:
          current.composer.contract.derived_artifact_policy.artifact_kinds,
        artifact_policy_variant:
          current.composer.contract.derived_artifact_policy.artifact_policy_variant,
      });
      await acceptIndexerPostAuthorRunStore({
        projectRoot: found.projectRoot,
        plan: current.plan,
        ledger: current.ledger,
        composer_ref: current.request.composer_ref,
        result,
        validator_contract_digest: current.validator_contract_digest,
      });
      await atomicWriteFile(
        semanticResultPath(found.projectRoot, current.request.request_digest),
        canonicalIndexerJson(semantic),
      );
      await resolveCurrentIndexerComposerContext(found.projectRoot);
      await advanceCurrentIndexerFinalization(found.projectRoot);
    }
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      outcome: semantic.outcome === "complete" ? "accepted" : "failed",
      workflow: status.workflow,
    };
  }
  const current = await resolveCurrentIndexerAgentContext(found.projectRoot);
  if (current === undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "the current workflow route no longer has an Agent workset",
      {
        category: ErrorCategory.WorkflowRevisionStale,
        next: "context status --format json",
      },
    );
  }
  if (semantic.stage !== current.spec.request.workset.stage) {
    throw new ContextError(
      ExitCode.UserError,
      `current ${current.spec.request.workset.stage} workset cannot consume ${semantic.stage} input`,
      { category: ErrorCategory.UserInputInvalid },
    );
  }
  if (semantic.stage === "author") {
    const validation = current.spec.validation as unknown as {
      dependency_view: unknown;
      expected_subject_key: unknown;
      artifact_policy_eligibility: unknown;
      allowed_source_roles: readonly string[];
      allowed_artifact_intents: readonly {
        source_role: string;
        document_kind: string;
        reader_goal: string;
        artifact_kind: string;
      }[];
      canonical_inventory_members: readonly IndexerInventoryMember[];
      allowed_question_targets: readonly {
        question_target_key: string;
        question_ref: string;
      }[];
    };
    const result = buildIndexerAuthorRunResultFromSemantic({
      request: current.spec.request,
      view: current.worksetView.projection.view,
      semantic,
      validation,
    });
    await acceptIndexerMainRunStore({
      projectRoot: found.projectRoot,
      workset_digest: current.spec.request.workset.workset_digest,
      result,
    });
    await atomicWriteFile(
      semanticResultPath(found.projectRoot, current.spec.request.execution_request_digest),
      canonicalIndexerJson(semantic),
    );
    await advanceCurrentIndexerLifecycle(found.projectRoot);
    const status = await collectProjectStatus(found.projectRoot, {
      managed: input.managed === true,
      authorities,
    });
    return {
      protocol: "context.indexer.current-action-completion/v1" as const,
      stage: semantic.stage,
      workset_digest: current.spec.request.workset.workset_digest,
      outcome: "accepted",
      workflow: status.workflow,
    };
  }
  const validation = current.spec.validation as unknown as {
    canonical_inventory_members: readonly IndexerInventoryMember[];
    authorized_source_refs: readonly string[];
    subject_key_contract: unknown;
    required_question_target_refs?: readonly string[];
  };
  const result = buildIndexerPartitionRunResultFromSemantic({
    request: current.spec.request,
    view: current.worksetView.projection.view,
    semantic,
    validation: {
      canonical_inventory_members: validation.canonical_inventory_members,
      authorized_source_refs: validation.authorized_source_refs,
      subject_key_contract: validation.subject_key_contract,
      ...(validation.required_question_target_refs === undefined
        ? {}
        : { required_question_target_refs: validation.required_question_target_refs }),
    },
  });
  const converged = await convergeIndexerMainPartitionRunStore({
    projectRoot: found.projectRoot,
    workset_digest: current.spec.request.workset.workset_digest,
    result,
  });
  if (converged.convergence.decision === "accepted") {
    await atomicWriteFile(
      semanticResultPath(found.projectRoot, current.spec.request.execution_request_digest),
      canonicalIndexerJson(semantic),
    );
  }
  await advanceCurrentIndexerLifecycle(found.projectRoot);
  const status = await collectProjectStatus(found.projectRoot, {
    managed: input.managed === true,
    authorities,
  });
  return {
    protocol: "context.indexer.current-action-completion/v1" as const,
    stage: semantic.stage,
    workset_digest: current.spec.request.workset.workset_digest,
    outcome: converged.convergence.decision,
    workflow: status.workflow,
  };
}
