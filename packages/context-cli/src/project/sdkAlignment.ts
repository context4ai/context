import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readCurrentPackageVersion } from "./workspace.js";

const SDK_PACKAGE = "@c4a/context";

function core(version: string | null | undefined): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version?.trim() ?? "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function older(left: [number, number, number], right: [number, number, number]): boolean {
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index]! < right[index]!;
  return false;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; } catch { return null; }
}

export type SdkAlignment = { workspace_sdk: { pinned: string; installed: string | null }; cli: string; message: string; instruction: string };

/** Reports a workspace SDK pinned or installed below the running CLI within the same
 * major version. Ranges, local links and other majors are left to the Agent's policy. */
export async function inspectSdkAlignment(projectRoot: string, cliVersion = readCurrentPackageVersion()): Promise<SdkAlignment | undefined> {
  const manifest = await readJson(join(projectRoot, "package.json"));
  const dependencies = { ...(manifest?.devDependencies as Record<string, string> | undefined), ...(manifest?.dependencies as Record<string, string> | undefined) };
  const pinned = dependencies[SDK_PACKAGE];
  const installed = (await readJson(join(projectRoot, "node_modules", ...SDK_PACKAGE.split("/"), "package.json")))?.version;
  const cli = core(cliVersion);
  const target = core(pinned);
  if (pinned === undefined || cli === null || target === null || target[0] !== cli[0]) return undefined;
  const installedCore = core(typeof installed === "string" ? installed : null);
  if (!older(target, cli) && (installedCore === null || !older(installedCore, cli))) return undefined;
  return {
    workspace_sdk: { pinned, installed: typeof installed === "string" ? installed : null },
    cli: cliVersion,
    message: `The workspace pins ${SDK_PACKAGE} ${pinned}, older than the running CLI ${cliVersion}; its documentation and registry parsing lag behind the CLI.`,
    instruction: `Set ${SDK_PACKAGE} in package.json to ${cliVersion}, install with the workspace package manager (bun install for bun.lock) and commit package.json together with the lock file in the next delivery. A routine update without content changes may deliver this upgrade alone.`,
  };
}
