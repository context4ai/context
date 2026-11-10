import { expect, test } from "bun:test";
import { Command } from "commander";
import { nextRouteExecution } from "../commands/nextRoute.js";

test("the next Route keeps the running command's managed mode and authorities with the global ones", () => {
  const program = new Command().option("--workflow-managed").option("--workflow-authority <authority...>");
  program.parse(["node", "context", "--workflow-authority", "context.source-read"]);
  expect(nextRouteExecution(program, { managed: true, authorities: ["context.package-output"] }))
    .toEqual({ managed: true, authorities: ["context.source-read", "context.package-output"] });
  expect(nextRouteExecution(program)).toEqual({ managed: false, authorities: ["context.source-read"] });
});
