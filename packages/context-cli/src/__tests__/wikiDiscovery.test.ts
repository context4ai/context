import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLarkWiki } from "../project/wikiDiscovery.js";
import { wikiDiscoveryDigest, wikiDiscoveryPageKey } from "../project/wikiDiscoveryStore.js";
import { WikiDiscoveryError, type WikiDiscoveryNode, type WikiDiscoveryProvider,
  type WikiDiscoveryRequest } from "../lib/wikiDiscoveryProvider.js";

const directories: string[] = [];
const url = "https://example.larkoffice.com/wiki/root";
async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "context-wiki-discovery-"));
  directories.push(path);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function node(token: string, hasChild = false, object = token, type = "docx"): WikiDiscoveryNode {
  return { node_token: token, obj_token: object, obj_type: type, title: token, has_child: hasChild, node_type: "origin" };
}
function provider(list: WikiDiscoveryProvider["listPage"]): WikiDiscoveryProvider {
  return { resolveRoot: async () => ({ ...node("root", true), space_id: "123" }), listPage: list };
}
function jobDirectory(root: string): string {
  return join(root, ".tmp", "context-runtime", "wiki-discovery", wikiDiscoveryDigest(url));
}

test("persists pages, resumes remaining cursors and retains aliases by object type and token", async () => {
  const root = await fixture();
  const controller = new AbortController();
  const requests: WikiDiscoveryRequest[] = [];
  let resolutions = 0;
  const source: WikiDiscoveryProvider = {
    resolveRoot: async (_url, identity) => { expect(identity).toBe("bot"); resolutions++; return { ...node("root", true), space_id: "123" }; },
    listPage: async input => {
      expect(input.identity).toBe("bot"); requests.push(input);
      if (input.parent_node_token === "folder") return { nodes: [node("detail")] };
      if (input.page_token === "second") return { nodes: [node("origin", false, "shared"), node("sheet", false, "shared", "sheet")] };
      return { nodes: [node("folder", true), { ...node("alias", false, "shared"), node_type: "shortcut" }], next_page_token: "second" };
    },
  };
  const first = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", provider: source,
    signal: controller.signal, onProgress: () => controller.abort() });
  expect(first.status).toBe("paused");
  expect(first.counts).toEqual({ completed_pages: 1, nodes: 2, objects: 2, pending_pages: 2, failed_pages: 0 });
  const resumed = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true, provider: source });
  expect(resumed.status).toBe("completed");
  expect(resolutions).toBe(1);
  expect(requests).toHaveLength(3);
  expect(resumed.counts).toEqual({ completed_pages: 3, nodes: 5, objects: 4, pending_pages: 0, failed_pages: 0 });
  const manifest = JSON.parse(await readFile(join(root, resumed.manifest), "utf8"));
  const shared = manifest.objects.find((item: { obj_type: string; obj_token: string }) => item.obj_type === "docx" && item.obj_token === "shared");
  expect(shared.canonical_node_token).toBe("origin");
  expect(shared.aliases.map((item: WikiDiscoveryNode) => item.node_token)).toEqual(["alias", "origin"]);
  // Discovery never writes the source registry or any knowledge lifecycle state.
  expect(await readFile(join(root, "sources", "lark", "index.yaml"), "utf8").catch(() => "absent")).toBe("absent");
  await rm(join(root, resumed.manifest));
  const replay = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true,
    provider: provider(async () => { throw new Error("must reuse page journal"); }) });
  expect(replay.status).toBe("completed");
  expect(replay.counts).toEqual(resumed.counts);
});

test("permanent directory failures do not block peers or repeat on resume; transient failures retry only their page", async () => {
  const root = await fixture();
  const calls: string[] = [];
  let transientFailed = false;
  const source = provider(async input => {
    calls.push(input.parent_node_token);
    if (input.parent_node_token === "root") return { nodes: [node("denied", true), node("transient", true), node("allowed", true)] };
    if (input.parent_node_token === "denied") throw new WikiDiscoveryError("access-unavailable", false, "Denied");
    if (input.parent_node_token === "transient" && !transientFailed) { transientFailed = true; throw new WikiDiscoveryError("service-unavailable", true, "Unavailable"); }
    return { nodes: [node(`${input.parent_node_token}-child`)] };
  });
  const first = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", provider: source });
  expect(first.status).toBe("partial");
  expect(first.counts.failed_pages).toBe(2);
  const second = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true, provider: source });
  expect(second.status).toBe("partial");
  expect(second.counts.failed_pages).toBe(1);
  expect(calls.filter(value => value === "denied")).toHaveLength(1);
  expect(calls.filter(value => value === "transient")).toHaveLength(2);
  expect(calls.filter(value => value === "root")).toHaveLength(1);
  expect(second.failures[0]?.retryable).toBe(false);
});

