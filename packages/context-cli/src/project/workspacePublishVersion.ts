import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { optionalWorkspaceText, workspaceVersion } from "./workspaceChangelog.js";
import { packageOutputFingerprint } from "./packageBuildReceipt.js";
import { loadContextProjectModule } from "./workspace.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { withProjectWriteLock } from "./writeLock.js";

const buildSchema = z.object({ version: z.string(), packages: z.array(z.object({ name: z.string(), out_dir: z.string(), hash: z.string() })) });
export async function inspectWorkspacePublish(root: string) {
  const raw = await optionalWorkspaceText(root, ".context-builds.json");
  if (!raw) throw new TypeError("Build first: context build --format json");
  const build = buildSchema.parse(JSON.parse(raw));
  const loaded = await loadContextProjectModule(root);
  if (build.version !== await workspaceVersion(root) || build.packages.length !== loaded.project.packages.length) throw new TypeError("Build is stale; run context build --format json");
  for (const pkg of loaded.project.packages) {
    const item = build.packages.find(item => item.name === pkg.name && item.out_dir === pkg.outDir);
    if (!item || (await packageOutputFingerprint(root, pkg)).fingerprint !== item.hash) throw new TypeError("Build output changed; run context build --format json before publishing");
  }
  const publishedRaw = await optionalWorkspaceText(root, ".context-published.json");
  const published = publishedRaw ? buildSchema.parse(JSON.parse(publishedRaw)) : undefined;
  const hash = createHash("sha256").update(JSON.stringify(build)).digest("hex");
  const changed = !published || JSON.stringify(published.packages) !== JSON.stringify(build.packages);
  return { ...build, hash, changed, needs_version: Boolean(published && published.version === build.version && changed),
    unchanged: Boolean(published && published.version === build.version && !changed) };
}
export async function markWorkspacePublished(root: string, expectedHash: string, receipt: string) {
  if (!receipt.trim()) throw new TypeError("A successful external publish receipt is required");
  return withProjectWriteLock(root, "record-workspace-published", async () => {
    const status = await inspectWorkspacePublish(root);
    if (status.hash !== expectedHash || status.needs_version) throw new TypeError("Publish baseline changed or version increase required; run context version publish-check --format json");
    await atomicWriteFile(join(root, ".context-published.json"), JSON.stringify({ version: status.version, packages: status.packages, receipt }) + "\n");
    return { version: status.version, outcome: "published-recorded" };
  });
}
