import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeJsonAtomic, type JsonValue } from "@c4a/agent-graph";
import {
  canonicalIndexerJson,
  emptyIndexerProfileAuditLedger,
  validateIndexerProfileAuditLedger,
  validateIndexerProfileFailureReport,
  validateIndexerProfileOverrideReceipt,
  type IndexerProfileAuditLedger,
  type IndexerProfileFailureReport,
  type IndexerProfileOverrideReceipt,
} from "@c4a/context";
import { assertIndexerOutputSafe } from "@c4a/core";
import { withProjectWriteLock } from "./writeLock.js";

export const INDEXER_PROFILE_AUDIT_LEDGER_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "audits",
  "profile-revision-ledger.json",
);
const INDEXER_PROFILE_FAILURE_REPORT_STORE = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "audits",
  "profile-failure-reports",
);
const INDEXER_PROFILE_OVERRIDE_RECEIPT_STORE = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "audits",
  "profile-override-receipts",
);

function digestName(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError("Indexer profile audit store requires a sha256 digest");
  }
  return digest.slice("sha256:".length);
}

function contentAddressedPath(store: string, digest: string): string {
  return join(store, `${digestName(digest)}.json`);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    error.code === "ENOENT";
}

export async function readProjectIndexerProfileAuditLedger(
  projectRoot: string,
): Promise<IndexerProfileAuditLedger> {
  try {
    return validateIndexerProfileAuditLedger(await readJson(join(
      projectRoot,
      INDEXER_PROFILE_AUDIT_LEDGER_PATH,
    )));
  } catch (error) {
    if (isMissing(error)) return emptyIndexerProfileAuditLedger();
    throw error;
  }
}

export async function writeProjectIndexerProfileAuditLedger(input: {
  projectRoot: string;
  expected_ledger_digest: string;
  ledger: unknown;
}): Promise<IndexerProfileAuditLedger> {
  return withProjectWriteLock(
    input.projectRoot,
    "record-index-profile-revision",
    async () => {
      const current = await readProjectIndexerProfileAuditLedger(input.projectRoot);
      if (current.ledger_digest !== input.expected_ledger_digest) {
        throw new TypeError("Indexer profile audit ledger CAS mismatch");
      }
      const ledger = validateIndexerProfileAuditLedger(input.ledger);
      const path = join(input.projectRoot, INDEXER_PROFILE_AUDIT_LEDGER_PATH);
      await mkdir(dirname(path), { recursive: true });
      await writeJsonAtomic(path, ledger as unknown as JsonValue);
      return readProjectIndexerProfileAuditLedger(input.projectRoot);
    },
  );
}

async function recordContentAddressed<T>(input: {
  projectRoot: string;
  relativePath: string;
  value: T;
  validate: (value: unknown) => T;
  identity: (value: T) => string;
}): Promise<T> {
  const path = join(input.projectRoot, input.relativePath);
  try {
    const current = input.validate(await readJson(path));
    if (
      input.identity(current) !== input.identity(input.value) ||
      canonicalIndexerJson(current) !== canonicalIndexerJson(input.value)
    ) {
      throw new TypeError("Indexer profile audit content-addressed identity collision");
    }
    return current;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, input.value as unknown as JsonValue);
  return input.validate(await readJson(path));
}

export async function recordProjectIndexerProfileFailureReport(input: {
  projectRoot: string;
  report: unknown;
}): Promise<IndexerProfileFailureReport> {
  assertIndexerOutputSafe({ channel: "audit-report", value: input.report });
  const report = validateIndexerProfileFailureReport(input.report);
  return recordContentAddressed({
    projectRoot: input.projectRoot,
    relativePath: contentAddressedPath(
      INDEXER_PROFILE_FAILURE_REPORT_STORE,
      report.report_digest,
    ),
    value: report,
    validate: validateIndexerProfileFailureReport,
    identity: (value) => value.report_digest,
  });
}

export async function readProjectIndexerProfileFailureReport(input: {
  projectRoot: string;
  report_digest: string;
}): Promise<IndexerProfileFailureReport> {
  const path = join(input.projectRoot, contentAddressedPath(
    INDEXER_PROFILE_FAILURE_REPORT_STORE,
    input.report_digest,
  ));
  let value: unknown;
  try {
    value = await readJson(path);
  } catch (error) {
    if (isMissing(error)) {
      throw new TypeError(`Indexer profile failure report is not recorded: ${input.report_digest}`);
    }
    throw error;
  }
  const report = validateIndexerProfileFailureReport(value);
  if (report.report_digest !== input.report_digest) {
    throw new TypeError("Indexer profile failure report store identity is invalid");
  }
  return report;
}

export async function recordProjectIndexerProfileOverrideReceipt(input: {
  projectRoot: string;
  receipt: unknown;
}): Promise<IndexerProfileOverrideReceipt> {
  assertIndexerOutputSafe({ channel: "audit-report", value: input.receipt });
  const receipt = validateIndexerProfileOverrideReceipt(input.receipt);
  return recordContentAddressed({
    projectRoot: input.projectRoot,
    relativePath: contentAddressedPath(
      INDEXER_PROFILE_OVERRIDE_RECEIPT_STORE,
      receipt.receipt_digest,
    ),
    value: receipt,
    validate: validateIndexerProfileOverrideReceipt,
    identity: (value) => value.receipt_digest,
  });
}

export async function readProjectIndexerProfileOverrideReceipt(input: {
  projectRoot: string;
  receipt_digest: string;
}): Promise<IndexerProfileOverrideReceipt> {
  const path = join(input.projectRoot, contentAddressedPath(
    INDEXER_PROFILE_OVERRIDE_RECEIPT_STORE,
    input.receipt_digest,
  ));
  let value: unknown;
  try {
    value = await readJson(path);
  } catch (error) {
    if (isMissing(error)) {
      throw new TypeError(`Indexer profile override receipt is not recorded: ${input.receipt_digest}`);
    }
    throw error;
  }
  const receipt = validateIndexerProfileOverrideReceipt(value);
  if (receipt.receipt_digest !== input.receipt_digest) {
    throw new TypeError("Indexer profile override receipt store identity is invalid");
  }
  return receipt;
}
