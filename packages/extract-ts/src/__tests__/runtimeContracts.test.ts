import { expect, test } from "bun:test";
import ts from "typescript";
import { runtimeRegistrations } from "../runtimeRegistrations.js";
import { federationContracts } from "../federationContracts.js";

test("inbound registration preserves declaration order without inventing client endpoints", () => {
  const source = ts.createSourceFile("/server.ts", `
    import express from "express";
    import cron from "node-cron";
    import { EventEmitter } from "node:events";
    const app = express();
    app.use(identity);
    app.post("/widgets", authorize, adapt);
    app.use(audit);
    app.get("/widgets", list);
    const events = new EventEmitter();
    events.on("changed", consume);
    cron.schedule("0 * * * *", refresh);
    client.get("/not-an-endpoint");
  `, ts.ScriptTarget.Latest, true);
  const symbols = runtimeRegistrations(source);
  expect(symbols.map((symbol) => symbol.registration?.key)).toEqual(["/widgets", "/widgets", "changed", "0 * * * *"]);
  expect(symbols[0]?.registration).toMatchObject({ method: "POST", handler: "adapt", middleware: ["identity", "authorize"] });
  expect(symbols[1]?.registration?.middleware).toEqual(["identity", "audit"]);
});

test("federation projects declared exposes, remotes and shared configuration only from registered factories", () => {
  const source = ts.createSourceFile("/webpack.ts", `
    import { container } from "webpack";
    new container.ModuleFederationPlugin({ name: "shell", exposes: { "./Panel": "./src/Panel" },
      remotes: { catalog: "catalog@https://example.org/entry.js" }, shared: { react: { singleton: true } } });
    const unrelated = { exposes: { secret: "unknown" } };
  `, ts.ScriptTarget.Latest, true);
  const symbols = federationContracts(source);
  expect(symbols).toHaveLength(1);
  expect(symbols[0]?.members?.map((member) => member.name)).toEqual(["name", "exposes../Panel", "remotes.catalog", "shared.react"]);
  expect(symbols[0]?.members?.at(-1)?.typeAnnotation).toContain("singleton: true");
});
