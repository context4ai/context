import { describe, expect, test } from "bun:test";
import type { Command } from "commander";

import { createCliProgram } from "../cli.js";
import {
  COMMAND_MATRIX,
} from "../lib/pathFreeContractInventory.js";

const RETIRED_COMMANDS = [
  "capture",
  "align",
  "compile",
  "workflow",
  "reconcile",
  "mdrive",
  "query",
  "drop",
  "purge",
  "extract",
  "schema",
  "protocol",
  "workspace",
  "config",
  "cache",
  "doctor",
] as const;

const FORBIDDEN_HINT_DIRECT_RE =
  /\b(?:context\s+workspace\s+(?:locate|read|list|search|write)|workspace\s+prob(?:e|ing)|cache\s+(?:root|path)|archive\s+(?:path|file)|rendered\s+knowledge)\b/iu;
const HINT_PROBING_COMMAND_RE =
  /\b(?:read|list|grep|rg|cat|open|find|glob|parse|dereference|derive|inspect|ls|head|tail|less|more|write|edit|modify)\b/giu;
const HINT_STORAGE_TOKEN_RE =
  /(?:\.context(?:[/\\]|\b)|\.tmp[/\\]context-cli(?:[/\\]|\b)|\.cache(?:[/\\]|\b)|(?:^|[\s"'`:=([,{])(?:raw|knowledge|cache|archive)[/\\])/iu;

function registeredCommands(command: Command, prefix = ""): string[] {
  return command.commands.flatMap((subcommand) => {
    const full = prefix.length > 0 ? `${prefix} ${subcommand.name()}` : subcommand.name();
    return [full, ...registeredCommands(subcommand, full)];
  });
}

function hasForbiddenHintStorageProbe(value: string): boolean {
  for (const match of value.matchAll(new RegExp(FORBIDDEN_HINT_DIRECT_RE.source, `${FORBIDDEN_HINT_DIRECT_RE.flags}g`))) {
    const index = match.index ?? 0;
    const prefix = value.slice(Math.max(0, index - 100), index).toLowerCase();
    if (/\b(?:do not|don't|never|must not|not)\b/u.test(prefix)) continue;
    return true;
  }
  for (const match of value.matchAll(HINT_PROBING_COMMAND_RE)) {
    const index = match.index ?? 0;
    const prefix = value.slice(Math.max(0, index - 100), index).toLowerCase();
    if (/\b(?:do not|don't|never|must not|not)\b/u.test(prefix)) continue;
    const window = value.slice(index, Math.min(value.length, index + 100));
    const storage = HINT_STORAGE_TOKEN_RE.exec(window);
    if (storage === null) continue;
    const beforeStorage = window.slice(0, storage.index).toLowerCase();
    if (/\b(?:do not|don't|never|must not|not)\b/u.test(beforeStorage)) continue;
    return true;
  }
  return false;
}

describe("path-free contract inventory", () => {
  test("registered context commands are exactly represented in the current command matrix", () => {
    const discovered = new Set(registeredCommands(createCliProgram()));
    const matrix = new Set(COMMAND_MATRIX.map((entry) => entry.command));

    expect([...discovered].sort()).toEqual([...matrix].sort());
    for (const retired of RETIRED_COMMANDS) {
      expect(matrix.has(retired), retired).toBe(false);
    }

    for (const entry of COMMAND_MATRIX) {
      expect(entry.view, entry.command).toBe("production-semantic");
      expect(entry.handles.length, entry.command).toBeGreaterThan(0);
      expect(entry.notes.length, entry.command).toBeGreaterThan(0);
    }
  });

  test("probing matcher still catches direct storage inspection instructions", () => {
    for (const text of [
      "Run ls .context/raw/ to inspect source snapshots.",
      "Run head raw/local/source.md to inspect the raw bucket.",
      "Run rg billing .context/raw/ to inspect source snapshots.",
      "Use less knowledge/entity/payment-api.md for context.",
      "Write .tmp/context-cli/workflows/node-context.json as the next input.",
      "Modify cache/index.json directly.",
    ]) {
      expect(hasForbiddenHintStorageProbe(text), text).toBe(true);
    }
  });
});
