import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexerProtocolDigest, planIndexerPostAuthorComposition,
  resolveEffectiveIndexerComposers } from "@c4a/context";
import { createPostAuthorContinuationResolver } from "../project/indexerPostAuthorContinuation.js";
import { normalizePostAuthorRunSpec, postAuthorAcceptedPath } from "../project/indexerPostAuthorStorePersistence.js";
import { prepareIndexerPostAuthorRunStore, startIndexerPostAuthorRunsStore,
  completeIndexerPostAuthorRunsStore, composeIndexerPostAuthorEnvelopeStore } from "../project/indexerPostAuthorRunStore.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const digest = (value: string) => indexerProtocolDigest(value);
const layerRef = "provider:community#layer:primary";
const instructionLayers = new Set([layerRef]);
function spec(bundle: string, primary = "primary", selection = "selection", validator = "validator") {
  const effective = resolveEffectiveIndexerComposers({
    selections: ["examples", "reference"].map((id) => ({ id, provider: "community",
      composer_selection_entry_digest: digest(`${selection}/${id}`) })),
    manifest_layers: [{ provider: "community", layer_ref: layerRef,
      layer_integrity: digest(bundle), bundle_digest: digest(bundle),
      composers: ["examples", "reference"].map((id) => ({ id, supported_profiles: ["component-library"] })) }],
    current_profiles: ["component-library"],
  });
  const plan = planIndexerPostAuthorComposition({ effective_composer_set: effective,
    author_workset_digest: digest("author"), primary_result_digest: digest(primary),
    primary_facts: [], primary_artifacts: [], validator_contract_digest: digest(validator),
    current_profile_binding_digest: digest("profile"), allowed_target_refs: [] });
  return normalizePostAuthorRunSpec({ requirement_set_digest: digest("requirements"),
    plan, effective_composer_set: effective, validator_contract_digest: digest(validator),
    accepted_input_view_digest: digest("input") });
}
async function start(root: string, selected: ReturnType<typeof spec>, index: number) {
  const prepared = await prepareIndexerPostAuthorRunStore({ projectRoot: root, ...selected });
  const started = await startIndexerPostAuthorRunsStore({ projectRoot: root,
    runs: [{ plan: selected.plan, ledger: prepared.ledger,
      composer_ref: selected.plan.worksets[index]!.composer_ref }] });
  return started.tasks[0]!;
}
async function accept(root: string, selected: ReturnType<typeof spec>, task: Awaited<ReturnType<typeof start>>) {
  const result = { protocol: "context.indexer.layer-fragment-result/v1",
    request_digest: task.request.request_digest, composer_ref: task.request.composer_ref,
    consumed_primary_result_view_digest: task.request.primary_result_view.view_digest, fragments: [] };
  return completeIndexerPostAuthorRunsStore({ projectRoot: root, runs: [{
    plan: selected.plan, ledger: task.ledger, composer_ref: task.request.composer_ref,
    outcome: "accept", result: { ...result, result_digest: indexerProtocolDigest(result) },
    validator_contract_digest: selected.validator_contract_digest,
  }] });
}

test("restores old accepted receipts after a bundle refresh already reissued running tasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-composer-continuation-")); roots.push(root);
  const old = spec("old"), installed = spec("installed");
  const task = await start(root, old, 0);
  expect((await accept(root, old, task)).outcomes[0]).toMatchObject({ outcome: "accepted", committed: true });
  const cache = join(root, postAuthorAcceptedPath(task.request.request_digest));
  const bytes = await readFile(cache, "utf8");
  // Reproduce the earlier CLI's recovery: same work, new bundle-bound request.
  await start(root, installed, 0);
  const continued = await createPostAuthorContinuationResolver(root)(installed, instructionLayers);
  expect(continued.plan.worksets[0]).toEqual(old.plan.worksets[0]);
  expect(continued.plan.worksets[1]).toEqual(installed.plan.worksets[1]);
  const recovered = await prepareIndexerPostAuthorRunStore({ projectRoot: root, ...continued });
  expect(recovered.ledger.entries[0]).toMatchObject({ state: "accepted", request_digest: task.request.request_digest });
  expect(recovered.ledger.entries[1]!.state).not.toBe("accepted");
  expect(await readFile(cache, "utf8")).toBe(bytes);
  const remaining = await start(root, continued, 1);
  expect(remaining.request.composer_ref).not.toBe(task.request.composer_ref);
  await accept(root, continued, remaining);
  const ready = await prepareIndexerPostAuthorRunStore({ projectRoot: root, ...continued });
  const composed = await composeIndexerPostAuthorEnvelopeStore({ projectRoot: root,
    ...continued, ledger: ready.ledger });
  expect(composed.status.can_reconcile).toBe(true);
  expect(await createPostAuthorContinuationResolver(root)(installed, instructionLayers)).toEqual(continued);
  expect((await prepareIndexerPostAuthorRunStore({ projectRoot: root, ...continued })).receipt.transaction).toBeNull();
});

test("changed primary, selection, requirements or validator and non-instruction layers keep new work", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-composer-boundary-")); roots.push(root);
  const old = spec("old"), installed = spec("installed");
  const first = await start(root, old, 0);
  await accept(root, old, first);
  const resolve = createPostAuthorContinuationResolver(root);
  expect(await resolve(installed, new Set())).toEqual(installed);
  for (const changed of [spec("installed", "changed-primary"), spec("installed", "primary", "changed-selection"),
    spec("installed", "primary", "selection", "changed-validator"),
    normalizePostAuthorRunSpec({ ...installed, requirement_set_digest: digest("changed-requirement") }),
    normalizePostAuthorRunSpec({ ...installed, accepted_input_view_digest: digest("changed-input") })]) {
    expect(await resolve(changed, instructionLayers)).toEqual(changed);
  }
  // A missing receipt never becomes an accepted run just because the view matches.
  await rm(join(root, postAuthorAcceptedPath(first.request.request_digest)));
  expect(await createPostAuthorContinuationResolver(root)(installed, instructionLayers)).toEqual(installed);
  expect((await prepareIndexerPostAuthorRunStore({ projectRoot: root, ...installed })).status.accepted_count).toBe(0);
});

test("a matching historical receipt is validated before any result is recovered", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-composer-invalid-cache-")); roots.push(root);
  const old = spec("old"), installed = spec("installed");
  const task = await start(root, old, 0); await accept(root, old, task);
  await start(root, installed, 0);
  const cache = join(root, postAuthorAcceptedPath(task.request.request_digest));
  const value = JSON.parse(await readFile(cache, "utf8")); value.receipt.primary_result_view_digest = digest("forged");
  await writeFile(cache, JSON.stringify(value));
  const continued = await createPostAuthorContinuationResolver(root)(installed, instructionLayers);
  await expect(prepareIndexerPostAuthorRunStore({ projectRoot: root, ...continued }))
    .rejects.toThrow("accepted cache record failed integrity validation");
});
