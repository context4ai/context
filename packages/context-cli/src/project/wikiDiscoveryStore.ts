import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { LarkReadIdentity } from "../lib/larkReadIdentity.js";
import { parseWikiDiscoveryNode, WikiDiscoveryError, type WikiDiscoveryRoot, type WikiDiscoveryPage } from "../lib/wikiDiscoveryProvider.js";

export interface WikiDiscoveryCursor { parent_node_token: string; page_token?: string }
export interface WikiDiscoveryFailure { reason: string; retryable: boolean; message: string }
export type WikiDiscoveryReceipt = WikiDiscoveryCursor & (
  { status: "completed"; page: WikiDiscoveryPage } |
  { status: "failed"; failure: WikiDiscoveryFailure }
);
export interface WikiDiscoveryMetadata {
  protocol: "context.wiki-discovery.v1";
  url: string;
  identity: LarkReadIdentity;
  root?: WikiDiscoveryRoot;
  root_failure?: WikiDiscoveryFailure;
}

export function wikiDiscoveryDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function wikiDiscoveryPageKey(cursor: WikiDiscoveryCursor): string {
  return wikiDiscoveryDigest(JSON.stringify([cursor.parent_node_token, cursor.page_token ?? ""]));
}
export async function assertWikiDiscoveryPath(root: string, path: string): Promise<void> {
  const base = resolve(root);
  const parts = relative(base, resolve(path)).split(sep);
  if (parts[0] === "..") throw new WikiDiscoveryError("unsafe-checkpoint-path", false, "Discovery checkpoint must stay inside its workspace");
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new WikiDiscoveryError("unsafe-checkpoint-path", false, "Discovery checkpoint paths must not contain symbolic links");
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}
export async function readWikiDiscoveryJson<T>(path: string): Promise<T | undefined> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new WikiDiscoveryError("unsafe-checkpoint-path", false, "Discovery checkpoint must not be a symbolic link");
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw new WikiDiscoveryError("checkpoint-invalid", false, "Discovery checkpoint could not be read; preserve it for inspection rather than restarting the tree");
  }
}
export async function saveWikiDiscoveryJson(path: string, value: unknown): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(value)}\n`);
}
export async function loadWikiDiscoveryReceipts(directory: string): Promise<Map<string, WikiDiscoveryReceipt>> {
  const result = new Map<string, WikiDiscoveryReceipt>();
  await assertWikiDiscoveryPath(directory, join(directory, "pages"));
  await mkdir(join(directory, "pages"), { recursive: true });
  for (const file of await readdir(join(directory, "pages"))) {
    if (!/^[a-f0-9]{64}\.json$/u.test(file)) continue;
    const value = await readWikiDiscoveryJson<WikiDiscoveryReceipt>(join(directory, "pages", file));
    if (!value || typeof value.parent_node_token !== "string" ||
        (value.page_token !== undefined && typeof value.page_token !== "string") ||
        !["completed", "failed"].includes(value.status) ||
        (value.status === "completed" && (!value.page || !Array.isArray(value.page.nodes) ||
          (value.page.next_page_token !== undefined && typeof value.page.next_page_token !== "string"))) ||
        (value.status === "failed" && (!value.failure || typeof value.failure.retryable !== "boolean" ||
          typeof value.failure.reason !== "string" || typeof value.failure.message !== "string")) ||
        `${wikiDiscoveryPageKey(value)}.json` !== file) {
      throw new WikiDiscoveryError("checkpoint-invalid", false, "Discovery page checkpoint is invalid; preserve it for inspection");
    }
    if (value.status === "completed") value.page.nodes = value.page.nodes.map(parseWikiDiscoveryNode);
    result.set(file.slice(0, -5), value);
  }
  return result;
}

interface Lease { pid: number; token: string; released: boolean }
function ownerRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

/** Append-only lease generations avoid replacing another resumer's live lock. */
export async function acquireWikiDiscoveryLease(directory: string): Promise<() => Promise<void>> {
  const leases = join(directory, "leases");
  await assertWikiDiscoveryPath(directory, leases);
  await mkdir(leases, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    const files = (await readdir(leases)).filter((file) => /^\d{12}\.json$/u.test(file)).sort();
    const latest = files.at(-1);
    if (latest) {
      const current = await readWikiDiscoveryJson<Lease>(join(leases, latest));
      if (!current || !Number.isSafeInteger(current.pid) || current.pid <= 0 ||
          typeof current.token !== "string" || typeof current.released !== "boolean") {
        throw new WikiDiscoveryError("checkpoint-invalid", false, "Discovery lease is invalid; preserve it for inspection");
      }
      if (!current.released && ownerRunning(current.pid)) {
        throw new WikiDiscoveryError("job-busy", true, "This Wiki discovery is already running; wait for its receipt instead of starting another writer");
      }
    }
    const sequence = latest ? Number(latest.slice(0, 12)) + 1 : 1;
    const path = join(leases, `${String(sequence).padStart(12, "0")}.json`);
    const owner: Lease = { pid: process.pid, token: randomUUID(), released: false };
    const temporary = join(leases, `.lease-${owner.token}`);
    await writeFile(temporary, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    try {
      // A hardlink publishes a complete owner record and fails if a contender won.
      await link(temporary, path);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue;
      throw error;
    } finally { await rm(temporary, { force: true }); }
    return async () => { await saveWikiDiscoveryJson(path, { ...owner, released: true }); };
  }
  throw new WikiDiscoveryError("job-busy", true, "Another process is advancing this Wiki discovery; retry after it finishes");
}
