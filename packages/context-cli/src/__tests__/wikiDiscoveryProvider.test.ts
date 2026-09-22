import { expect, test } from "bun:test";
import { createWikiDiscoveryProvider, wikiDiscoveryFailure } from "../lib/wikiDiscoveryProvider.js";
import type { LarkResourceCommandResult } from "../lib/larkResourceCommand.js";

const root = { node_token: "root", obj_token: "document", obj_type: "docx", title: "Example", has_child: true, space_id: "123" };
function success(data: unknown, identity = "bot"): LarkResourceCommandResult {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, identity, data }), stderr: "" };
}
function failure(code: number, type = "api"): LarkResourceCommandResult {
  return { exitCode: 1, stdout: "", stderr: JSON.stringify({ ok: false, identity: "bot", error: { code, type, message: "Request rejected" } }) };
}

test("adapter resolves root and lists one page with unchanged identity and explicit cursor", async () => {
  const calls: string[][] = [];
  const provider = createWikiDiscoveryProvider({ runner: async args => {
    calls.push(args);
    return args[1] === "+node-get" ? success(root)
      : success({ nodes: [{ ...root, node_token: "child" }], has_more: true, page_token: "next" });
  } });
  const resolved = await provider.resolveRoot("https://example.larkoffice.com/wiki/root", "bot");
  expect(resolved.space_id).toBe("123");
  const page = await provider.listPage({ space_id: "123", parent_node_token: "root", page_token: "previous", identity: "bot" });
  expect(page.next_page_token).toBe("next");
  expect(calls[1]).toContain("--page-token");
  expect(calls[1]).toContain("previous");
  expect(calls.flat()).not.toContain("--page-all");
  for (const args of calls) expect(args[args.indexOf("--as") + 1]).toBe("bot");
});

test("adapter throttles explicit Wiki rate limits with bounded backoff and no identity fallback", async () => {
  let clock = 0, calls = 0;
  const provider = createWikiDiscoveryProvider({
    runner: async args => { expect(args[args.indexOf("--as") + 1]).toBe("bot"); return ++calls === 1 ? failure(99991400) : success(root); },
    scheduler: { now: () => clock, sleep: async ms => { clock += ms; } },
  });
  expect((await provider.resolveRoot("https://example.larkoffice.com/wiki/root", "bot")).node_token).toBe("root");
  expect(calls).toBe(2);
  expect(clock).toBe(1000);
  let repeated = 0;
  const exhausted = createWikiDiscoveryProvider({ runner: async () => { repeated++; return failure(429); },
    scheduler: { now: () => clock, sleep: async ms => { clock += ms; } } });
  const error = await exhausted.resolveRoot("https://example.larkoffice.com/wiki/root", "bot").catch(error => error);
  expect(wikiDiscoveryFailure(error)).toMatchObject({ reason: "rate-limited", retryable: true });
  expect(repeated).toBe(4);
});

test("permission and authentication failures never retry or request user login", async () => {
  for (const [code, type] of [[131006, "api"], [403, "authorization"], [401, "authentication"]] as const) {
    const calls: string[][] = [];
    const provider = createWikiDiscoveryProvider({ runner: async args => { calls.push(args); return failure(code, type); } });
    const error = await provider.resolveRoot("https://example.larkoffice.com/wiki/root", "bot").catch(error => error);
    expect(wikiDiscoveryFailure(error)).toMatchObject({ reason: "access-unavailable", retryable: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual(["wiki", "+node-get"]);
    expect(calls[0]).not.toContain("user");
  }
});

test("adapter rejects changed identity, malformed pagination and missing node identities", async () => {
  const mismatch = createWikiDiscoveryProvider({ runner: async () => success(root, "user") });
  await expect(mismatch.resolveRoot("https://example.larkoffice.com/wiki/root", "bot")).rejects.toMatchObject({ reason: "identity-mismatch" });
  for (const data of [
    { nodes: [], has_more: true },
    { nodes: [{ title: "Incomplete" }], has_more: false },
    { nodes: [] },
  ]) {
    const provider = createWikiDiscoveryProvider({ runner: async () => success(data) });
    await expect(provider.listPage({ space_id: "123", parent_node_token: "root", identity: "bot" })).rejects.toMatchObject({ reason: "invalid-response" });
  }
  const wrongRoot = createWikiDiscoveryProvider({ runner: async () => success({ ...root, node_token: "different" }) });
  await expect(wrongRoot.resolveRoot("https://example.larkoffice.com/wiki/root", "bot")).rejects.toMatchObject({ reason: "scope-mismatch" });
  for (const scope of [{ space_id: "different" }, { parent_node_token: "different" }]) {
    const provider = createWikiDiscoveryProvider({ runner: async () => success({ nodes: [{ ...root, ...scope }], has_more: false }) });
    await expect(provider.listPage({ space_id: "123", parent_node_token: "root", identity: "bot" })).rejects.toMatchObject({ reason: "scope-mismatch" });
  }
});
