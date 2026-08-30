import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { ExtractSourceSymbolIndexEntry } from "./extractCandidateTypes.js";

const PHASE_CANDIDATE_OWNERSHIP_FILE = ".tmp/context-runtime/extract/custom-phase-candidates.json";

export interface ExtractPhaseCandidateOwnership {
  candidateIds: string[];
  symbols: ExtractSourceSymbolIndexEntry[];
}

export interface ExtractPhaseCandidateOwnershipManifest {
  version: 2;
  phases: Record<string, ExtractPhaseCandidateOwnership>;
}

export function candidateBelongsToSourceScope(
  sourceRefs: readonly string[],
  sourceNames: ReadonlySet<string>,
): boolean {
  return sourceRefs.some((sourceRef) => {
    for (const sourceName of sourceNames) {
      if (sourceRef.startsWith(`repo:${sourceName}#`)) return true;
    }
    return false;
  });
}

function emptyManifest(): ExtractPhaseCandidateOwnershipManifest {
  return { version: 2, phases: {} };
}

export async function readExtractPhaseCandidateOwnership(
  projectRoot: string,
): Promise<ExtractPhaseCandidateOwnershipManifest> {
  const path = join(projectRoot, PHASE_CANDIDATE_OWNERSHIP_FILE);
  if (!existsSync(path)) return emptyManifest();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ExtractPhaseCandidateOwnershipManifest;
    return parsed.version === 2 && parsed.phases !== null && typeof parsed.phases === "object"
      ? parsed
      : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

export async function writeExtractPhaseCandidateOwnership(input: {
  projectRoot: string;
  manifest: ExtractPhaseCandidateOwnershipManifest;
  phaseId: string;
  candidateIds: readonly string[];
  symbols: readonly ExtractSourceSymbolIndexEntry[];
}): Promise<void> {
  await atomicWriteFile(join(input.projectRoot, PHASE_CANDIDATE_OWNERSHIP_FILE), `${JSON.stringify({
    version: 2,
    phases: {
      ...input.manifest.phases,
      [input.phaseId]: {
        candidateIds: [...input.candidateIds].sort(),
        symbols: [...input.symbols],
      },
    },
  }, null, 2)}\n`);
}
