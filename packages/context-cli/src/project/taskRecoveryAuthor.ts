import {
  buildIndexerMainRunRequest, buildIndexerMainWorkset, buildIndexerMainWorksetSet,
  buildIndexerRepairIntent, composeIndexerLayerInput, recoverIndexerMainRunLedger,
  validateIndexerMainRunLedger, startIndexerMainRun, indexerProtocolDigest, indexerArticlePlanSchema,
  canonicalIndexerNodeRef, indexerArtifactRef, type IndexerProjectFileTarget,
} from "@c4a/context";
import { currentLedger, currentSpec, normalizeRunSpec, runSpecPath, INDEXER_MAIN_RUN_CURRENT_PATH, type MainRunSpec } from "./indexerMainRunStoreRecords.js";
import { readRecoveryCheckpoint, recoveryText, recoveryBaselineGuard, RECOVERY_ROOT } from "./taskRecoveryCheckpoint.js";
import { partitionAuthorBinding } from "./indexerPartitionStream.js";
import { withProjectWriteLock } from "./writeLock.js";
import { runDurableMultiFileTransaction, type DurableMultiFileFailureInjector } from "./durableMultiFileTransaction.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { readCandidateRecords, candidateRecordsContent, CANDIDATE_LEDGER_FILE } from "./candidateLedger.js";
import { readProjectIndexerCandidateCompileStatus, INDEXER_CANDIDATE_COMPILE_CURRENT_PATH, INDEXER_CURRENT_READINESS_PATH } from "./indexerCandidateCompileActions.js";
import { INDEXER_CURRENT_FINALIZATION_PATH } from "./indexerComposerFinalization.js";
import { postAuthorCurrentStatePath, postAuthorCurrentEnvelopePath } from "./indexerPostAuthorStorePersistence.js";
import { readIndexerDelivery } from "./indexerDelivery.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { encodeTemplateSnapshots } from "./indexerTemplateSnapshots.js";
import { recoveryJournals, RECOVERY_COMMAND } from "./taskRecovery.js";

function articles(spec: MainRunSpec) {
  const plan = spec.validation.page_plan as { articles?: unknown[] } | undefined;
  return (plan?.articles ?? []).map(value => indexerArticlePlanSchema.parse(value));
}
function articleRefs(spec: MainRunSpec) {
  return articles(spec).map(article => indexerArtifactRef(canonicalIndexerNodeRef(spec.validation.expected_subject_key),
    { artifact_id: article.key, artifact_kind: article.artifact_intent.split("/").at(-1)! }));
}
export function recoveryWorksetClosure(specs: readonly MainRunSpec[], requested: ReadonlySet<string>): Set<string> {
  const selected = new Set(requested);
  let changed = true;
  while (changed) {
    changed = false;
    const refs = new Set(specs.filter(spec => selected.has(spec.request.workset.workset_digest)).flatMap(articleRefs));
    for (const spec of specs) if (!selected.has(spec.request.workset.workset_digest) &&
      articles(spec).some(article => article.knowledge_dependencies?.some(dep => refs.has(dep.artifact_ref)))) {
      selected.add(spec.request.workset.workset_digest); changed = true;
    }
  }
  return selected;
}

function repairedSpec(spec: MainRunSpec, instruction: string, revision: string): MainRunSpec {
  const { workset_digest: _digest, repair_intent: _repair, ...payload } = spec.request.workset;
  void _digest; void _repair;
  const workset = buildIndexerMainWorkset({ ...payload,
    repair_intent: buildIndexerRepairIntent({ target_ref: `recovery:${revision}`, instruction }) });
  const request = buildIndexerMainRunRequest({ workset,
    composition_input: composeIndexerLayerInput({ workset_digest: workset.workset_digest,
      final_authority_layer_ref: spec.request.composition_input.final_authority_layer_ref,
      fragments: spec.request.composition_input.accepted_fragments }),
    final_authority: spec.request.final_authority, run_environment: spec.request.run_environment });
  return normalizeRunSpec({ protocol: "context.indexer.main-run-spec/v1", request, validation: spec.validation });
}

