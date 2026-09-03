import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  indexerRegistryDigests,
  parseIndexerRegistry,
  reconcileIndexerResults,
} from "@c4a/context";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import { readCurrentIndexerPostAuthorEnvelopeForResult } from "./indexerPostAuthorRunStore.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

export async function reconcileProjectIndexerResults(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "Indexer reconciliation input");
  if (value.protocol !== "context.indexer.result-reconciliation-input/v1") {
    throw new TypeError(
      "Indexer reconciliation input.protocol must be context.indexer.result-reconciliation-input/v1",
    );
  }
  const registry = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  if (value.requirement_set_digest !== indexerRegistryDigests(registry).requirementSetDigest) {
    throw new TypeError("Indexer reconciliation input targets a stale requirement set");
  }
  const selectorPaths = array(
    value.allowed_selector_fact_paths,
    "Indexer reconciliation allowed_selector_fact_paths",
  ).map((item) => String(item));
  if (new Set(selectorPaths).size !== selectorPaths.length) {
    throw new TypeError("Indexer reconciliation selector fact paths must be unique");
  }
  const acceptedRecords = await readAcceptedIndexerMainAuthorResultRecords(
    input.projectRoot,
  );
  for (const item of acceptedRecords) {
    const accepted = record(item.accepted_record, "accepted author record");
    await readCurrentIndexerPostAuthorEnvelopeForResult({
      projectRoot: input.projectRoot,
      author_workset_digest: String(accepted.workset_digest ?? ""),
      primary_result_digest: String(accepted.result_digest ?? ""),
    });
  }
  return reconcileIndexerResults({
    registry,
    question_target_inventory: value.question_target_inventory,
    resolved_questions: array(
      value.resolved_questions,
      "Indexer reconciliation resolved_questions",
    ) as Parameters<typeof reconcileIndexerResults>[0]["resolved_questions"],
    target_facts: record(value.target_facts, "Indexer reconciliation target_facts") as
      Parameters<typeof reconcileIndexerResults>[0]["target_facts"],
    allowed_selector_fact_paths: new Set(selectorPaths),
    author_results: acceptedRecords.map((item) => item.artifact_result),
    registered_material_sources: array(
      value.registered_material_sources,
      "Indexer reconciliation registered_material_sources",
    ),
  });
}
