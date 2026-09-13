import { beginProductionRevision } from "./productionRevision.js";
import { indexerProtocolDigest } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import { prepareApprovedRevision, reopenApprovedRevision, readApprovedRevision } from "./approvedRevision.js";

function normalizedSelector(value: string): string {
  return value.normalize("NFC").replace(/^\.\//u, "").replace(/^knowledge\//u, "");
}

function candidateAliases(candidate: CandidateRecord): string[] {
  return [
    candidate.candidate_id,
    candidate.path,
    `knowledge/${candidate.path}`,
    candidate.review.title,
  ];
}

function resolveCandidate(
  candidates: readonly CandidateRecord[],
  selector: string,
): CandidateRecord {
  const normalized = normalizedSelector(selector);
  const exact = candidates.filter((candidate) =>
    candidateAliases(candidate).some((alias) =>
      normalizedSelector(alias).toLocaleLowerCase() === normalized.toLocaleLowerCase()
    )
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new ContextError(
      ExitCode.UserError,
      `revision target is ambiguous: ${selector}`,
      {
        category: ErrorCategory.UserInputInvalid,
        candidates: exact.map((candidate) => ({
          candidate_id: candidate.candidate_id,
          path: candidate.path,
          title: candidate.review.title,
        })),
      },
    );
  }
  throw new ContextError(ExitCode.UserError, `current Candidate not found: ${selector}`, {
    category: ErrorCategory.UserInputInvalid,
    next: "Use a candidate id or canonical Candidate path from context review list --all --format json.",
  });
}

interface DocumentRevisionInput {
  move_to?: string;
  timing?: "after-batch" | "priority";
  regenerate?: boolean;
  projectRoot: string;
  selector: string;
  instruction: string;
}

async function registerRequestedRevisionMaintenance(input: DocumentRevisionInput) {
  const instruction = input.instruction.trim();
  // Scheduling preferences must not turn a current draft into an approved-page
  // request. Repair the current delivery before considering maintenance queues.
  const currentCandidates = await readCandidateRecords(input.projectRoot);
  const selectedCandidates = currentCandidates.filter((candidate) => candidateAliases(candidate).some((alias) =>
    normalizedSelector(alias).toLocaleLowerCase() === normalizedSelector(input.selector).toLocaleLowerCase()));
  if (selectedCandidates.length > 1) resolveCandidate(selectedCandidates, input.selector);
  if (input.regenerate || input.timing === "priority") {
    if (input.move_to) throw new ContextError(ExitCode.UserError,
      "A page move uses the structure-aware revise route, not maintenance scheduling", {
        category: ErrorCategory.UserInputInvalid,
        next: "Use context revise with --move-to after the current Candidate review, without --regenerate or --timing priority.",
      });
    if (selectedCandidates.length === 0) {
      const { registerKnowledgeMaintenance } = await import("./knowledgeMaintenance.js");
      const request = { operation: input.regenerate ? "regenerate" : "revise", timing: input.timing ?? "after-batch",
        targets: [{ path: input.selector, instruction: input.instruction }] };
      return registerKnowledgeMaintenance(input.projectRoot, { ...request, id: indexerProtocolDigest(request).slice(7) }, { renewCompleted: true });
    }
    if (input.regenerate) {
      const command = `context revise '${input.selector.replace(/'/gu, "'\\''")}' --instruction '${instruction.replace(/'/gu, "'\\''")}' --format json`;
      throw new ContextError(ExitCode.UserError, "This page is a current Candidate; repair its owning Author before approved-page regeneration", {
        category: ErrorCategory.UserInputInvalid,
        reason_code: "current-candidate-requires-repair",
        next: command,
        next_action: { command },
      });
    }
  }
  return undefined;
}

async function assertCandidateReviewAvailable(projectRoot: string, selector: string): Promise<void> {
  const candidates = await readCandidateRecords(projectRoot);
  const matches = candidates.filter((candidate) => candidateAliases(candidate).some((alias) =>
    normalizedSelector(alias).toLocaleLowerCase() === normalizedSelector(selector).toLocaleLowerCase()));
  if (matches.length > 0) {
    const candidate = resolveCandidate(matches, selector);
    const command = "context status --format json";
    // A candidate without its current production/revision owner is not an
    // approved page. Preserve it and report the incomplete local process.
    throw new ContextError(ExitCode.WorkspaceStateError,
      "This candidate has no matching current production or revision task; inspect the current local process before starting a repair", {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "candidate-review-not-current",
        candidate_id: candidate.candidate_id,
        request_registered: false,
        next_action: { command, message: "Finish the active repair or recovery using the current Route, then select this page from the refreshed Review. Keep this repair instruction for that step. Do not approve the incorrect page, clear the task, or retry its old Candidate id while another repair is active." },
      });
  }
}

/** Revise current candidates or formal articles without legacy workset recovery. */
export async function beginDocumentRevision(input: DocumentRevisionInput) {
  const instruction = input.instruction.trim();
  if (instruction.length === 0) {
    throw new ContextError(ExitCode.UserError, "--instruction must not be empty", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const scheduled = await registerRequestedRevisionMaintenance(input);
  if (scheduled) return scheduled;
  const production = await beginProductionRevision({ ...input, instruction });
  if (production) return production;
  if (input.move_to && (await readCandidateRecords(input.projectRoot)).length) throw new TypeError("Finish current Candidate review before moving an approved page.");
  if (input.move_to && await readApprovedRevision(input.projectRoot)) throw new TypeError("Finish the active page revision before requesting a move; no existing move is silently replaced.");
  const reopened = await reopenApprovedRevision({ ...input, instruction });
  if (reopened) return reopened;
  await assertCandidateReviewAvailable(input.projectRoot, input.selector);
  return prepareApprovedRevision({
    projectRoot: input.projectRoot,
    selector: input.selector,
    ...(input.move_to === undefined ? {} : { move_to: input.move_to }),
    instruction,
  });
}
