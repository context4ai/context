import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { alignPayloadUserError } from "./proseAlignPayloadErrors.js";

export async function readAlignInputPayload(path: string | undefined): Promise<unknown> {
  if (path === undefined) {
    throw alignPayloadUserError("align structure validate/stage/summary requires --input <payload.yaml|json> or --input -", {
      next: "Generate a context.structure.v1 payload from CLI evidence views, then rerun with --validate --input <file> or --view structure-summary --input <file>.",
    });
  }
  let raw: string;
  try {
    raw = path === "-"
      ? await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          process.stdin.on("error", reject);
        })
      : await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw alignPayloadUserError(`structure payload cannot be read: ${path}`, {
      path,
      reason: message,
      next: "Pass the structure YAML/JSON file produced from CLI evidence views, or use --input - to read stdin.",
    });
  }
  try {
    return parsePayloadText(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw alignPayloadUserError(`structure payload is invalid YAML/JSON: ${message}`, {
      path,
      next: "Fix payload syntax, then rerun --stage; use --validate only when a diagnostics-only pass is useful.",
    });
  }
}

function parsePayloadText(raw: string): unknown {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(raw);
  return YAML.parse(raw) as unknown;
}
