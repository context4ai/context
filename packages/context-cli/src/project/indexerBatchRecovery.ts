import { createHash } from "node:crypto";
import { join } from "node:path";
import { indexerAgentStepInputSchema } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { readPostAuthorCurrentState } from "./indexerPostAuthorStorePersistence.js";
import type { ContextResolvedWorkflowRoute } from "./workflow/workflowTypes.js";

/** Diagnostic snapshot only. Never replay results or rebind a submitted revision. */
export async function prepareIndexerBatchRecovery(projectRoot: string, route: ContextResolvedWorkflowRoute | undefined) {
  if (route === undefined) return { current_route: null, current_tasks: [], accepted_receipts: null };
  const write = async (value: unknown, suffix: string) => {
    const text = JSON.stringify(value, null, 2) + "\n";
    const digest = createHash("sha256").update(text).digest("hex");
    const file = join(projectRoot, ".tmp/context-runtime/recovery", `${digest}.${suffix}.json`);
    await atomicWriteFile(file, text);
    return { file, digest: `sha256:${digest}` };
  };
  const currentRoute = { ...await write(route, "route"), revision: route.revision, node: route.node };
  const input = indexerAgentStepInputSchema.safeParse(route.action?.input);
  const currentTasks = input.success ? input.data.tasks.map(task => ({
    task_key: task.task_key, stage: input.data.stage, workset_digest: task.workset_digest,
    request_digest: "execution_request_digest" in task ? task.execution_request_digest : task.request_digest,
  })) : [];
  try {
    const ledger = await currentLedger(projectRoot);
    const accepted = [];
    for (const entry of ledger?.entries ?? []) {
      if (entry.state === "accepted") accepted.push({ stage: entry.stage,
        workset_digest: entry.workset_digest, request_digest: entry.execution_request_digest });
      if (entry.stage !== "author") continue;
      const post = await readPostAuthorCurrentState(projectRoot, entry.workset_digest);
      for (const composer of post?.ledger.entries ?? []) {
        if (composer.state === "accepted") accepted.push({ stage: "post-author",
          workset_digest: composer.workset_digest, request_digest: composer.request_digest });
      }
    }
    return { current_route: currentRoute, current_tasks: currentTasks,
      accepted_receipts: { ...await write({ scope: "current-main-ledger-and-its-composers", accepted }, "accepted"),
        count: accepted.length, scope: "current-main-ledger-and-its-composers" },
      guidance: "Task keys are local to this Route. Match workset/request identities when comparing saved work. Read current_route.file and submit only its listed tasks after checking resources. The accepted list covers the current ledger, not all historical deliveries; absence does not authorize replay." };
  } catch (error) {
    return { current_route: currentRoute, current_tasks: currentTasks, accepted_receipts: null,
      accepted_receipts_unavailable: error instanceof Error ? error.message : String(error) };
  }
}
