import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parserReleaseMetadata,
  releasePublishPlan,
  releasePackageDirectories,
  renderPublishedPackages,
  upsertPublishedPackages,
} from "../packages/dev-cli/src/commands/releasePackages.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const formatIndex = args.indexOf("--format");
const format = formatIndex >= 0 ? args[formatIndex + 1] : "markdown";
const bodyIndex = args.indexOf("--body");
const bodyPath = bodyIndex >= 0 ? args[bodyIndex + 1] : undefined;
const rootPackage = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
) as { version?: string };

if (!rootPackage.version) {
  throw new Error("Root package version is missing");
}
if (!format) {
  throw new Error("--format requires a value");
}
if (bodyIndex >= 0 && !bodyPath) {
  throw new Error("--body requires a file path");
}

if (format === "directories") {
  process.stdout.write(`${releasePackageDirectories(rootPackage.version).join("\n")}\n`);
} else if (format === "markdown") {
  const output = bodyPath
    ? upsertPublishedPackages(await readFile(resolve(bodyPath), "utf8"), rootPackage.version)
    : `${renderPublishedPackages(rootPackage.version)}\n`;
  process.stdout.write(output);
} else if (format === "parser-coordinates") {
  process.stdout.write(`${JSON.stringify(parserReleaseMetadata(rootPackage.version), null, 2)}\n`);
} else if (format === "publish-plan") {
  process.stdout.write(`${JSON.stringify(releasePublishPlan(rootPackage.version), null, 2)}\n`);
} else {
  throw new Error(`Unsupported release metadata format: ${format}`);
}
