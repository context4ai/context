import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { CANDIDATE_LEDGER_FILE } from "./candidateLedger.js";
import { withProjectWriteLock } from "./writeLock.js";

const LEGACY = "codegraph";
const CURRENT = "codeindex";
const LEGACY_CODE_INDEX_AUDIT_STATE_PATH = ".tmp/context-runtime/code-index-audit/state.json";
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md", ".mdx"]);

function migrationDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function filesBelow(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

function migrateText(value: string): string {
  return value
    .replaceAll("knowledge/codegraph", "knowledge/codeindex")
    .replaceAll("wikis/codegraph", "wikis/codeindex")
    .replaceAll("codegraph:", "codeindex:")
    .replaceAll(":codegraph", ":codeindex")
    .replace(/(["'])codegraph\1/gu, (_match, quote: string) => `${quote}codeindex${quote}`);
}

interface CandidateLedgerMigrationState {
  hasLegacyRows: boolean;
  retainedContent: string | undefined;
}

function inspectCandidateLedger(raw: string): CandidateLedgerMigrationState {
  let hasLegacyRows = false;
  const retainedLines: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      // An invalid row is not safe to classify or discard during migration.
      retainedLines.push(line);
      continue;
    }
    const isCurrent = value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).candidate_type === "indexer-artifact" &&
      (value as Record<string, unknown>).collection !== LEGACY;
    if (isCurrent) retainedLines.push(line);
    else hasLegacyRows = true;
  }
  return {
    hasLegacyRows,
    retainedContent: retainedLines.length === 0 ? undefined : `${retainedLines.join("\n")}\n`,
  };
}

async function readCandidateLedgerMigrationState(projectRoot: string): Promise<CandidateLedgerMigrationState> {
  const path = join(projectRoot, CANDIDATE_LEDGER_FILE);
  if (!existsSync(path)) return { hasLegacyRows: false, retainedContent: undefined };
  return inspectCandidateLedger(await readFile(path, "utf8"));
}

export async function legacyCodeIndexMigrationRequired(projectRoot: string): Promise<boolean> {
  if ((await filesBelow(join(projectRoot, "knowledge", LEGACY))).length > 0) return true;
  const formalFiles = [...new Set([
    ...["package.json", "structure.yaml"].map((file) => join(projectRoot, file))
      .filter((file) => existsSync(file)),
    ...(await filesBelow(join(projectRoot, "src"))),
    ...(await filesBelow(join(projectRoot, "docs"))),
    ...(await filesBelow(join(projectRoot, "knowledge"))),
  ])];
  for (const file of formalFiles) {
    const content = await readFile(file, "utf8");
    if (migrateText(content) !== content) return true;
  }
  return (await readCandidateLedgerMigrationState(projectRoot)).hasLegacyRows;
}

export interface CodeIndexMigrationResult {
  schema: "context.code-index-migration.v1";
  changed: boolean;
  moved_pages: number;
  rewritten_files: string[];
  removed_runtime_paths: string[];
  digest: string;
}

export async function migrateLegacyCodeIndex(projectRoot: string): Promise<CodeIndexMigrationResult> {
  return withProjectWriteLock(projectRoot, "migrate-codeindex", async () => {
    const legacyRoot = join(projectRoot, "knowledge", LEGACY);
    const currentRoot = join(projectRoot, "knowledge", CURRENT);
    if (existsSync(legacyRoot) && existsSync(currentRoot)) {
      throw new Error("cannot migrate codegraph while knowledge/codeindex already exists; resolve the duplicate collection first");
    }
    let movedPages = 0;
    let moved = false;
    const originals = new Map<string, string>();
    const candidateLedgerPath = join(projectRoot, CANDIDATE_LEDGER_FILE);
    const candidateLedgerExists = existsSync(candidateLedgerPath);
    const originalCandidateLedger = candidateLedgerExists
      ? await readFile(candidateLedgerPath, "utf8")
      : undefined;
    const candidateLedgerMigration = originalCandidateLedger === undefined
      ? { hasLegacyRows: false, retainedContent: undefined }
      : inspectCandidateLedger(originalCandidateLedger);
    const rewrittenFiles: string[] = [];
    try {
      if (existsSync(legacyRoot)) {
        movedPages = (await filesBelow(legacyRoot)).filter((file) => extname(file).toLowerCase() === ".md").length;
        await mkdir(dirname(currentRoot), { recursive: true });
        await rename(legacyRoot, currentRoot);
        moved = true;
      }
      const rewriteRoots = [
        join(projectRoot, "src"),
        join(projectRoot, "docs"),
        join(projectRoot, "knowledge"),
      ];
      const rootFiles = ["package.json", "structure.yaml"].map((file) => join(projectRoot, file));
      const files = [...new Set([
        ...rootFiles.filter((file) => existsSync(file)),
        ...(await Promise.all(rewriteRoots.map(filesBelow))).flat(),
      ])].sort();
      for (const file of files) {
        const before = await readFile(file, "utf8");
        const after = migrateText(before);
        if (after === before) continue;
        originals.set(file, before);
        await atomicWriteFile(file, after);
        rewrittenFiles.push(relative(projectRoot, file));
      }
      if (candidateLedgerMigration.hasLegacyRows) {
        if (candidateLedgerMigration.retainedContent === undefined) {
          await rm(candidateLedgerPath, { force: true });
        } else {
          await atomicWriteFile(candidateLedgerPath, candidateLedgerMigration.retainedContent);
        }
        rewrittenFiles.push(CANDIDATE_LEDGER_FILE);
      }
    } catch (error) {
      for (const [file, content] of originals) await atomicWriteFile(file, content);
      if (originalCandidateLedger !== undefined) {
        await atomicWriteFile(candidateLedgerPath, originalCandidateLedger);
      }
      if (moved && existsSync(currentRoot) && !existsSync(legacyRoot)) await rename(currentRoot, legacyRoot);
      throw error;
    }
    const runtimePaths = [
      ".tmp/context-runtime/extract",
      ".tmp/context-runtime/review",
      "dist",
      LEGACY_CODE_INDEX_AUDIT_STATE_PATH,
    ];
    const removedRuntimePaths: string[] = [];
    for (const path of runtimePaths) {
      const absolute = join(projectRoot, path);
      if (!existsSync(absolute)) continue;
      await rm(absolute, { recursive: true, force: true });
      removedRuntimePaths.push(path);
    }
    const changed = movedPages > 0 || rewrittenFiles.length > 0 || removedRuntimePaths.length > 0;
    return {
      schema: "context.code-index-migration.v1",
      changed,
      moved_pages: movedPages,
      rewritten_files: rewrittenFiles,
      removed_runtime_paths: removedRuntimePaths,
      digest: migrationDigest({ movedPages, rewrittenFiles, removedRuntimePaths }),
    };
  });
}
