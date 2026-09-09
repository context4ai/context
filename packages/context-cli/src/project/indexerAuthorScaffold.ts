import { createHash } from "node:crypto";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { CurrentIndexerBatchTask } from "./indexerCurrentBatch.js";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Mechanical defaults only. Empty prose and undecided member states prevent a
 * scaffold from being mistaken for an authored, validated submission. */
export function scaffoldAuthorTask(task: Pick<CurrentIndexerBatchTask, "spec" | "descriptor">) {
  const workset = task.spec.request.workset;
  if (workset.stage !== "author") throw new TypeError("scaffold-current requires an Author task");
  const validation = task.spec.validation;
  const plan = object(validation.page_plan);
  const variants = object(validation.artifact_policy_eligibility).eligible_variants;
  const policies = Array.isArray(variants) ? variants.map(object) : [];
  const members = validation.canonical_inventory_members as { member_id: string }[];
  return { task_key: task.descriptor.task_key, result: {
    stage: "author", group_key: workset.group_key, outcome: "publish",
    ...(typeof plan.artifact_intent === "string" ? { artifact_intent: plan.artifact_intent } : {}),
    ...(policies.length === 1 ? { policy: policies[0]!.id } : {}),
    title: "", summary: "", sections: [],
    member_dispositions: members.map(member => ({ item: member.member_id, state: "" })),
  } };
}

export async function prepareAuthorScaffoldResource(input: {
  projectRoot: string; revision: string;
  tasks: readonly Pick<CurrentIndexerBatchTask, "spec" | "descriptor">[];
}) {
  const payload = { stage: "author", results: input.tasks.map(scaffoldAuthorTask) };
  const text = JSON.stringify(payload, null, 2) + "\n";
  const digest = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  const identity = createHash("sha256").update(input.revision).update(text).digest("hex");
  const path = join(input.projectRoot, ".tmp/context-runtime/author-scaffolds", `${identity}.json`);
  await atomicWriteFile(path, text);
  return { id: "indexer-author-scaffold", kind: "procedure" as const,
    media_type: "application/json", digest, path, revision: input.revision,
    read_state: "read-required" as const };
}
