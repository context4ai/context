import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isLarkResourcePermissionDenied, runLarkResourceCommand, type LarkResourceCommandRunner } from "./larkResourceCommand.js";

/** Preview is a same-identity representation, never an authorization fallback. */
export async function downloadLarkMedia(input: {
  runner: LarkResourceCommandRunner;
  identity: "bot" | "user";
  token: string;
  type: "media" | "whiteboard";
  cwd: string;
  allowPreview?: boolean;
  timeoutMs?: number;
}): Promise<"original" | "preview"> {
  // The directory is private to this download, so a retry may empty it.
  const options = { cwd: input.cwd, scratchDirectory: true, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) };
  const shared = ["--as", input.identity, "--token", input.token, "--output", "./resource", "--format", "json"];
  try {
    await runLarkResourceCommand(input.runner,
      ["docs", "+media-download", ...shared, "--type", input.type, "--overwrite"], options);
    return "original";
  } catch (error) {
    if (!input.allowPreview || !isLarkResourcePermissionDenied(error)) throw error;
    // Discard any partial original before accepting the preview response.
    for (const entry of await readdir(input.cwd)) await rm(join(input.cwd, entry), { recursive: true, force: true });
    await runLarkResourceCommand(input.runner,
      ["docs", "+media-preview", ...shared], options);
    return "preview";
  }
}
