import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { packageOutputFingerprint } from "./packageBuildReceipt.js";
import { loadContextProjectModule } from "./workspace.js";
import { optionalWorkspaceText, readWorkspaceChangelog, renderChangelog, workspaceVersion } from "./workspaceChangelog.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";

export async function workspaceVersionFingerprint(root: string) {
  return { version: await workspaceVersion(root), changelog: await readWorkspaceChangelog(root) };
}
export async function writePackageVersion(projectRoot: string, output: string) {
  const info = await workspaceVersionFingerprint(projectRoot);
  for (const path of ["CHANGELOG.md", "context-version.json"]) {
    if (await optionalWorkspaceText(output, path) !== undefined) throw new TypeError(`Package template uses reserved version output ${path}; rename that template output.`);
  }
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "CHANGELOG.md"), renderChangelog(info.changelog));
  await writeFile(join(output, "context-version.json"), JSON.stringify({ version: info.version }) + "\n");
}
export async function recordWorkspaceBuild(root: string) {
  const { project } = await loadContextProjectModule(root);
  const packages = await Promise.all(project.packages.map(async pkg => ({ name: pkg.name, out_dir: pkg.outDir,
    hash: (await packageOutputFingerprint(root, pkg)).fingerprint })));
  await atomicWriteFile(join(root, ".context-builds.json"), JSON.stringify({ version: await workspaceVersion(root), packages }, null, 2) + "\n");
}
