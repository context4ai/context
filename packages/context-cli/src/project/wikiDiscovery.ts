import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { LarkReadIdentity } from "../lib/larkReadIdentity.js";
import { createWikiDiscoveryProvider, parseWikiDiscoveryRoot, WikiDiscoveryError, wikiDiscoveryFailure,
  type WikiDiscoveryNode, type WikiDiscoveryProvider, type WikiDiscoveryRoot } from "../lib/wikiDiscoveryProvider.js";
import { acquireWikiDiscoveryLease, assertWikiDiscoveryPath, loadWikiDiscoveryReceipts, readWikiDiscoveryJson, saveWikiDiscoveryJson,
  wikiDiscoveryDigest, wikiDiscoveryPageKey, type WikiDiscoveryCursor, type WikiDiscoveryFailure,
  type WikiDiscoveryMetadata, type WikiDiscoveryReceipt } from "./wikiDiscoveryStore.js";

interface DiscoveredObject {
  obj_type: string;
  obj_token: string;
  canonical_node_token: string;
  aliases: WikiDiscoveryNode[];
}
interface DiscoveryView {
  nodes: Map<string, WikiDiscoveryNode>;
  objects: DiscoveredObject[];
  pending: WikiDiscoveryCursor[];
  failed: Array<WikiDiscoveryCursor & WikiDiscoveryFailure>;
  completed_pages: number;
}
export interface WikiDiscoveryProgress {
  completed_pages: number;
  nodes: number;
  objects: number;
  pending_pages: number;
  failed_pages: number;
}
export interface WikiDiscoveryResult {
  protocol: "context.wiki-discovery.result.v1";
  job_id: string;
  status: "completed" | "partial" | "paused";
  url: string;
  identity: LarkReadIdentity;
  manifest: string;
  counts: WikiDiscoveryProgress;
  failures: Array<WikiDiscoveryCursor & WikiDiscoveryFailure>;
  failures_truncated: boolean;
  checkpoint_error?: string;
  next_action?: { kind: "resume-wiki-discovery"; command: string };
}
export interface DiscoverLarkWikiInput {
  projectRoot: string;
  url: string;
  identity?: LarkReadIdentity;
  resume?: boolean;
  concurrency?: number;
  provider?: WikiDiscoveryProvider;
  signal?: AbortSignal;
  onProgress?: (progress: WikiDiscoveryProgress) => void | Promise<void>;
}

function canonicalUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new WikiDiscoveryError("invalid-url", false, "Provide an absolute Wiki URL"); }
  if (!["https:", "http:"].includes(url.protocol) || !/^\/wiki\/[^/]+\/?$/u.test(url.pathname) || url.username || url.password) {
    throw new WikiDiscoveryError("invalid-url", false, "Provide an http(s) Wiki node URL without credentials");
  }
  url.hash = "";
  return url.toString();
}
function progress(view: DiscoveryView): WikiDiscoveryProgress {
  return { completed_pages: view.completed_pages, nodes: view.nodes.size, objects: view.objects.length,
    pending_pages: view.pending.length, failed_pages: view.failed.length };
}

