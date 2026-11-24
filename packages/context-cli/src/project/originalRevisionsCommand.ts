import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  ORIGINAL_REVISION_DECISIONS,
  decideOriginalRevisions,
  inspectOriginalRevisions,
  proposeOriginalRevisions,
  originalRevisionSummary,
  type OriginalRevisionDecision,
} from "./originalRevisions.js";
import { findContextProjectRoot } from "./workspace.js";
import { withProjectWriteLock } from "./writeLock.js";

function pairs(values: readonly string[], flag: string): Array<[string, string]> {
  return values.map((value) => {
    const index = value.indexOf("=");
    if (index <= 0 || index === value.length - 1) {
      throw new ContextError(ExitCode.UserError, `${flag} expects <id>=<value>: ${value}`, {
        category: ErrorCategory.UserInputInvalid,
        flag,
      });
    }
    return [value.slice(0, index), value.slice(index + 1)];
  });
}

export async function runOriginalRevisionsCommand(input: {
  cwd: string;
  decide: readonly string[];
  upstream: readonly string[];
  /** YAML or JSON proposals: a workspace-relative file, or "-" for standard input. */
  propose?: string;
  format: "text" | "json";
}): Promise<void> {
  const found = findContextProjectRoot(input.cwd);
  if (!found) {
    throw new ContextError(ExitCode.WorkspaceStateError, "review original-revisions requires a context project", {
      category: ErrorCategory.WorkspaceNotFound,
    });
  }
  const projectRoot = found.projectRoot;
  const decisions = new Map<string, { status: OriginalRevisionDecision; upstream?: string }>();
  for (const [id, status] of pairs(input.decide, "--decide")) {
    if (!(ORIGINAL_REVISION_DECISIONS as readonly string[]).includes(status)) {
      throw new ContextError(ExitCode.UserError, `--decide ${id} must be one of ${ORIGINAL_REVISION_DECISIONS.join(", ")}`, {
        category: ErrorCategory.UserInputInvalid,
        flag: "--decide",
      });
    }
    decisions.set(id, { status: status as OriginalRevisionDecision });
  }
  for (const [id, outcome] of pairs(input.upstream, "--upstream")) {
    decisions.set(id, { ...(decisions.get(id) ?? { status: "upstream" }), upstream: outcome });
  }
  if (input.propose !== undefined) {
    const raw = input.propose === "-"
      ? await new Promise<string>((resolveInput, reject) => {
          let data = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => { data += chunk; });
          process.stdin.on("end", () => resolveInput(data));
          process.stdin.on("error", reject);
        })
      : await readFile(resolve(input.cwd, input.propose), "utf8");
    const value: unknown = YAML.parse(raw);
    await withProjectWriteLock(projectRoot, "original-revisions", () => proposeOriginalRevisions(projectRoot, value));
  }
  if (decisions.size > 0) {
    await withProjectWriteLock(projectRoot, "original-revisions", () => decideOriginalRevisions(projectRoot, decisions));
  }
  const views = await inspectOriginalRevisions(projectRoot);
  const summary = originalRevisionSummary(views);
  const pending = summary.proposed + summary.reopened;
  const result = {
    ...summary,
    revisions: views,
    ...(pending > 0
      ? {
          next_action: {
            message: "Present the proposed and reopened revisions to the user with their evidence and record each choice: upstream (revise and propose the correction to the original), local (revise only here) or kept (keep the original text). In fully managed and routine runs record local and list them in the run report.",
            command: "context review original-revisions --decide <id>=<upstream|local|kept> --format json",
          },
        }
      : {}),
  };
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [
    `${summary.path}: ${summary.proposed} proposed, ${summary.upstream} upstream, ${summary.local} local, ${summary.kept} kept (${summary.reopened} reopened)`,
    ...views.map((view) => `- ${view.id} [${view.status}${view.reopened ? ", reopened" : ""}] ${view.article}${view.section ? `#${view.section}` : ""} (${view.reason})`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
