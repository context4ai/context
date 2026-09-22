import { ContextError } from "./errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { LarkRunner, RunLarkResult } from "./feishu.js";

export type LarkReadIdentity = "user" | "bot";

export function resolveLarkReadIdentity(): LarkReadIdentity {
  const value = process.env.CONTEXT_LARK_IDENTITY?.trim() || "user";
  if (value === "user" || value === "bot") return value;
  throw new ContextError(ExitCode.UserError, "CONTEXT_LARK_IDENTITY must be user or bot", {
    reason_code: "lark.invalid-read-identity",
    valid_values: ["user", "bot"],
    next: "Set CONTEXT_LARK_IDENTITY to user or bot and rerun the same command",
  });
}

function credentialFailure(result: RunLarkResult): boolean {
  for (const output of [result.stdout, result.stderr]) {
    const start = output.indexOf("{");
    if (start < 0) continue;
    try {
      const parsed: unknown = JSON.parse(output.slice(start));
      if (!parsed || typeof parsed !== "object" || !("error" in parsed)) continue;
      if (result.exitCode === 0 && (!("ok" in parsed) || parsed.ok !== false)) continue;
      const error = parsed.error;
      if (!error || typeof error !== "object") continue;
      const type = "type" in error ? error.type : undefined;
      const subtype = "subtype" in error ? error.subtype : undefined;
      if (type === "authorization" || type === "authentication" ||
          ["missing_scope", "permission_denied", "access_denied", "need_user_authorization"].includes(String(subtype))) {
        return true;
      }
    } catch { /* Plain host credential diagnostics are checked below. */ }
  }
  return result.exitCode !== 0 && /reason=(?:bot_unavailable|not_authorized)\b|\b(?:missing_scope|permission_denied|access_denied)\b/iu.test(result.stderr);
}

/** Identity fallback restarts a document read; resources never select a new identity. */
export function createLarkReadSession(runner: LarkRunner, initial: LarkReadIdentity, fallback = initial === "bot") {
  let identity = initial;
  let usedFallback = false;
  let readingDocument = false;
  let locked = false;
  const restart = new Error("Restart document with user identity");
  const run: LarkRunner = async (args, options) => {
    const explicit = args.indexOf("--as");
    const requested = explicit >= 0 ? args[explicit + 1] : identity;
    const selected = locked || usedFallback ? identity : requested === "bot" ? "bot" : "user";
    const withIdentity = [...args];
    if (explicit >= 0) withIdentity[explicit + 1] = selected;
    else withIdentity.push("--as", selected);
    const result = await runner(withIdentity, options);
    identity = selected;
    if (readingDocument && identity === "bot" && fallback && !usedFallback &&
        !args.includes("--help") && credentialFailure(result)) throw restart;
    return result;
  };
  async function readDocument<T>(read: () => Promise<T>): Promise<T> {
    readingDocument = true;
    try {
      try {
        return await read();
      } catch (error) {
        if (error !== restart) throw error;
        usedFallback = true;
        identity = "user";
        return await read();
      }
    } finally {
      readingDocument = false;
      locked = true;
    }
  }
  return { run, readDocument, get identity() { return identity; }, get usedFallback() { return usedFallback; } };
}
