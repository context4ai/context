import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditParserPublisherReadiness } from "../packages/dev-cli/src/commands/parserPublisherAudit.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const receiptIndex = args.indexOf("--receipts");
const receiptPath = receiptIndex >= 0
  ? args[receiptIndex + 1]
  : "release/parser-publisher-receipts.json";
if (receiptPath === undefined) throw new TypeError("--receipts requires a file path");
const rootPackage = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
) as { version?: string };
if (rootPackage.version === undefined) throw new TypeError("root package version is missing");
const receipts = JSON.parse(await readFile(resolve(projectRoot, receiptPath), "utf8"));
const result = await auditParserPublisherReadiness({
  releaseVersion: rootPackage.version,
  receipts,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
