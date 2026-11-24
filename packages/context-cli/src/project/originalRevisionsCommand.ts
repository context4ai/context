import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  ORIGINAL_REVISION_PROPOSALS_PATH,
  proposeOriginalRevisions,
  readOriginalRevisionProposals,
  resolveOriginalRevisions,
} from "./originalRevisions.js";
import { findContextProjectRoot } from "./workspace.js";
import { withProjectWriteLock } from "./writeLock.js";

async function readInput(cwd: string, source: string): Promise<unknown> {
  const raw = source === "-"
    ? await new Promise<string>((resolveInput, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { data += chunk; });
        process.stdin.on("end", () => resolveInput(data));
        process.stdin.on("error", reject);
      })
    : await readFile(resolve(cwd, source), "utf8");
  return YAML.parse(raw);
}

export async function runOriginalRevisionsCommand(input: {
  cwd: string;
  /** YAML or JSON proposals: a workspace-relative file, or "-" for standard input. */
  propose?: string;
  /** Proposal ids whose decision has been applied to the article, or "all". */
  resolve: readonly string[];
  format: "text" | "json";
}): Promise<void> {
  const found = findContextProjectRoot(input.cwd);
  if (!found) {
    throw new ContextError(ExitCode.WorkspaceStateError, "review original-revisions requires a context project", {
      category: ErrorCategory.WorkspaceNotFound,
    });
  }
  const projectRoot = found.projectRoot;
  if (input.propose !== undefined) {
    const value = await readInput(input.cwd, input.propose);
    await withProjectWriteLock(projectRoot, "original-revisions", () => proposeOriginalRevisions(projectRoot, value));
  }
  if (input.resolve.length > 0) {
    await withProjectWriteLock(projectRoot, "original-revisions", () => resolveOriginalRevisions(projectRoot, input.resolve));
  }
  const proposals = await readOriginalRevisionProposals(projectRoot);
  const result = {
    path: ORIGINAL_REVISION_PROPOSALS_PATH,
    proposed: proposals.length,
    revisions: proposals,
    ...(proposals.length > 0
      ? {
          next_action: {
            message: "Present each proposal with its original text, revision and evidence. Apply the user's choice to the article: upstream (keep the revision and propose the correction to the original document), local (keep the revision only here) or keep (restore the original passage). Record the outcome in the batch changelog or commit, then resolve the proposal. In fully managed and routine runs keep the revisions locally and list them in the run report.",
            command: "context review original-revisions --resolve <id|all> --format json",
          },
        }
      : {}),
  };
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${[
    `${ORIGINAL_REVISION_PROPOSALS_PATH}: ${proposals.length} proposed`,
    ...proposals.map((proposal) => `- ${proposal.id} ${proposal.article}${proposal.section ? `#${proposal.section}` : ""} (${proposal.reason})`),
  ].join("\n")}\n`);
}
