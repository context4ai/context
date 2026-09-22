import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLarkResourceCommand, type LarkResourceCommandRunner } from "./larkResourceCommand.js";

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function canonicalWhiteboardPayload(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.nodes)) return value;
  const nodeKey = (node: unknown): string => {
    if (node !== null && typeof node === "object" && !Array.isArray(node)) {
      const id = (node as Record<string, unknown>).id;
      if (typeof id === "string") return `id:${id}`;
    }
    return `value:${stableJson(node)}`;
  };
  return {
    ...record,
    nodes: [...record.nodes].sort((left, right) =>
      nodeKey(left).localeCompare(nodeKey(right)) || stableJson(left).localeCompare(stableJson(right))
    ),
  };
}

/** Export only with the identity already selected for the document. */
export async function exportLarkWhiteboardRaw(
  runner: LarkResourceCommandRunner,
  identity: "bot" | "user",
  token: string,
): Promise<Uint8Array> {
  const tempRoot = await mkdtemp(join(tmpdir(), "context-lark-whiteboard-"));
  try {
    await runLarkResourceCommand(runner, [
      "whiteboard", "+export", "--as", identity, "--whiteboard-token", token,
      "--output-type", "raw", "--output", "./raw.json", "--overwrite", "--format", "json",
    ], { cwd: tempRoot });
    const rawPayload = JSON.parse(await readFile(join(tempRoot, "raw.json"), "utf8")) as unknown;
    return Buffer.from(`${stableJson(canonicalWhiteboardPayload(rawPayload))}\n`, "utf8");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
