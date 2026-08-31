import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, test } from "bun:test";
import { indexerProtocolDigest } from "@c4a/context";
import YAML from "yaml";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const MIGRATION_PATH = join(
  REPOSITORY_ROOT,
  "plugins/context/migrations/0.7.0-code-indexer-resource-migration.json",
);
const OWNER_MAP_PATH = "plugins/context/migrations/0.7.0-semantic-source-ownership.json";
const CODE_INDEXER_ROOT = join(
  REPOSITORY_ROOT,
  "plugins/context/skills/context-code-indexer",
);

interface MigrationItem {
  source: string;
  source_digest: string;
  disposition:
    | "retain-verbatim"
    | "rewrite-equivalent"
    | "merge-into"
    | "retire-with-reason";
  targets: string[];
  semantic_anchors: string[];
  retirement_reason?: {
    code: "incorrect" | "obsolete" | "duplicate" | "security-boundary";
    detail: string;
  };
  regression_evidence?: string[];
}

interface MigrationMatrix {
  schema: string;
  semantic_source_ownership: { path: string; digest: string };
  coverage: string;
  source_roots: string[];
  cutover: {
    schema: string;
    state: string;
    execution_phase: string;
    deletion_authorized: boolean;
    candidate_sources: string[];
    candidate_set_digest: string;
  };
  items: MigrationItem[];
}

function cutoverDigestPayload(matrix: MigrationMatrix) {
  return {
    schema: matrix.cutover.schema,
    state: matrix.cutover.state,
    execution_phase: matrix.cutover.execution_phase,
    deletion_authorized: matrix.cutover.deletion_authorized,
    candidates: matrix.items.map((item) => ({
      source: item.source,
      source_digest: item.source_digest,
      disposition: item.disposition,
      targets: item.targets,
      semantic_anchors: item.semantic_anchors,
      ...(item.retirement_reason === undefined
        ? {}
        : { retirement_reason: item.retirement_reason }),
      ...(item.regression_evidence === undefined
        ? {}
        : { regression_evidence: item.regression_evidence }),
    })),
  };
}

