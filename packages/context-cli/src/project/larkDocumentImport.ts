import { readFile } from "node:fs/promises";
import { z } from "zod";
import { captureLark, source } from "@c4a/context";
import { assertActionInputWorkspace } from "./actionInputWorkspace.js";
import { runCaptureLarkPhase } from "./documentCaptureLark.js";
import { loadContextProjectModule } from "./workspace.js";

const schema = z.object({ type: z.literal("lark"), name: z.string().min(1),
  response_files: z.array(z.string().min(1)).min(1),
  access_identity: z.enum(["user", "bot"]),
  media_files: z.record(z.string().min(1)).optional(),
}).strict();

/** Import actual host response files through the ordinary capture normalizer.
 * No synthesized platform response, second fetch, or remote version detector. */
export async function importLarkDocument(projectRoot: string, value: unknown) {
  const input = schema.parse(value);
  const responsePages: string[] = [];
  for (const path of input.response_files) {
    assertActionInputWorkspace(projectRoot, path);
    const { resolve } = await import("node:path");
    responsePages.push(await readFile(resolve(projectRoot, path), "utf8"));
  }
  const mediaFiles: Record<string, string> = {};
  for (const [token, path] of Object.entries(input.media_files ?? {})) {
    assertActionInputWorkspace(projectRoot, path);
    const { resolve } = await import("node:path");
    mediaFiles[token] = resolve(projectRoot, path);
  }
  const loaded = await loadContextProjectModule(projectRoot);
  const fallback = captureLark({ source: source(input.name) });
  const configured = loaded.project.phases.find((phase) => phase.id === fallback.id);
  if (configured && configured.kind !== fallback.kind) throw new TypeError("The selected capture id belongs to another phase; use the registered Lark source name.");
  return runCaptureLarkPhase({ projectRoot, phase: (configured ?? fallback) as typeof fallback,
    prefetched: { responsePages, identity: input.access_identity, mediaFiles } });
}