/** Rebuild only from committed pages, so a stale manifest cannot lose a cursor. */
function replay(root: WikiDiscoveryRoot, receipts: Map<string, WikiDiscoveryReceipt>): DiscoveryView {
  const nodes = new Map<string, WikiDiscoveryNode>();
  const queue: WikiDiscoveryCursor[] = [{ parent_node_token: root.node_token }];
  const parents = new Set([root.node_token]);
  const seen = new Set<string>();
  const pending: WikiDiscoveryCursor[] = [];
  const failed: DiscoveryView["failed"] = [];
  let completed = 0;
  for (let index = 0; index < queue.length; index++) {
    const cursor = queue[index]!;
    const key = wikiDiscoveryPageKey(cursor);
    if (seen.has(key)) continue;
    seen.add(key);
    const receipt = receipts.get(key);
    if (!receipt) { pending.push(cursor); continue; }
    if (receipt.status === "failed") { failed.push({ ...cursor, ...receipt.failure }); continue; }
    completed++;
    for (const item of receipt.page.nodes) {
      if (item.node_token !== root.node_token) nodes.set(item.node_token, item);
      if (item.has_child && !parents.has(item.node_token)) {
        parents.add(item.node_token);
        queue.push({ parent_node_token: item.node_token });
      }
    }
    if (receipt.page.next_page_token) {
      const next = { parent_node_token: cursor.parent_node_token, page_token: receipt.page.next_page_token };
      if (seen.has(wikiDiscoveryPageKey(next))) failed.push({ ...cursor, reason: "pagination-cycle", retryable: false,
        message: "Saved Wiki pages contain a repeated cursor; inspect this directory's page checkpoints" });
      else queue.push(next);
    }
  }
  const objects = new Map<string, DiscoveredObject>();
  for (const item of [...nodes.values()].sort((a, b) => a.node_token.localeCompare(b.node_token))) {
    const key = JSON.stringify([item.obj_type, item.obj_token]);
    const existing = objects.get(key);
    if (existing) {
      existing.aliases.push(item);
      if (item.node_type === "origin") existing.canonical_node_token = item.node_token;
    } else objects.set(key, { obj_type: item.obj_type, obj_token: item.obj_token,
      canonical_node_token: item.node_token, aliases: [item] });
  }
  return { nodes, objects: [...objects.values()], pending, failed, completed_pages: completed };
}

function validatePageCursor(cursor: WikiDiscoveryCursor, next: string | undefined, receipts: Map<string, WikiDiscoveryReceipt>): void {
  if (!next) return;
  const key = wikiDiscoveryPageKey({ parent_node_token: cursor.parent_node_token, page_token: next });
  if (next === cursor.page_token || receipts.get(key)?.status === "completed") {
    throw new WikiDiscoveryError("pagination-cycle", false, "Wiki returned an already completed page cursor; this directory was stopped");
  }
}
function discoveryProvider(input: DiscoverLarkWikiInput): WikiDiscoveryProvider {
  return input.provider ?? createWikiDiscoveryProvider(input.signal ? { signal: input.signal } : {});
}

/** Optional source discovery only: no source registry, capture, phase or planning mutations. */
export async function discoverLarkWiki(input: DiscoverLarkWikiInput): Promise<WikiDiscoveryResult> {
  const url = canonicalUrl(input.url);
  const identity = input.identity ?? "bot";
  if (!["user", "bot"].includes(identity)) throw new WikiDiscoveryError("invalid-identity", false, "Wiki identity must be user or bot");
  const concurrency = input.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new WikiDiscoveryError("invalid-concurrency", false, "Wiki concurrency must be an integer from 1 to 4");
  }
  const jobId = wikiDiscoveryDigest(url);
  const directory = join(input.projectRoot, ".tmp", "context-runtime", "wiki-discovery", jobId);
  await assertWikiDiscoveryPath(input.projectRoot, directory);
  await mkdir(directory, { recursive: true });
  const release = await acquireWikiDiscoveryLease(directory);
  try { return await runDiscovery(input, { directory, url, identity, concurrency, jobId }); }
  finally { await release(); }
}

