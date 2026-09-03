import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  canonicalIndexerNodeRef,
  indexerProtocolDigest,
  indexerRegistryDigests,
  planIndexerPostAuthorComposition,
  type IndexerRegistry,
  type IndexerEffectiveComposerSet,
  type IndexerPostAuthorPlan,
  type IndexerSubjectKey,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import {
  composeIndexerPostAuthorEnvelopeStore,
  postAuthorCurrentEnvelopePath,
  postAuthorCurrentStatePath,
  prepareIndexerPostAuthorRunStore,
} from "../project/indexerPostAuthorRunStore.js";
import { readPostAuthorCurrentState } from
  "../project/indexerPostAuthorStorePersistence.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample",
  kind: "component",
  local_key: "button",
};

function registry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-system"],
      coverage_domains: { architecture: "required" },
      target_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
    }],
    indexers: [],
  };
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-post-author-"));
  const current = registry();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "post-author-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(current), "utf8");
  return {
    root,
    requirementDigest: indexerRegistryDigests(current).requirementSetDigest,
  };
}

async function runInput(
  root: string,
  command: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  const inputPath = join(root, `${command}.json`);
  await writeFile(inputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return JSON.parse(await runCliInDir(root, [
    "indexer", command, "--input", inputPath, "--format", "json",
  ]));
}

function buildPlan(
  effectiveComposerSet: unknown,
  authorWorksetDigest = digest("1"),
  primaryResultDigest = digest("2"),
) {
  return planIndexerPostAuthorComposition({
    effective_composer_set: effectiveComposerSet as IndexerEffectiveComposerSet,
    author_workset_digest: authorWorksetDigest,
    primary_result_digest: primaryResultDigest,
    primary_facts: [{
      fact_ref: "fact:component-summary",
      subject_key: SUBJECT,
      fact_kind: "component-summary",
      value: { summary: "Public control" },
      evidence_refs: [{
        ref: "evidence:component-source",
        kind: "code",
        source_digest: digest("a"),
      }],
    }],
    primary_artifacts: [],
    validator_contract_digest: digest("3"),
    current_profile_binding_digest: digest("4"),
    allowed_target_refs: [canonicalIndexerNodeRef(SUBJECT)],
  });
}

async function prepare(input: {
  root: string;
  requirementDigest: string;
  effectiveComposerSet: unknown;
  authorWorksetDigest?: string;
  primaryResultDigest?: string;
}) {
  const plan = buildPlan(
    input.effectiveComposerSet,
    input.authorWorksetDigest,
    input.primaryResultDigest,
  );
  return {
    plan,
    ...await prepareIndexerPostAuthorRunStore({
      projectRoot: input.root,
      requirement_set_digest: input.requirementDigest,
      plan,
      effective_composer_set: input.effectiveComposerSet as IndexerEffectiveComposerSet,
      validator_contract_digest: digest("3"),
      accepted_input_view_digest: digest("5"),
    }),
  };
}

describe("project post-author composer lifecycle", () => {
  test("runs one selected composer through acceptance and current envelope composition", async () => {
    const { root, requirementDigest } = await project();
    const effective = await runInput(root, "resolve-effective-composers", {
      protocol: "context.indexer.effective-composer-resolution-input/v1",
      requirement_set_digest: requirementDigest,
      selections: [{
        id: "examples",
        provider: "sample-extension",
        composer_selection_entry_digest: digest("6"),
      }],
      manifest_layers: [{
        provider: "sample-extension",
        layer_ref: "provider:sample-extension#layer:supporting",
        layer_integrity: digest("7"),
        bundle_digest: digest("8"),
        composers: [{ id: "examples", supported_profiles: ["component-library"] }],
      }],
      current_profiles: ["component-library"],
    });
    const built = await prepare({
      root,
      requirementDigest,
      effectiveComposerSet: effective,
    });
    expect((built.status as Record<string, unknown>).outcome).toBe(
      "index-post-author-workset-pending",
    );
    const plan = built.plan;
    if (plan.state !== "pending") throw new Error("expected a pending plan");
    const composerRef = plan.worksets[0]!.composer_ref;
    const started = await runInput(root, "start-post-author-composer-run", {
      protocol: "context.indexer.post-author-run-start-input/v1",
      requirement_set_digest: requirementDigest,
      plan,
      ledger: built.ledger,
      composer_ref: composerRef,
    });
    const request = started.request as Record<string, unknown>;
    const resultPayload = {
      protocol: "context.indexer.layer-fragment-result/v1",
      request_digest: request.request_digest,
      composer_ref: request.composer_ref,
      consumed_primary_result_view_digest:
        (request.primary_result_view as Record<string, unknown>).view_digest,
      fragments: [],
    };
    const accepted = await runInput(root, "accept-post-author-composer-run", {
      protocol: "context.indexer.post-author-run-accept-input/v1",
      requirement_set_digest: requirementDigest,
      plan,
      ledger: started.ledger,
      composer_ref: composerRef,
      result: {
        ...resultPayload,
        result_digest: indexerProtocolDigest(resultPayload),
      },
      validator_contract_digest: digest("3"),
    });
    const observation = {
      requirement_set_digest: requirementDigest,
      plan,
      ledger: accepted.ledger,
      effective_composer_set: effective,
      validator_contract_digest: digest("3"),
      accepted_input_view_digest: digest("5"),
    };
    const observed = await runInput(root, "observe-post-author-composer-worksets", {
      protocol: "context.indexer.post-author-observation-input/v1",
      ...observation,
    });
    expect((observed.status as Record<string, unknown>).outcome).toBe(
      "index-post-author-envelope-stale",
    );
    expect(observed.expected_envelope).not.toBeNull();

    let injected = false;
    await expect(composeIndexerPostAuthorEnvelopeStore({
      projectRoot: root,
      plan: plan as unknown as IndexerPostAuthorPlan,
      ledger: accepted.ledger,
      effective_composer_set: effective as unknown as IndexerEffectiveComposerSet,
      validator_contract_digest: digest("3"),
      accepted_input_view_digest: digest("5"),
      inject_failure: (point) => {
        if (!injected && point.startsWith("after-target-rename:")) {
          injected = true;
          throw new Error("simulated envelope publish crash");
        }
      },
    })).rejects.toThrow(/simulated envelope publish crash/);
    const recoveredPublish = await runInput(root, "observe-post-author-composer-worksets", {
      protocol: "context.indexer.post-author-observation-input/v1",
      ...observation,
    });
    expect(recoveredPublish.status).toMatchObject({
      accepted_count: 1,
      post_author_envelope: { state: "current" },
      can_reconcile: true,
    });

    await rm(join(root, postAuthorCurrentStatePath(digest("1"))), { force: true });
    await rm(join(root, postAuthorCurrentEnvelopePath(digest("1"))), { force: true });
    const rebuilt = await prepare({
      root,
      requirementDigest,
      effectiveComposerSet: effective,
    });
    expect(rebuilt.status).toMatchObject({
      accepted_count: 1,
      pending_count: 0,
      post_author_envelope: { state: "stale" },
    });
    await expect(runInput(root, "start-post-author-composer-run", {
      protocol: "context.indexer.post-author-run-start-input/v1",
      requirement_set_digest: requirementDigest,
      plan: rebuilt.plan,
      ledger: rebuilt.ledger,
      composer_ref: composerRef,
    })).rejects.toThrow(/pending or stale/);
    const rebuiltObservation = {
      requirement_set_digest: requirementDigest,
      plan: rebuilt.plan,
      ledger: rebuilt.ledger,
      effective_composer_set: effective,
      validator_contract_digest: digest("3"),
      accepted_input_view_digest: digest("5"),
    };
    const composed = await runInput(root, "compose-indexer-post-author-fragments", {
      protocol: "context.indexer.post-author-compose-input/v1",
      ...rebuiltObservation,
    });
    expect(composed.envelope).toEqual(observed.expected_envelope);
    expect(composed.status).toMatchObject({
      accepted_count: 1,
      pending_count: 0,
      failed_count: 0,
      stale_count: 0,
      post_author_envelope: { state: "current" },
      outcome: "complete",
      can_reconcile: true,
    });
  });

  test("publishes explicit not-required Facts for an empty effective set", async () => {
    const { root, requirementDigest } = await project();
    const effective = await runInput(root, "resolve-effective-composers", {
      protocol: "context.indexer.effective-composer-resolution-input/v1",
      requirement_set_digest: requirementDigest,
      selections: [],
      manifest_layers: [],
      current_profiles: ["component-library"],
    });
    const built = await prepare({
      root,
      requirementDigest,
      effectiveComposerSet: effective,
    });
    expect(built.plan).toMatchObject({ state: "not-required", worksets: [] });
    expect(built.status).toMatchObject({
      total_count: 0,
      accepted_count: 0,
      post_author_envelope: { state: "not-required", digest: null },
      outcome: "complete",
      can_reconcile: true,
    });
    expect(existsSync(join(root, postAuthorCurrentEnvelopePath(digest("1"))))).toBe(false);
  });

  test("returns an interrupted running composer to pending on preparation", async () => {
    const { root, requirementDigest } = await project();
    const effective = await runInput(root, "resolve-effective-composers", {
      protocol: "context.indexer.effective-composer-resolution-input/v1",
      requirement_set_digest: requirementDigest,
      selections: [{
        id: "examples",
        provider: "sample-extension",
        composer_selection_entry_digest: digest("6"),
      }],
      manifest_layers: [{
        provider: "sample-extension",
        layer_ref: "provider:sample-extension#layer:supporting",
        layer_integrity: digest("7"),
        bundle_digest: digest("8"),
        composers: [{ id: "examples", supported_profiles: ["component-library"] }],
      }],
      current_profiles: ["component-library"],
    });
    const built = await prepare({
      root,
      requirementDigest,
      effectiveComposerSet: effective,
    });
    const plan = built.plan;
    if (plan.state !== "pending") throw new Error("expected a pending plan");
    const composerRef = plan.worksets[0]!.composer_ref;
    await runInput(root, "start-post-author-composer-run", {
      protocol: "context.indexer.post-author-run-start-input/v1",
      requirement_set_digest: requirementDigest,
      plan,
      ledger: built.ledger,
      composer_ref: composerRef,
    });
    const recovered = await prepare({
      root,
      requirementDigest,
      effectiveComposerSet: effective,
    });
    expect(recovered.status).toMatchObject({ pending_count: 1, accepted_count: 0 });
    expect((recovered.ledger as Record<string, unknown>).entries).toEqual([
      expect.objectContaining({ state: "pending", composer_ref: composerRef }),
    ]);
  });

  test("keeps current post-author state independently for multiple author worksets", async () => {
    const { root, requirementDigest } = await project();
    const effective = await runInput(root, "resolve-effective-composers", {
      protocol: "context.indexer.effective-composer-resolution-input/v1",
      requirement_set_digest: requirementDigest,
      selections: [],
      manifest_layers: [],
      current_profiles: ["component-library"],
    });
    const first = await prepare({
      root,
      requirementDigest,
      effectiveComposerSet: effective,
      authorWorksetDigest: digest("1"),
      primaryResultDigest: digest("2"),
    });
    const second = await prepare({
      root,
      requirementDigest,
      effectiveComposerSet: effective,
      authorWorksetDigest: digest("6"),
      primaryResultDigest: digest("7"),
    });
    expect(postAuthorCurrentStatePath(digest("1"))).not.toBe(
      postAuthorCurrentStatePath(digest("6")),
    );
    expect((await readPostAuthorCurrentState(root, digest("1")))?.state_digest).toBe(
      first.receipt.state_digest,
    );
    expect((await readPostAuthorCurrentState(root, digest("6")))?.state_digest).toBe(
      second.receipt.state_digest,
    );
  });
});
