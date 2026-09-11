import { readFile, writeFile } from "node:fs/promises";
import { prepareParserEntryInProcess, type ParserEntryPreparation } from "./project/indexerParserEntryWorker.js";

// Private executable, invoked only with CLI-owned request/output files.
try {
  const started = performance.now();
  const [request, output] = process.argv.slice(2);
  if (request === undefined || output === undefined) throw new Error("Parser worker requires input and output paths");
  const input = JSON.parse(await readFile(request, "utf8")) as ParserEntryPreparation;
  const prepared = await prepareParserEntryInProcess(input);
  await writeFile(output, JSON.stringify({
    prepared,
    stats: { duration_ms: performance.now() - started, max_rss_kib: process.resourceUsage().maxRSS },
  }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
