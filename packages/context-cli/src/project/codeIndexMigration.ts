import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { CANDIDATE_LEDGER_FILE, readCandidateRecords, writeCandidateRecords } from "./candidateLedger.js";
import { CODE_INDEX_AUDIT_STATE_PATH } from "./codeIndexAudit.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import { withProjectWriteLock } from "./writeLock.js";

const LEGACY = "codegraph";
const CURRENT = "codeindex";
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md", ".mdx"]);

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
  try {
    return (await readCandidateRecords(projectRoot)).some((record) => record.collection === LEGACY);
  } catch {
    // Candidate-ledger validation belongs to status/the requested command. Migration
    // detection must not hide its actionable schema diagnostic with a preflight error.
    return false;
  }
}

export interface CodeIndexMigrationResult {
  schema: "context.code-index-migration.v1";
  changed: boolean;
  moved_pages: number;
  rewritten_files: string[];
  removed_runtime_paths: string[];
  digest: string;
}

export async function migrateLegacyCodeIndexIfRequired(
  projectRoot: string,
): Promise<CodeIndexMigrationResult | undefined> {
  return await legacyCodeIndexMigrationRequired(projectRoot)
    ? migrateLegacyCodeIndex(projectRoot)
    : undefined;
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
    const candidateLedgerExists = existsSync(join(projectRoot, CANDIDATE_LEDGER_FILE));
    const originalCandidateRecords = candidateLedgerExists ? await readCandidateRecords(projectRoot) : [];
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
      if (candidateLedgerExists) {
        await writeCandidateRecords(projectRoot, originalCandidateRecords.filter((record) => record.collection !== LEGACY));
        rewrittenFiles.push(CANDIDATE_LEDGER_FILE);
      }
    } catch (error) {
      for (const [file, content] of originals) await atomicWriteFile(file, content);
      if (candidateLedgerExists) await writeCandidateRecords(projectRoot, originalCandidateRecords);
      if (moved && existsSync(currentRoot) && !existsSync(legacyRoot)) await rename(currentRoot, legacyRoot);
      throw error;
    }
    const runtimePaths = [
      ".tmp/context-runtime/extract",
      ".tmp/context-runtime/review",
      "dist",
      CODE_INDEX_AUDIT_STATE_PATH,
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
      digest: stableHash({ movedPages, rewrittenFiles, removedRuntimePaths }),
    };
  });
}
