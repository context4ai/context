import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface LegacyExtractPhaseSourceFingerprintRecord {
  fingerprint: string;
}

export interface LegacyExtractPhaseSourceFingerprintFile {
  version: 1;
  phases: Record<string, LegacyExtractPhaseSourceFingerprintRecord>;
}

export interface LegacyExtractSourceSymbolIndexEntry {
  source: string;
  file: string;
  name: string;
  kind: string;
  digest: string;
}

export interface LegacyExtractSourceSymbolIndexFile {
  version: 2;
  phaseFingerprints: Record<string, string>;
  symbols: LegacyExtractSourceSymbolIndexEntry[];
}

const FINGERPRINT_FILE = join(".tmp", "context-runtime", "extract", "source-fingerprints.json");
const SYMBOL_INDEX_FILE = join(".tmp", "context-runtime", "extract", "source-symbols.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readLegacyExtractSourceFingerprints(
  projectRoot: string,
): Promise<LegacyExtractPhaseSourceFingerprintFile> {
  const filePath = join(projectRoot, FINGERPRINT_FILE);
  if (!existsSync(filePath)) return { version: 1, phases: {} };
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.phases)) {
      return { version: 1, phases: {} };
    }
    const phases: Record<string, LegacyExtractPhaseSourceFingerprintRecord> = {};
    for (const [phaseId, raw] of Object.entries(parsed.phases)) {
      if (!isRecord(raw) || typeof raw.fingerprint !== "string") continue;
      phases[phaseId] = { fingerprint: raw.fingerprint };
    }
    return { version: 1, phases };
  } catch {
    return { version: 1, phases: {} };
  }
}

export async function readLegacyExtractSourceSymbolIndex(
  projectRoot: string,
): Promise<LegacyExtractSourceSymbolIndexFile | null> {
  const filePath = join(projectRoot, SYMBOL_INDEX_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== 2 || !Array.isArray(parsed.symbols)) return null;
    const phaseFingerprints: Record<string, string> = {};
    if (parsed.phaseFingerprints !== undefined) {
      if (!isRecord(parsed.phaseFingerprints)) return null;
      for (const [phaseId, fingerprint] of Object.entries(parsed.phaseFingerprints)) {
        if (typeof fingerprint !== "string") return null;
        phaseFingerprints[phaseId] = fingerprint;
      }
    }
    const symbols = parsed.symbols.filter((entry): entry is LegacyExtractSourceSymbolIndexEntry =>
      isRecord(entry) &&
      typeof entry.source === "string" &&
      typeof entry.file === "string" &&
      typeof entry.name === "string" &&
      typeof entry.kind === "string" &&
      typeof entry.digest === "string"
    );
    if (symbols.length !== parsed.symbols.length) return null;
    return { version: 2, phaseFingerprints, symbols };
  } catch {
    return null;
  }
}
