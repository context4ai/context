import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { maintenanceInputSchema, readMaintenance, saveMaintenance, MAINTENANCE_ROOT } from "./maintenanceStorage.js";
import { withProjectWriteLock } from "./writeLock.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { readCandidateRecords, CANDIDATE_LEDGER_FILE } from "./candidateLedger.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { readIndexerDelivery, requestIndexerEarlyDelivery } from "./indexerDelivery.js";
import { prepareApprovedRevision, readApprovedRevision } from "./approvedRevision.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

function deliveryDigest(delivered: Record<string, string> | undefined) { return indexerProtocolDigest(delivered ?? {}); }

export async function registerKnowledgeMaintenance(root: string, value: unknown, options: { renewCompleted?: boolean } = {}) {
  return withProjectWriteLock(root, "register-knowledge-maintenance", async () => {
    const input = maintenanceInputSchema.parse(value);
    for (const target of input.targets) target.path = target.path.replace(/^knowledge\//u, "");
    const state = await readMaintenance(root);
    // CLI-generated identities deduplicate retries only while outstanding.
    // Explicit task-maintain IDs remain durable idempotency keys.
    if (options.renewCompleted) {
      const baseId = input.id;
      let generation = 0;
      while (state.completed.some(item => item.id === input.id)) {
        input.id = indexerProtocolDigest({ command_id: baseId, generation: ++generation }).slice(7);
      }
    }
    const digest = indexerProtocolDigest(input);
    const existing = [...state.pending, ...(state.active ? [state.active] : [])].find(item => item.input.id === input.id);
    const completed = state.completed.find(item => item.id === input.id);
    if (existing || completed) {
      if ((existing ? indexerProtocolDigest(existing.input) : completed!.input_digest) !== digest) throw new TypeError("Maintenance id already belongs to different input. Cancel the pending request or use a new id for additional feedback.");
      return { status: "maintenance-registered" as const, outcome: completed ? completed.outcome === "cancelled" ? "already-cancelled" : "already-completed" : "already-registered", id: input.id, next_action: { command: "context status --format json" } };
    }
    const structure = await readKnowledgeStructure(root);
    const targets = input.targets.map(target => {
      const path = target.path.replace(/^knowledge\//u, "");
      const matches = (Array.isArray(structure.parsed?.views) ? structure.parsed.views : []).filter(view => view && typeof view === "object" && view.path === path);
      if (matches.length !== 1 || typeof matches[0]!.view_ref !== "string") throw new ContextError(ExitCode.UserError,
        `Maintenance requires an approved page: ${target.path}`, {
          category: ErrorCategory.UserInputInvalid,
          reason_code: "maintenance-target-not-approved",
          next: "Inspect current Candidates first. Repair a current Candidate with context revise and its review feedback; do not queue it behind its own delivery.",
          next_action: { command: "context review list --all --format json" },
        });
      target.path = path;
      return { path, view_ref: matches[0]!.view_ref as string };
    });
    if (new Set(targets.map(item => item.path)).size !== targets.length) throw new TypeError("Maintenance targets repeat the same approved page");
    const delivery = await readIndexerDelivery(root);
    const request = { input, targets, delivered_before: deliveryDigest(delivery?.delivered) };
    if (input.timing === "priority") state.pending.unshift(request); else state.pending.push(request);
    await saveMaintenance(root, state);
    return { status: "maintenance-registered" as const, outcome: "registered", id: input.id, timing: input.timing, targets,
      message: "Request saved. Follow the current Route; production remains intact until a safe delivery boundary.",
      next_action: { command: "context status --format json" } };
  });
}

/** No state changes during observation. Queue additions do not alter a running
 * Author's inputs. A scheduling action is exposed only at a safe boundary. */
export async function observeKnowledgeMaintenance(root: string) {
  const state = await readMaintenance(root);
  const active = state.active;
  if (active) return { state, action: active.phase === "running" ? undefined : "advance", reason: active.phase };
  const next = state.pending[0];
  if (!next) return { state, action: undefined, reason: "empty" };
  const { readKnowledgeUpdate } = await import("./knowledgeUpdate.js");
  const { readTaskRollback } = await import("./taskRollback.js");
  if (await readApprovedRevision(root) || await readKnowledgeUpdate(root) || await readTaskRollback(root)) return { state, action: undefined, reason: "current-local-task" };
  if ((await readCandidateRecords(root)).length) return { state, action: undefined, reason: "current-review" };
  const ledger = await currentLedger(root);
  const delivery = await readIndexerDelivery(root);
  if (delivery?.current.length) return { state, action: undefined, reason: "current-delivery" };
  if (!ledger) return { state, action: "advance", reason: "delivery-boundary" };
  const { maintenanceProductionConflict } = await import("./maintenanceProductionConflict.js");
  const conflict = next.input.operation !== "rebuild" && await maintenanceProductionConflict(root, next.targets, ledger, delivery);
  if (!conflict && delivery && deliveryDigest(delivery.delivered) !== next.delivered_before) return { state, action: "advance", reason: "delivery-boundary" };
  if (next.input.operation === "rebuild") return { state, action: "advance", reason: "approved-output-only" };
  if (next.input.timing === "priority" && ledger.entries[0]?.stage === "author" && !delivery?.early_requested) return { state, action: "early-delivery", reason: "priority-request" };
  return { state, action: undefined, reason: conflict ? "target-still-in-production" : "waiting-for-delivery-boundary" };
}

export async function maintenanceRevision(root: string) {
  const observed = await observeKnowledgeMaintenance(root);
  const localInputs = observed.state.active ? {
    revision: await readFile(join(root, MAINTENANCE_ROOT, "revision.json"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; }),
    candidates: (await readCandidateRecords(root)).map(item => ({ id: item.candidate_id, fingerprint: item.fingerprint, status: item.status })),
  } : null;
  return { ...observed, revision: indexerProtocolDigest({ active: observed.state.active ?? null, localInputs,
    next: observed.state.pending[0] ?? null, action: observed.action ?? null, reason: observed.reason }) };
}

export async function advanceKnowledgeMaintenance(root: string, revision: string) {
  return withProjectWriteLock(root, "advance-knowledge-maintenance", async () => {
    const observed = await maintenanceRevision(root);
    if (observed.revision !== revision || !observed.action) throw new TypeError("Maintenance route changed. Refresh context status --format json; do not repeat accepted work.");
    if (observed.action === "early-delivery") {
      await requestIndexerEarlyDelivery(root);
      return { outcome: "early-delivery-requested", next_action: { command: "context status --format json" } };
    }
    const state = observed.state;
    if (!state.active) {
      const next = state.pending.shift()!;
      state.active = { ...next, phase: "preparing" };
      await saveMaintenance(root, state);
    }
    const active = state.active;
    if (active.phase === "cancelling") {
      await discardMaintenanceDraft(root);
    } else if (active.phase === "finishing") {
      await finishMaintenanceRevision(root);
    } else if (active.input.operation === "rebuild") {
      const { buildProjectPackages, queueProjectBuildCompletedEvent } = await import("./packageBuilder.js");
      const { readProjectCloseStatus, closeProjectWorkspace } = await import("./close.js");
      if ((await readProjectCloseStatus(root)).state !== "ready") await closeProjectWorkspace(root);
      const result = await buildProjectPackages(root, { delivery: false });
      queueProjectBuildCompletedEvent(result);
      await finishMaintenanceRevision(root);
    } else {
      const structure = await readKnowledgeStructure(root);
      for (const target of active.targets) if (!(Array.isArray(structure.parsed?.views) && structure.parsed.views.some(view =>
        view && typeof view === "object" && view.path === target.path && view.view_ref === target.view_ref))) throw new TypeError(`Approved page moved or changed identity: ${target.path}. Cancel this request and register its current path; no original task was discarded.`);
      if (!await readApprovedRevision(root)) {
        const [first, ...rest] = active.input.targets;
        await prepareApprovedRevision({ projectRoot: root, selector: first!.path, instruction: first!.instruction,
          ...(active.input.operation === "regenerate" ? { regenerate: true } : {}),
          pending_targets: rest.map(target => ({ path: target.path, instruction: target.instruction,
            ...(active.input.operation === "regenerate" ? { regenerate: true } : {}) })) });
      }
      active.phase = "running";
      await saveMaintenance(root, state);
    }
    return { outcome: "advanced", next_action: { command: "context status --format json" } };
  });
}

/** Called after the local batch's actual apply/close/build, or its no-change
 * completion. Never clean the production Indexer ledger or accepted results. */
export async function finishMaintenanceRevision(root: string, outcome: "completed" | "cancelled" = "completed"): Promise<boolean> {
  const state = await readMaintenance(root);
  if (!state.active) return false;
  state.active.completion_outcome ??= outcome;
  outcome = state.active.completion_outcome;
  state.active.phase = "finishing";
  await saveMaintenance(root, state);
  await rm(join(root, MAINTENANCE_ROOT, "revision.json"), { force: true });
  state.completed.push({ id: state.active.input.id, input_digest: indexerProtocolDigest(state.active.input), outcome });
  delete state.active;
  await saveMaintenance(root, state);
  return true;
}

export async function cancelKnowledgeMaintenance(root: string, id: string, discardRevision?: string) {
  return withProjectWriteLock(root, "cancel-knowledge-maintenance", async () => {
    const state = await readMaintenance(root);
    if (state.active?.input.id === id) {
      if (state.active.phase !== "preparing" || await readApprovedRevision(root)) {
        if (discardRevision !== (await maintenanceRevision(root)).revision) throw new TypeError(`An active maintenance draft requires explicit discard. Read task maintenance-status, then use cancel-maintenance ${id} --discard-revision <revision>. This discards only its unfinished drafts and retains already approved pages.`);
        state.active.phase = "cancelling";
        await saveMaintenance(root, state);
        await discardMaintenanceDraft(root);
        return { outcome: "cancelled", id, next_action: { command: "context status --format json" } };
      }
      delete state.active;
    } else {
      if (!state.pending.some(item => item.input.id === id)) throw new TypeError("No pending maintenance request with this id");
      state.pending = state.pending.filter(item => item.input.id !== id);
    }
    await saveMaintenance(root, state);
    return { outcome: "cancelled", id, next_action: { command: "context status --format json" } };
  });
}

async function discardMaintenanceDraft(root: string) {
  // Registration only starts at an empty review boundary. Validate ownership
  // again before removing the local drafts; unrelated Candidates are never lost.
  const request = await readApprovedRevision(root);
  const candidates = await readCandidateRecords(root);
  const owned = new Set([...(request?.batch_candidates ?? []), ...(request?.candidate ? [request.candidate] : [])].map(item => item.candidate_id));
  if (candidates.some(item => !owned.has(item.candidate_id))) throw new TypeError("Unrelated Candidates are present; no draft was discarded. Inspect the current review before retrying cancellation.");
  await rm(join(root, CANDIDATE_LEDGER_FILE), { force: true });
  await rm(join(root, MAINTENANCE_ROOT, "revision.json"), { force: true });
  const { closeProjectWorkspace } = await import("./close.js");
  const { buildProjectPackages } = await import("./packageBuilder.js");
  await closeProjectWorkspace(root);
  await buildProjectPackages(root, { delivery: false });
  await finishMaintenanceRevision(root, "cancelled");
}