export async function recoverAuthorTask(input: {
  projectRoot: string; operation: "author" | "plan"; worksets: string[]; instruction: string;
  apply?: boolean; plan_digest?: string; inject_failure?: DurableMultiFileFailureInjector;
}) {
  const root = input.projectRoot;
  if (!input.instruction.trim() || !input.worksets.length) throw new TypeError("Select listed worksets and give a concrete correction instruction.");
  return withProjectWriteLock(root, "recover-author-task", async () => {
    if ((await recoveryJournals(root)).length) throw new TypeError(`Pending transaction: run ${RECOVERY_COMMAND} --operation transactions first.`);
    if ((await readMaintenance(root)).active) throw new TypeError("Maintenance is active; use its scoped revision/cancel action, not production recovery.");
    const { readApprovedRevision } = await import("./approvedRevision.js");
    const { readKnowledgeUpdate } = await import("./knowledgeUpdate.js");
    const { readTaskRollback } = await import("./taskRollback.js");
    if (await readApprovedRevision(root) || await readKnowledgeUpdate(root) || await readTaskRollback(root)) {
      throw new TypeError("A page/source revision or task rollback is active. Continue its scoped recovery; production Author recovery does not own that state.");
    }
    const ledger = await currentLedger(root);
    if (!ledger?.entries.length || ledger.entries.some(entry => entry.stage !== "author")) throw new TypeError("No readable current Author ledger. Inspect recovery; do not guess a replacement ledger.");
    const checkpoint = await readRecoveryCheckpoint(root);
    const baseline = await recoveryBaselineGuard(root);
    if (input.operation === "plan") {
      const decisionText = await recoveryText(root, ".tmp/context-runtime/indexer/structure-review/current.json");
      const decision = decisionText === undefined ? undefined : JSON.parse(decisionText) as { revision?: string; decision?: string };
      if (!checkpoint || decision?.decision !== "approved" || decision.revision !== checkpoint.structure_revision) {
        throw new TypeError("The checkpoint is not the currently accepted structure decision. Finish structure review or replan before restoring Author work.");
      }
    }
    if (input.operation === "plan" && (!checkpoint || checkpoint.guard !== baseline)) throw new TypeError("Accepted-plan checkpoint is absent or its source/configuration/approved-knowledge baseline changed. Use scoped revision or replanning; do not restore this checkpoint.");
    const specs = await Promise.all(ledger.entries.map(entry => currentSpec({ projectRoot: root, request_digest: entry.execution_request_digest })));
    const selected = new Set(input.worksets);
    if (selected.size !== input.worksets.length || [...selected].some(digest => !ledger.entries.some(entry => entry.workset_digest === digest))) throw new TypeError("Recovery worksets must be unique identities in the current Author ledger.");
    // Include transitive article consumers; dependencies are explicit references,
    // never inferred from prose, filenames or a model judgment in the CLI.
    for (const digest of recoveryWorksetClosure(specs, selected)) selected.add(digest);
    if (ledger.entries.some(entry => selected.has(entry.workset_digest) && entry.state === "accepted") &&
      (!checkpoint || checkpoint.guard !== baseline)) throw new TypeError("Selected work may already be published or its baseline changed. Use the approved-page revision flow; automatic draft recovery cannot undo published work.");
    const bases = await Promise.all(specs.map(async spec => {
      if (input.operation !== "plan" || !selected.has(spec.request.workset.workset_digest)) return spec;
      const binding = partitionAuthorBinding(spec);
      const matches = checkpoint!.entries.filter(entry => entry.binding === binding);
      if (matches.length !== 1) throw new TypeError("No unique accepted planning baseline for this workset; replan through the current workflow.");
      const basis = await currentSpec({ projectRoot: root, request_digest: matches[0]!.request_digest });
      if (partitionAuthorBinding(basis) !== binding) throw new TypeError("Checkpoint request binding mismatch.");
      return basis;
    }));
    const candidates = await readCandidateRecords(root);
    const compile = candidates.length ? (await readProjectIndexerCandidateCompileStatus(root)).compile : undefined;
    if (candidates.length && !compile) throw new TypeError("Cannot attribute current drafts to their Author worksets. Preserve drafts and write an issue report instead of clearing the ledger.");
    const removed = new Set(candidates.filter(candidate => {
      const file = compile?.files.find(item => item.file_digest === candidate.indexer_candidate.file_digest);
      const binding = compile?.result_bindings.find(item => item.artifact_result_digest === file?.artifact_result_digest);
      if (!binding) throw new TypeError("Draft ownership is unavailable; no recovery changes were made.");
      return selected.has(binding.workset_digest);
    }).map(candidate => candidate.candidate_id));
    // Review can publish a page before close refreshes knowledge/structure.yaml.
    // Missing candidates alone do not prove draft ownership; also protect those files.
    if (compile) for (const file of compile.files) {
      const owner = compile.result_bindings.find(binding => binding.artifact_result_digest === file.artifact_result_digest);
      if (owner && selected.has(owner.workset_digest) &&
        !candidates.some(candidate => candidate.indexer_candidate.file_digest === file.file_digest) &&
        await recoveryText(root, file.output_path) !== undefined) {
        throw new TypeError("Selected Author output is already approved. Use approved-page revision; draft recovery preserves it.");
      }
    }
    const delivery = await readIndexerDelivery(root);
    const paths = [INDEXER_MAIN_RUN_CURRENT_PATH, CANDIDATE_LEDGER_FILE,
      INDEXER_CURRENT_FINALIZATION_PATH, INDEXER_CURRENT_READINESS_PATH, INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
      ".tmp/context-runtime/lifecycle/current-indexer-batch.json", ".tmp/context-runtime/indexer/delivery.json",
      ...[...selected].flatMap(digest => [postAuthorCurrentStatePath(digest), postAuthorCurrentEnvelopePath(digest)])];
    const before = new Map(await Promise.all(paths.map(async path => [path, await recoveryText(root, path)] as const)));
    const revision = indexerProtocolDigest({ operation: input.operation, instruction: input.instruction,
      selected: [...selected].sort(), baseline, checkpoint: checkpoint?.digest ?? null,
      specs: specs.map(spec => spec.spec_digest), bases: bases.map(spec => spec.spec_digest), state: [...before] });
    const effects = { requested_worksets: input.worksets, affected_worksets: [...selected],
      discarded_candidates: [...removed], preserves: ["approved knowledge", "src/knowledge-map.yaml", "source snapshots", "unrelated Author results and drafts", "existing packages"],
      invalidates: "Current batch and delivery projections; unrelated accepted results remain reusable. Removed drafts are archived until lifecycle cleanup." };
    if (!input.apply) return { action: "preview", operation: input.operation, revision, ...effects,
      next: `${RECOVERY_COMMAND} --operation ${input.operation} --workset <same-digests> --instruction <same-correction> --apply --plan-digest '${revision}'` };
    if (input.plan_digest !== revision) throw new TypeError("Recovery preview is stale; nothing changed. Preview the current worksets again.");
    const nextSpecs = bases.map((basis, index) => selected.has(specs[index]!.request.workset.workset_digest)
      ? repairedSpec(basis, input.instruction, revision) : basis);
    const recovered = recoverIndexerMainRunLedger({ workset_set: buildIndexerMainWorksetSet(nextSpecs.map(spec => spec.request.workset)),
      run_identities: nextSpecs.map(spec => ({ workset_digest: spec.request.workset.workset_digest, execution_request_digest: spec.request.execution_request_digest })) });
    const payload = { protocol: recovered.protocol, workset_set: recovered.workset_set,
      entries: recovered.entries.map(entry => ledger.entries.find(old => old.workset_digest === entry.workset_digest) ?? entry) };
    let nextLedger = validateIndexerMainRunLedger({ ...payload, ledger_digest: indexerProtocolDigest(payload) });
    // Start the repair before shared delivery projections are considered again.
    // Preserve an existing independent running batch instead of exceeding its size.
    if (!nextLedger.entries.some(entry => entry.state === "running")) {
      const first = nextLedger.entries.find(entry => entry.state === "pending" && !ledger.entries.some(old => old.workset_digest === entry.workset_digest));
      if (first) nextLedger = startIndexerMainRun({ ledger: nextLedger, workset_digest: first.workset_digest });
    }
    const targets: IndexerProjectFileTarget[] = [];
    async function write(path: string, content: string | undefined) {
      const old = before.has(path) ? before.get(path) : await recoveryText(root, path);
      if (old === content) return;
      targets.push(content === undefined ? { path, operation: "delete", base_digest: durableContentDigest(old!), target_digest: null }
        : { path, operation: "write", base_digest: old === undefined ? null : durableContentDigest(old), target_digest: durableContentDigest(content), content });
    }
    for (const path of paths) if (![INDEXER_MAIN_RUN_CURRENT_PATH, CANDIDATE_LEDGER_FILE, ".tmp/context-runtime/indexer/delivery.json"].includes(path)) await write(path, undefined);
    await write(INDEXER_MAIN_RUN_CURRENT_PATH, JSON.stringify(nextLedger));
    await write(CANDIDATE_LEDGER_FILE, candidateRecordsContent(candidates.filter(candidate => !removed.has(candidate.candidate_id))));
    if (delivery) {
      const { partial: _partial, ...rest } = delivery; void _partial;
      await write(".tmp/context-runtime/indexer/delivery.json", JSON.stringify({ ...rest, current: [], closed: false, early_requested: true }));
    }
    for (const spec of nextSpecs) if (!specs.some(old => old.spec_digest === spec.spec_digest)) {
      const path = runSpecPath(spec.request.execution_request_digest);
      if (await recoveryText(root, path) !== undefined) throw new TypeError("Recovery request already exists; inspect the current ledger before retrying.");
      await write(path, JSON.stringify(await encodeTemplateSnapshots(root, spec)));
    }
    const archive = `${RECOVERY_ROOT}/attempts/${revision.slice(7)}.json`;
    await write(archive, JSON.stringify({ operation: input.operation, revision, effects, previous: [...before] }));
    await runDurableMultiFileTransaction({ projectRoot: root, kind: "recover-author-task", proposal_digest: revision,
      targets: targets.sort((a, b) => a.path.localeCompare(b.path)),
      ...(input.inject_failure ? { inject_failure: input.inject_failure } : {}) });
    return { action: "author-recovered", revision, ...effects, local_archive: archive,
      next: "context status --format json", guidance: "Read the new Route and request identities; never replay the old revision. If Route still fails, return to task recover and prepare a sanitized issue." };
  });
}