test("throttling exhaustion preserves unscheduled directories as pending for resume", async () => {
  const root = await fixture();
  const calls: string[] = [];
  const result = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", concurrency: 1,
    provider: provider(async input => {
      calls.push(input.parent_node_token);
      if (input.parent_node_token === "root") return { nodes: [node("limited", true), node("later", true)] };
      throw new WikiDiscoveryError("rate-limited", true, "Retry budget exhausted");
    }) });
  expect(result.status).toBe("partial");
  expect(calls).toEqual(["root", "limited"]);
  expect(result.counts.pending_pages).toBe(1);
});

test("a failed checkpoint is partial and does not discard other saved pages", async () => {
  const root = await fixture();
  const pages = join(jobDirectory(root), "pages");
  const badPath = join(pages, `${wikiDiscoveryPageKey({ parent_node_token: "bad" })}.json`);
  const source = provider(async input => {
    if (input.parent_node_token === "root") return { nodes: [node("bad", true), node("good", true)] };
    if (input.parent_node_token === "bad") await mkdir(badPath);
    return { nodes: [node(`${input.parent_node_token}-child`)] };
  });
  const first = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", provider: source });
  expect(first.status).toBe("partial");
  expect(first.checkpoint_error).toBeDefined();
  expect(first.counts.completed_pages).toBe(2);
  await rm(badPath, { recursive: true });
  const requests: string[] = [];
  const resumed = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true,
    provider: provider(async input => { requests.push(input.parent_node_token); return { nodes: [node("bad-child")] }; }) });
  expect(resumed.status).toBe("completed");
  expect(requests).toEqual(["bad"]);
});

test("resume cannot change identity and concurrent resumptions cannot become two writers", async () => {
  const root = await fixture();
  const abort = new AbortController();
  await discoverLarkWiki({ projectRoot: root, url, identity: "bot", signal: abort.signal,
    onProgress: () => abort.abort(), provider: provider(async () => ({ nodes: [node("child", true)] })) });
  await expect(discoverLarkWiki({ projectRoot: root, url, identity: "user", resume: true })).rejects.toMatchObject({ reason: "job-identity-mismatch" });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const source = provider(async () => { entered(); await hold; return { nodes: [] }; });
  const winner = discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true, provider: source });
  await started;
  await expect(discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true, provider: source })).rejects.toMatchObject({ reason: "job-busy" });
  release();
  expect((await winner).status).toBe("completed");
  expect((await discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true, provider: source })).status).toBe("completed");
});

test("dead lease resumes without deleting historical owners, and pagination cycles cannot report success", async () => {
  const root = await fixture();
  const leases = join(jobDirectory(root), "leases");
  await mkdir(leases, { recursive: true });
  await writeFile(join(leases, "000000000001.json"), JSON.stringify({ pid: 2147483647, token: "orphan", released: false }));
  const result = await discoverLarkWiki({ projectRoot: root, url, identity: "bot", resume: true,
    provider: provider(async input => ({ nodes: [], next_page_token: input.page_token ?? "repeated" })) });
  expect(result.status).toBe("partial");
  expect(result.failures[0]?.reason).toBe("pagination-cycle");
  expect(JSON.parse(await readFile(join(leases, "000000000001.json"), "utf8")).token).toBe("orphan");
});

test("checkpoint directories cannot redirect discovery writes through a symbolic link", async () => {
  const root = await fixture();
  const outside = await fixture();
  await symlink(outside, join(root, ".tmp"));
  await expect(discoverLarkWiki({ projectRoot: root, url, provider: provider(async () => ({ nodes: [] })) }))
    .rejects.toMatchObject({ reason: "unsafe-checkpoint-path" });
});

test("discovery bounds concurrent requests and root access failure has a durable result", async () => {
  const root = await fixture();
  let active = 0, peak = 0;
  const result = await discoverLarkWiki({ projectRoot: root, url, concurrency: 3,
    provider: provider(async input => {
      expect(input.identity).toBe("bot");
      if (input.parent_node_token === "root") return { nodes: Array.from({ length: 10 }, (_, i) => node(`folder-${i}`, true)) };
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2)); active--;
      return { nodes: [] };
    }) });
  expect(result.status).toBe("completed");
  expect(result.identity).toBe("bot");
  expect(peak).toBe(3);
  const deniedRoot = await fixture();
  const denied: WikiDiscoveryProvider = {
    resolveRoot: async () => { throw new WikiDiscoveryError("access-unavailable", false, "Missing scope"); },
    listPage: async () => { throw new Error("must not list without root"); },
  };
  const deniedResult = await discoverLarkWiki({ projectRoot: deniedRoot, url, identity: "bot", provider: denied });
  expect(deniedResult.status).toBe("partial");
  expect(deniedResult.counts.failed_pages).toBe(1);
  expect(deniedResult.failures[0]?.reason).toBe("access-unavailable");
});
