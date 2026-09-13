import { expect, test } from "bun:test";
import { Command } from "commander";
import { registerProjectActionCommands } from "../commands/actionCommands.js";
import { registerProjectRunCommand } from "../commands/runProject.js";

test("production offers directory preparation and submission without a separate Author scaffold command", () => {
  const program = new Command();
  registerProjectActionCommands(program);
  const action = program.commands.find(command => command.name() === "action")!;
  const commands = action.commands.map(command => command.name());
  expect(commands).toContain("prepare-current");
  expect(commands).toContain("complete-current");
  expect(commands).not.toContain("scaffold-current");
});

test("run offers explicit delivery controls without a second numeric batch planner", () => {
  const program = new Command();
  registerProjectRunCommand(program, import.meta.url);
  const run = program.commands.find(command => command.name() === "run")!;
  const flags = run.options.map(option => option.long);
  expect(flags).toContain("--deliver");
  expect(flags).toContain("--resume-writing");
  expect(flags).not.toContain("--delivery-size");
});