async function runDiscovery(input: DiscoverLarkWikiInput, job: {
  directory: string; url: string; identity: LarkReadIdentity; concurrency: number; jobId: string;
}): Promise<WikiDiscoveryResult> {
  const { directory, url, identity } = job;
  const metadataPath = join(directory, "job.json");
  let metadata = await readWikiDiscoveryJson<WikiDiscoveryMetadata>(metadataPath);
  if (metadata && (metadata.protocol !== "context.wiki-discovery.v1" || metadata.url !== url || metadata.identity !== identity)) {
    throw new WikiDiscoveryError("job-identity-mismatch", false, "Resume must preserve the discovery's original URL and identity");
  }
  if (metadata && !input.resume) {
    throw new WikiDiscoveryError("resume-required", false, "A discovery checkpoint already exists for this URL; use --resume with the same identity");
  }
  metadata ??= { protocol: "context.wiki-discovery.v1", url, identity };
  if (metadata.root) metadata.root = parseWikiDiscoveryRoot(metadata.root);
  const provider = discoveryProvider(input);
  const receipts = await loadWikiDiscoveryReceipts(directory);
  // Persist identity before the first request, including unsuccessful root resolution.
  await saveWikiDiscoveryJson(metadataPath, metadata);
  if (!metadata.root && (!metadata.root_failure || metadata.root_failure.retryable) && !input.signal?.aborted) {
    try {
      metadata.root = await provider.resolveRoot(url, identity);
      delete metadata.root_failure;
    } catch (error) { metadata.root_failure = wikiDiscoveryFailure(error); }
    await saveWikiDiscoveryJson(metadataPath, metadata);
  }
  if (input.resume) {
    for (const [key, receipt] of receipts) if (receipt.status === "failed" && receipt.failure.retryable) receipts.delete(key);
  }
  const empty: DiscoveryView = { nodes: new Map(), objects: [], pending: [], failed: [], completed_pages: 0 };
  let view = metadata.root ? replay(metadata.root, receipts) : empty;
  let checkpointError: string | undefined;
  let throttled = false;
  while (metadata.root && view.pending.length && !input.signal?.aborted && !checkpointError && !throttled) {
    const root = metadata.root;
    const batch = view.pending.slice(0, job.concurrency);
    await Promise.all(batch.map(async (cursor) => {
      let receipt: WikiDiscoveryReceipt;
      try {
        const page = await provider.listPage({ space_id: root.space_id, identity, ...cursor });
        validatePageCursor(cursor, page.next_page_token, receipts);
        receipt = { ...cursor, status: "completed", page };
      } catch (error) {
        const failure = wikiDiscoveryFailure(error);
        if (failure.reason === "rate-limited") throttled = true;
        receipt = { ...cursor, status: "failed", failure };
      }
      const key = wikiDiscoveryPageKey(cursor);
      try {
        // Separate immutable page identities avoid concurrent manifest overwrites.
        await saveWikiDiscoveryJson(join(directory, "pages", `${key}.json`), receipt);
        receipts.set(key, receipt);
      } catch {
        checkpointError = "A discovery page could not be checkpointed; saved pages remain reusable and unsaved pages must be requested again";
      }
    }));
    view = replay(root, receipts);
    if (input.onProgress) await input.onProgress(progress(view));
  }
  if (metadata.root_failure) view.failed.push({ parent_node_token: "root", ...metadata.root_failure });
  return finishDiscovery(input, { ...job, metadata, view, ...(checkpointError ? { checkpointError } : {}) });
}

async function finishDiscovery(input: DiscoverLarkWikiInput, state: {
  directory: string; url: string; identity: LarkReadIdentity; jobId: string;
  metadata: WikiDiscoveryMetadata; view: DiscoveryView; checkpointError?: string;
}): Promise<WikiDiscoveryResult> {
  const { directory, url, identity, jobId, metadata, view } = state;
  let checkpointError = state.checkpointError;
  let status: WikiDiscoveryResult["status"] = input.signal?.aborted ? "paused"
    : checkpointError || view.pending.length || view.failed.length || !metadata.root ? "partial" : "completed";
  const manifestPath = join(directory, "manifest.json");
  try {
    await saveWikiDiscoveryJson(manifestPath, { protocol: "context.wiki-discovery.manifest.v1", url, identity,
      status, root: metadata.root, counts: progress(view), objects: view.objects,
      pending: view.pending, failed: view.failed, ...(checkpointError ? { checkpoint_error: checkpointError } : {}) });
  } catch {
    checkpointError = "Discovery summary could not be saved; committed page checkpoints remain available for --resume";
    status = "partial";
  }
  return { protocol: "context.wiki-discovery.result.v1", job_id: jobId, status, url, identity,
    manifest: relative(input.projectRoot, manifestPath), counts: progress(view),
    failures: view.failed.slice(0, 10), failures_truncated: view.failed.length > 10,
    ...(checkpointError ? { checkpoint_error: checkpointError } : {}),
    ...(status !== "completed" ? { next_action: { kind: "resume-wiki-discovery" as const,
      command: `context source discover lark '${url.replaceAll("'", "'\\''")}' --resume --as ${identity} --format json` } } : {}),
  };
}
