import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectPhaseCommand } from "../project/run.js";
import { initContextProject } from "../project/workspace.js";

export function makeLarkCaptureTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-capture-lark-v062-"));
}

function writeLarkProjectEntry(projectRoot: string): void {
  writeFileSync(join(projectRoot, "src", "index.ts"), [
    'import { captureLark, defineProject, source } from "@c4a/context";',
    "",
    'const handbook = source("handbook");',
    "",
    "export default defineProject({",
    "  sources: [handbook],",
    "  phases: [",
    "    captureLark({ source: handbook }),",
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

function writeLarkRegistry(projectRoot: string): void {
  writeFileSync(join(projectRoot, "sources", "lark", "index.yaml"), [
    "sources:",
    "  - name: handbook",
    "    docToken: doc-token-123",
    "    title: Product Handbook",
    "",
  ].join("\n"), "utf8");
}

export async function createLarkCaptureProject(root: string): Promise<string> {
  const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  writeLarkProjectEntry(result.projectRoot);
  writeLarkRegistry(result.projectRoot);
  return result.projectRoot;
}

export async function runLarkCapturePhase(input: Parameters<typeof runProjectPhaseCommand>[0]): Promise<string> {
  const originalStdoutWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await runProjectPhaseCommand(input);
    return chunks.join("");
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}
