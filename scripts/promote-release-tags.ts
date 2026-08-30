import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  releasePublishPlan,
} from "../packages/dev-cli/src/commands/releasePackages.js";
import { promoteReleaseDistTags } from
  "../packages/dev-cli/src/commands/releasePromotion.js";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new TypeError(`${name} requires a value`);
  return value;
}

const rootPackage = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
) as { version?: string };
const version = option("--version") ?? rootPackage.version;
if (version === undefined) throw new TypeError("root package version is missing");
const registry = option("--registry") ?? "https://registry.npmjs.org";
const smokePath = option("--smoke-receipt");
if (smokePath === undefined) throw new TypeError("--smoke-receipt is required");
const registrySnapshotPath = option("--registry-snapshot");
if (registrySnapshotPath === undefined) throw new TypeError("--registry-snapshot is required");

const receipt = await promoteReleaseDistTags({
  plan: releasePublishPlan(version),
  installSmokeReceipt: JSON.parse(await readFile(resolve(projectRoot, smokePath), "utf8")),
  registrySnapshotReceipt: JSON.parse(
    await readFile(resolve(projectRoot, registrySnapshotPath), "utf8"),
  ),
  registry,
  run: async (args) => (await execFileAsync("npm", [...args], {
    cwd: projectRoot,
    maxBuffer: 32 * 1024 * 1024,
  })).stdout,
});
const output = `${JSON.stringify(receipt, null, 2)}\n`;
const receiptPath = option("--receipt");
if (receiptPath !== undefined) {
  const absolute = resolve(projectRoot, receiptPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, output);
}
process.stdout.write(output);
