import { DEFAULT_RESOURCE_POLICY, fetchFeishuDocSnapshot, runLarkCommand, type LarkRunner } from "../lib/feishu.js";
import type { LarkAccessIdentity, LarkResourceMaterializationPolicy } from "../lib/larkResourceMaterialization.js";
import { larkSnapshotError, larkSnapshotUrl, reserveSnapshotDirectory, writeLarkSnapshotBundle } from "./larkSnapshotBundle.js";

/** Standalone capture only: no registry, phases, workflow, or knowledge writes. */
export async function fetchLarkSource(input: {
  url: string; output: string; identity?: LarkAccessIdentity; workspaceRoot?: string;
  runner?: LarkRunner; now?: Date; resourcePolicy?: Partial<LarkResourceMaterializationPolicy>;
}) {
  larkSnapshotUrl(input.url);
  const identity = input.identity ?? "bot";
  const resourcePolicy = { ...DEFAULT_RESOURCE_POLICY, ...input.resourcePolicy };
  const directory = await reserveSnapshotDirectory(input.output, input.workspaceRoot);
  const execute = input.runner ?? runLarkCommand;
  let responsePages: string[] = [];
  const runner: LarkRunner = async (args, options) => {
    const as = args.indexOf("--as");
    if (as < 0 || args[as + 1] !== identity) throw larkSnapshotError("Standalone fetch cannot change the selected identity", "identity-mismatch");
    const result = await execute(args, options);
    if (result.stdout.trim().startsWith("{")) {
      let envelope: { identity?: unknown } | undefined;
      try { envelope = JSON.parse(result.stdout) as { identity?: unknown }; } catch { /* Existing readers report malformed responses. */ }
      if (envelope?.identity !== undefined && envelope.identity !== identity) {
        throw larkSnapshotError("Lark returned a different identity; no portable snapshot was accepted", "identity-mismatch");
      }
    }
    if (args[0] === "docs" && args[1] === "+fetch" && args[args.indexOf("--doc") + 1] === input.url && result.exitCode === 0) {
      if (!args.includes("--offset")) responsePages = [];
      responsePages.push(result.stdout);
    }
    return result;
  };
  const fetched = await fetchFeishuDocSnapshot({ url: input.url, identity, allowIdentityFallback: false,
    resourcePolicy,
  }, runner);
  if (fetched.accessIdentity !== identity || fetched.identityFallback) {
    throw larkSnapshotError("Standalone fetch did not preserve the selected identity", "identity-mismatch");
  }
  const capturedAt = (input.now ?? new Date()).toISOString();
  const receipt = await writeLarkSnapshotBundle({ directory, url: input.url, capturedAt, responsePages, fetched, resourcePolicy });
  const partial = fetched.fidelity.evidence_status === "error" || fetched.resourceMaterialization.status === "error";
  return { kind: "source.fetch.lark.result", status: partial ? "partial" : "captured", snapshot_dir: directory,
    manifest: `${directory}/snapshot.json`, url: receipt.url, access_identity: receipt.access_identity,
    captured_at: receipt.captured_at,
    resource_policy: receipt.resource_policy,
    ...(receipt.title === undefined ? {} : { title: receipt.title }),
    ...(receipt.revision_id === undefined ? {} : { revision_id: receipt.revision_id }),
    document: `${directory}/${receipt.document.path}`,
    assets: receipt.assets.length, fidelity: fetched.fidelity,
    resource_materialization: fetched.resourceMaterialization,
    import_input: { type: "lark", snapshot_dir: directory },
    next: "Read the snapshot and resource gaps. After selecting and registering a matching source, pass its name and snapshot_dir to context source import.",
  };
}
