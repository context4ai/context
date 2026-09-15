import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { optionalWorkspaceText, readWorkspaceChangelog, renderChangelog, workspaceVersion } from "./workspaceChangelog.js";

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
