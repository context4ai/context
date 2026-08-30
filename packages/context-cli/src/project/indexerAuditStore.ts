import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeJsonAtomic, type JsonValue } from "@c4a/agent-graph";
import {
  canonicalIndexerJson,
  validateIndexerAuditReport,
  type IndexerAuditReport,
} from "@c4a/context";
import { assertIndexerOutputSafe } from "@c4a/core";

export const INDEXER_AUDIT_REPORT_STORE = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "audits",
  "reports",
);

function digestName(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError("Indexer audit store requires a sha256 report digest");
  }
  return digest.slice("sha256:".length);
}

export function indexerAuditReportPath(reportDigest: string): string {
  return join(INDEXER_AUDIT_REPORT_STORE, `${digestName(reportDigest)}.json`);
}

export async function readProjectIndexerAuditReport(input: {
  projectRoot: string;
  report_digest: string;
}): Promise<IndexerAuditReport> {
  const relativePath = indexerAuditReportPath(input.report_digest);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(input.projectRoot, relativePath), "utf8")) as unknown;
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new TypeError(`Indexer audit report is not recorded: ${input.report_digest}`);
    }
    throw error;
  }
  assertIndexerOutputSafe({ channel: "audit-report", value });
  const report = validateIndexerAuditReport(value);
  if (report.report_digest !== input.report_digest) {
    throw new TypeError("Indexer audit report store identity is invalid");
  }
  return report;
}

export async function recordProjectIndexerAuditReport(input: {
  projectRoot: string;
  report: unknown;
}): Promise<IndexerAuditReport> {
  assertIndexerOutputSafe({ channel: "audit-report", value: input.report });
  const report = validateIndexerAuditReport(input.report);
  const relativePath = indexerAuditReportPath(report.report_digest);
  const path = join(input.projectRoot, relativePath);
  try {
    const current = await readProjectIndexerAuditReport({
      projectRoot: input.projectRoot,
      report_digest: report.report_digest,
    });
    if (canonicalIndexerJson(current) !== canonicalIndexerJson(report)) {
      throw new TypeError("Indexer audit report digest collides with different content");
    }
    return current;
  } catch (error) {
    if (!(error instanceof TypeError) || !error.message.includes("is not recorded")) {
      throw error;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, report as unknown as JsonValue);
  return readProjectIndexerAuditReport({
    projectRoot: input.projectRoot,
    report_digest: report.report_digest,
  });
}
