import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { verifyProjectWorkspace } from "../project/verify.js";
import { makeProject, writeApproved } from "./projectVerifyV062Helpers.js";

const SOURCE_NAME = "20260712/sample";
const PHASE_ID = `extract:${SOURCE_NAME}:codegraph`;
const PHASE_FINGERPRINT = "sha256:source-fingerprint";
const SYMBOL_DIGEST = "abc123abc123";

async function writeRepoEvidence(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "sources", "repo"), { recursive: true });
  await writeFile(join(projectRoot, "sources", "repo", "index.yaml"), YAML.stringify({
    sources: [{
      name: "20260712",
      modules: [{
        name: "sample",
        git: {
          remote: "https://git.example.com/sample.git",
          ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }],
    }],
  }), "utf8");
  const runtimeRoot = join(projectRoot, ".tmp", "context-runtime", "extract");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(runtimeRoot, "source-fingerprints.json"), `${JSON.stringify({
    version: 1,
    phases: {
      [PHASE_ID]: {
        phaseId: PHASE_ID,
        collection: "codegraph",
        fingerprint: PHASE_FINGERPRINT,
        sources: [],
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(runtimeRoot, "source-symbols.json"), `${JSON.stringify({
    version: 2,
    phaseFingerprints: { [PHASE_ID]: PHASE_FINGERPRINT },
    symbols: [
      { source: SOURCE_NAME, file: "src/first.ts", name: "Button", kind: "function", digest: SYMBOL_DIGEST },
      { source: SOURCE_NAME, file: "src/second.ts", name: "Button", kind: "function", digest: SYMBOL_DIGEST },
    ],
  }, null, 2)}\n`, "utf8");
}

describe("codegraph file-aware approved source refs", () => {
  test("defers reverse lookup while the symbol index covers only part of the declared extraction phases", async () => {
    const projectRoot = await makeProject();
    try {
      await writeRepoEvidence(projectRoot);
      await writeApproved({
        projectRoot,
        collection: "codegraph",
        sources: [`repo:${SOURCE_NAME}`],
        sourceRef: `src-1#symbol:src/first.ts:Button:function@${SYMBOL_DIGEST}`,
        body: "Button API evidence.",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: [`${SOURCE_NAME}|Button|function`],
          candidate_fingerprint: "sha256:candidate-fingerprint",
        },
      });

      const result = await verifyProjectWorkspace(projectRoot, {
        expectedExtractPhaseIds: [PHASE_ID, "extract:20260712/other:codegraph"],
      });

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass-with-unverifiable-evidence");
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "extract-symbol-index-incomplete",
      }));
      expect(result.issues.map((issue) => issue.code)).not.toContain("approved-source-ref-stale");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses file identity to verify duplicate symbols without ambiguity", async () => {
    const projectRoot = await makeProject();
    try {
      await writeRepoEvidence(projectRoot);
      await writeApproved({
        projectRoot,
        collection: "codegraph",
        sources: [`repo:${SOURCE_NAME}`],
        sourceRef: `src-1#symbol:src/first.ts:Button:function@${SYMBOL_DIGEST}`,
        body: "Button API evidence.",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: [`${SOURCE_NAME}|Button|function`],
          candidate_fingerprint: "sha256:candidate-fingerprint",
        },
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass");
      expect(result.issues).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects source refs that omit file identity", async () => {
    const projectRoot = await makeProject();
    try {
      await writeRepoEvidence(projectRoot);
      await writeApproved({
        projectRoot,
        collection: "codegraph",
        sources: [`repo:${SOURCE_NAME}`],
        sourceRef: `src-1#symbol:Button:function@${SYMBOL_DIGEST}`,
        body: "Button API evidence.",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: [`${SOURCE_NAME}|Button|function`],
          candidate_fingerprint: "sha256:candidate-fingerprint",
        },
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "approved-source-ref-invalid",
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