function validateCutoverCandidatePolicy(matrix: MigrationMatrix): void {
  if (
    matrix.cutover.schema !== "context.code-indexer-cutover-candidate-set/v1" ||
    matrix.cutover.state !== "executed" ||
    matrix.cutover.execution_phase !== "phase-g" ||
    !matrix.cutover.deletion_authorized
  ) {
    throw new TypeError("Code Indexer cutover must be executed and deletion-authorized in Phase G");
  }
  const sources = matrix.items.map((item) => item.source);
  if (
    new Set(matrix.cutover.candidate_sources).size !== matrix.items.length ||
    matrix.cutover.candidate_sources.some((source, index) => source !== sources[index])
  ) {
    throw new TypeError("Code Indexer cutover candidate inventory is incomplete or reordered");
  }
  for (const item of matrix.items) {
    if (item.disposition === "retire-with-reason") {
      if (
        item.retirement_reason === undefined ||
        item.retirement_reason.detail.trim().length === 0
      ) {
        throw new TypeError("retire-with-reason requires a concrete reason code and detail");
      }
      if ((item.regression_evidence?.length ?? 0) === 0) {
        throw new TypeError("retire-with-reason requires regression evidence");
      }
    } else if (
      item.retirement_reason !== undefined ||
      item.regression_evidence !== undefined
    ) {
      throw new TypeError("replacement migration dispositions cannot claim retirement evidence");
    }
  }
  if (
    matrix.cutover.candidate_set_digest !==
      indexerProtocolDigest(cutoverDigestPayload(matrix))
  ) {
    throw new TypeError("Code Indexer cutover candidate digest is invalid");
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function repositoryPath(path: string): string {
  return relative(REPOSITORY_ROOT, path).split(sep).join("/");
}

function digest(body: string): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

async function migrationMatrix(): Promise<MigrationMatrix> {
  return JSON.parse(await readFile(MIGRATION_PATH, "utf8")) as MigrationMatrix;
}

describe("0.7.0 Code Indexer resource migration", () => {
  test("disposes the exact legacy semantic, procedure, audit, and view inventory", async () => {
    const matrix = await migrationMatrix();
    expect(matrix).toMatchObject({
      schema: "context.code-indexer-resource-migration/v1",
      coverage: "complete",
    });
    expect(matrix.semantic_source_ownership).toEqual({
      path: OWNER_MAP_PATH,
      digest: digest(await readFile(join(REPOSITORY_ROOT, OWNER_MAP_PATH), "utf8")),
    });
    expect(matrix.items).toHaveLength(20);
    expect(matrix.cutover.candidate_sources).toEqual(matrix.items.map((item) => item.source));
    expect(new Set(matrix.items.map((item) => item.source)).size).toBe(matrix.items.length);

    for (const item of matrix.items) {
      expect(item.source_digest, item.source).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(await stat(join(REPOSITORY_ROOT, item.source)).then(
        () => true,
        () => false,
      ), item.source).toBe(false);
      expect(item.targets.length, item.source).toBeGreaterThan(0);
      expect(item.semantic_anchors.length, item.source).toBeGreaterThan(0);
      const targetBodies = await Promise.all(item.targets.map(async (target) => {
        const path = join(REPOSITORY_ROOT, target);
        expect((await stat(path)).isFile(), target).toBe(true);
        return readFile(path, "utf8");
      }));
      const evidence = targetBodies.join("\n");
      for (const anchor of item.semantic_anchors) {
        expect(evidence, `${item.source} -> ${anchor}`).toContain(anchor);
      }
    }
  });

  test("registers every Code profile template and composer instruction as migrated", async () => {
    const manifest = YAML.parse(await readFile(
      join(CODE_INDEXER_ROOT, "context-indexer.yaml"),
      "utf8",
    )) as {
      provides: {
        profiles: string[];
        composers: Array<{ contract: { instruction: string } }>;
      };
      provider: { templates: Array<{ id: string; profile: string; path: string }> };
    };
    const matrix = await migrationMatrix();
    const migratedTargets = new Set(matrix.items.flatMap((item) => item.targets));

    expect(manifest.provider.templates.map((template) => template.profile).sort())
      .toEqual([...manifest.provides.profiles].sort());
    expect(new Set(manifest.provider.templates.map((template) => template.profile)).size)
      .toBe(manifest.provides.profiles.length);
    for (const template of manifest.provider.templates) {
      const repositoryTarget = repositoryPath(join(CODE_INDEXER_ROOT, template.path));
      expect(migratedTargets.has(repositoryTarget), template.profile).toBe(true);
      expect((await stat(join(CODE_INDEXER_ROOT, template.path))).isFile()).toBe(true);
    }
    for (const composer of manifest.provides.composers) {
      const repositoryTarget = repositoryPath(join(
        CODE_INDEXER_ROOT,
        composer.contract.instruction,
      ));
      expect(migratedTargets.has(repositoryTarget)).toBe(true);
      expect((await stat(join(CODE_INDEXER_ROOT, composer.contract.instruction))).isFile())
        .toBe(true);
    }
  });

  test("records the executed Phase G cutover and removed legacy sources", async () => {
    const matrix = await migrationMatrix();
    expect(() => validateCutoverCandidatePolicy(matrix)).not.toThrow();
    expect(matrix.cutover).toMatchObject({
      schema: "context.code-indexer-cutover-candidate-set/v1",
      state: "executed",
      execution_phase: "phase-g",
      deletion_authorized: true,
    });
    expect(matrix.cutover.candidate_sources).toEqual(
      matrix.items.map((item) => item.source),
    );
    expect(new Set(matrix.cutover.candidate_sources).size).toBe(matrix.items.length);
    expect(matrix.cutover.candidate_set_digest).toBe(
      indexerProtocolDigest(cutoverDigestPayload(matrix)),
    );

    for (const item of matrix.items) {
      expect(await stat(join(REPOSITORY_ROOT, item.source)).then(
        () => true,
        () => false,
      ), item.source).toBe(false);
      if (item.disposition === "retire-with-reason") {
        expect(item.retirement_reason?.detail.trim().length ?? 0, item.source)
          .toBeGreaterThan(0);
        expect(item.regression_evidence?.length ?? 0, item.source).toBeGreaterThan(0);
        for (const evidence of item.regression_evidence ?? []) {
          expect((await stat(join(REPOSITORY_ROOT, evidence))).isFile(), evidence)
            .toBe(true);
        }
      } else {
        expect(item.retirement_reason, item.source).toBeUndefined();
        expect(item.regression_evidence, item.source).toBeUndefined();
      }
    }
  });

  test("rejects reasonless or evidence-free retire-with-reason candidates", async () => {
    const matrix = await migrationMatrix();
    const retired = structuredClone(matrix);
    retired.items[0]!.disposition = "retire-with-reason";
    expect(() => validateCutoverCandidatePolicy(retired)).toThrow(
      /concrete reason code and detail/,
    );

    retired.items[0]!.retirement_reason = {
      code: "duplicate",
      detail: "The replacement target is the only maintained semantic source.",
    };
    expect(() => validateCutoverCandidatePolicy(retired)).toThrow(
      /requires regression evidence/,
    );

    retired.items[0]!.regression_evidence = [
      "packages/context-cli/src/__tests__/pluginCodeIndexerMigrationV070.test.ts",
    ];
    retired.cutover.candidate_set_digest = indexerProtocolDigest(
      cutoverDigestPayload(retired),
    );
    expect(() => validateCutoverCandidatePolicy(retired)).not.toThrow();
    for (const evidence of retired.items[0]!.regression_evidence) {
      expect((await stat(join(REPOSITORY_ROOT, evidence))).isFile()).toBe(true);
    }
  });

  test("removes legacy extraction ABI vocabulary from the migrated Bundle", async () => {
    const files = await listFiles(CODE_INDEXER_ROOT);
    const bodies = await Promise.all(files.map((path) => readFile(path, "utf8")));
    const bundle = bodies.join("\n");
    for (const retired of [
      "outputProfile",
      "extractTs()",
      "extractCustom()",
      "semantic.code-index.template",
      "knowledge/codegraph",
    ]) {
      expect(bundle, retired).not.toContain(retired);
    }
    expect(bundle).toContain("context.indexer.main-result/v1");
    expect(bundle).toContain("Three failed revisions");
  });
});
