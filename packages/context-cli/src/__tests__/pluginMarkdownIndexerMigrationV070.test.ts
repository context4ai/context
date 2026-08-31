import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const MIGRATION_PATH = join(
  REPOSITORY_ROOT,
  "plugins/context/migrations/0.7.0-markdown-indexer-resource-migration.json",
);
const OWNER_MAP_PATH = "plugins/context/migrations/0.7.0-semantic-source-ownership.json";

const DISPOSITIONS = [
  "retain-verbatim",
  "rewrite-equivalent",
  "merge-into",
  "retire-with-reason",
] as const;
const AUTHORITIES = [
  "community-instructions",
  "context-layout",
  "context-runtime",
  "context-revision",
] as const;
const PRESERVATION_DIMENSIONS = [
  "applicability",
  "positive-example",
  "negative-example",
  "deletion-condition",
  "gate-semantics",
  "recovery-guidance",
] as const;

const EXPECTED_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  "packages/context-cli/context-workflow/resources/procedures/document-classification.md": [
    "evidence-first-classification",
    "complete-authorized-evidence-read",
    "classification-continuation",
  ],
  "packages/context-cli/context-workflow/resources/dialogue/document-classification.md": [
    "evidence-backed-recommendation",
    "mainline-semantic-taxonomy",
    "collection-and-path-exclusion",
    "conditional-layout-confirmation",
  ],
  "packages/context-cli/context-workflow/resources/semantic/align/structure-planning.md": [
    "legacy-envelope-to-main-result",
    "current-envelope-and-schema-authority",
    "authorized-evidence-and-supporting-context",
    "relations-placeholders-and-unresolved",
    "evidence-read-continuation",
    "reuse-existing-subject",
    "section-level-routing",
    "section-first-and-independent-subject-boundary",
    "title-language-and-subject-kind",
    "density-and-candidate-aids",
    "canonical-identities-and-derived-paths",
    "source-continuity-and-split-repair",
    "uncertainty-and-relation-evidence",
    "content-purpose-precision",
    "validate-stage-and-recover",
    "result-self-verification",
  ],
  "packages/context-cli/context-workflow/resources/semantic/align/density-profile.md": [
    "density-is-private-reading-strategy",
    "four-density-modes",
    "heading-boundaries-and-non-authority",
  ],
  "packages/context-cli/context-workflow/resources/semantic/align/candidate-resolution.md": [
    "anomaly-dispositions",
    "stable-refs-and-derived-paths",
    "visible-labels-not-authority",
    "duplicate-conflict-and-destructive-identity-change",
    "candidate-self-verification",
  ],
  "packages/context-cli/context-workflow/resources/semantic/align/gates.md": [
    "current-schema-boundary",
    "subject-kind-order",
    "title-placeholder-and-grouping-boundary",
    "section-promotion-gate",
    "subject-shape-and-tag-semantics",
    "process-subject-gate",
    "fake-subject-gate",
    "grouping-scope-gate",
    "relation-gate",
    "inference-evidence-boundary",
    "final-semantic-reflection",
    "mechanical-diagnostics",
  ],
  "packages/context-cli/context-workflow/resources/procedures/document-optimization.md": [
    "section-scoped-optional-phase",
    "editorial-outcomes",
    "omission-and-retention-boundary",
    "signal-obligations-and-assessment",
    "missing-input-boundary",
    "managed-completion",
    "three-attempt-guidance",
    "protected-source-values",
    "apply-rescan-and-stale-recovery",
    "revision-storage-and-negative-cache",
    "targeted-revision-entry",
  ],
};

interface MigrationBlock {
  id: string;
  source_anchors: string[];
  disposition: typeof DISPOSITIONS[number];
  authority: typeof AUTHORITIES[number];
  targets: string[];
  target_anchors: string[];
  preserves: Array<typeof PRESERVATION_DIMENSIONS[number]>;
  retirement_reason?: { code: string; detail: string };
  regression_evidence?: string[];
}

interface MigrationSource {
  source: string;
  source_digest: string;
  blocks: MigrationBlock[];
}

interface MigrationMatrix {
  schema: string;
  semantic_source_ownership: { path: string; digest: string };
  coverage: string;
  dispositions: string[];
  preservation_dimensions: string[];
  equivalence_fixture: string;
  sources: MigrationSource[];
}

function digest(body: string): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

async function matrix(): Promise<MigrationMatrix> {
  return JSON.parse(await readFile(MIGRATION_PATH, "utf8")) as MigrationMatrix;
}

function exactArray(actual: readonly string[], expected: readonly string[], label: string): void {
  if (
    actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])
  ) {
    throw new TypeError(`${label} is incomplete or reordered`);
  }
}

function validateInventory(value: MigrationMatrix): void {
  if (
    value.schema !== "context.markdown-indexer-resource-migration/v1"
    || value.coverage !== "complete-semantic-blocks"
  ) {
    throw new TypeError("Markdown migration matrix protocol or coverage is invalid");
  }
  exactArray(value.dispositions, DISPOSITIONS, "migration dispositions");
  exactArray(
    value.preservation_dimensions,
    PRESERVATION_DIMENSIONS,
    "migration preservation dimensions",
  );
  exactArray(value.sources.map((source) => source.source), Object.keys(EXPECTED_BLOCKS), "source inventory");
  const allBlockIds = value.sources.flatMap((source) => source.blocks.map((block) => block.id));
  if (new Set(allBlockIds).size !== allBlockIds.length) {
    throw new TypeError("Markdown migration block ids must be globally unique");
  }
  for (const source of value.sources) {
    exactArray(
      source.blocks.map((block) => block.id),
      EXPECTED_BLOCKS[source.source] ?? [],
      `${source.source} semantic blocks`,
    );
    for (const block of source.blocks) {
      if (
        !DISPOSITIONS.includes(block.disposition)
        || !AUTHORITIES.includes(block.authority)
        || block.source_anchors.length === 0
        || block.targets.length === 0
        || block.target_anchors.length === 0
        || block.preserves.length === 0
        || block.preserves.some((dimension) => !PRESERVATION_DIMENSIONS.includes(dimension))
      ) {
        throw new TypeError(`Markdown migration block ${block.id} is incomplete`);
      }
      if (block.disposition === "retire-with-reason") {
        if (
          block.retirement_reason?.detail.trim().length === 0
          || (block.regression_evidence?.length ?? 0) === 0
        ) {
          throw new TypeError(`retired Markdown block ${block.id} lacks reason or evidence`);
        }
      } else if (block.retirement_reason !== undefined || block.regression_evidence !== undefined) {
        throw new TypeError(`replacement block ${block.id} claims retirement evidence`);
      }
      if (
        block.authority === "community-instructions"
        && !block.targets.some((target) =>
          target.startsWith("plugins/context/skills/context-markdown-indexer/references/")
        )
      ) {
        throw new TypeError(`semantic block ${block.id} lacks a community instruction target`);
      }
      if (
        block.authority === "context-layout"
        && !block.targets.some((target) => target.includes("indexerLayout"))
      ) {
        throw new TypeError(`layout block ${block.id} lacks a layout-resolver target`);
      }
      if (
        block.authority === "context-revision"
        && !block.targets.some((target) =>
          target.includes("documentOptimization") || target.includes("documentRevision")
        )
      ) {
        throw new TypeError(`revision block ${block.id} lacks a Context revision target`);
      }
    }
  }
  const coveredDimensions = new Set(
    value.sources.flatMap((source) => source.blocks.flatMap((block) => block.preserves)),
  );
  exactArray(
    PRESERVATION_DIMENSIONS.filter((dimension) => coveredDimensions.has(dimension)),
    PRESERVATION_DIMENSIONS,
    "effective preservation coverage",
  );
}

describe("0.7.0 Markdown semantic-resource migration", () => {
  test("keeps main authoring and body-free material-answer output as separate operations", async () => {
    const maintainedRoot = join(
      REPOSITORY_ROOT,
      "plugins/context/skills/context-markdown-indexer/references",
    );
    const installedRoot = join(
      REPOSITORY_ROOT,
      "plugins/context/repo-install/skills/context-markdown-indexer/references",
    );
    const indexer = await readFile(join(maintainedRoot, "indexer.md"), "utf8");
    const planning = await readFile(
      join(maintainedRoot, "semantic-planning.md"),
      "utf8",
    );
    expect(indexer).toContain("Follow the operation in the supplied run request");
    expect(indexer).toContain("context.indexer.material-answer-result/v1");
    expect(indexer).toContain("derives a body-free planned answer");
    expect(indexer).toContain("Do not return reader prose, an answer body");
    expect(indexer).not.toContain(
      "Return only the current `main-index` `IndexerResult`/`ArtifactResult` contract",
    );
    expect(planning).toContain("planned-answer projection");
    expect(await readFile(join(installedRoot, "indexer.md"), "utf8")).toBe(indexer);
    expect(await readFile(join(installedRoot, "semantic-planning.md"), "utf8"))
      .toBe(planning);
  });

  test("disposes the exact classification, align, and optimization block inventory", async () => {
    const value = await matrix();
    expect(() => validateInventory(value)).not.toThrow();
    expect(value.semantic_source_ownership).toEqual({
      path: OWNER_MAP_PATH,
      digest: digest(await readFile(join(REPOSITORY_ROOT, OWNER_MAP_PATH), "utf8")),
    });
    expect(value.sources.flatMap((source) => source.blocks)).toHaveLength(54);

    for (const source of value.sources) {
      expect(source.source_digest, source.source).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(await stat(join(REPOSITORY_ROOT, source.source)).then(
        () => true,
        () => false,
      ), source.source).toBe(false);
      for (const block of source.blocks) {
        const targetBodies: string[] = [];
        for (const target of block.targets) {
          const path = join(REPOSITORY_ROOT, target);
          expect((await stat(path)).isFile(), `${block.id} target ${target}`).toBe(true);
          targetBodies.push(await readFile(path, "utf8"));
        }
        const evidence = targetBodies.join("\n");
        for (const anchor of block.target_anchors) {
          expect(evidence, `${block.id} replacement anchor ${anchor}`).toContain(anchor);
        }
      }
    }
  });

  test("keeps semantic policy in the community Skill and mechanics in Context", async () => {
    const value = await matrix();
    const blocks = value.sources.flatMap((source) => source.blocks);
    expect(blocks.filter((block) => block.authority === "community-instructions").length)
      .toBeGreaterThan(20);
    expect(blocks.filter((block) => block.authority === "context-layout").length)
      .toBeGreaterThan(3);
    expect(blocks.filter((block) => block.authority === "context-runtime").length)
      .toBeGreaterThan(3);
    expect(blocks.filter((block) => block.authority === "context-revision").length)
      .toBeGreaterThan(3);
    for (const block of blocks.filter((item) => item.authority === "community-instructions")) {
      expect(block.targets.some((target) =>
        target.startsWith("plugins/context/skills/context-markdown-indexer/references/")
      ), block.id).toBe(true);
    }
    expect(blocks.every((block) => block.disposition !== "retire-with-reason")).toBe(true);
  });

  test("ships the anonymous equivalence fixture after deleting legacy sources", async () => {
    const value = await matrix();
    const fixturePath = join(REPOSITORY_ROOT, value.equivalence_fixture);
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      protocol: string;
      anonymized: boolean;
      cases: Array<{ rule_id: string }>;
    };
    expect(fixture).toMatchObject({
      protocol: "context.indexer.markdown-migration-equivalence-fixture-set/v1",
      anonymized: true,
    });
    expect(fixture.cases).toHaveLength(20);
    expect(new Set(fixture.cases.map((item) => item.rule_id)).size).toBe(20);
    for (const source of value.sources) {
      expect(await stat(join(REPOSITORY_ROOT, source.source)).then(
        () => true,
        () => false,
      ), source.source).toBe(false);
    }
  });

  test("rejects missing semantic blocks and misplaced authority", async () => {
    const value = await matrix();
    const missing = structuredClone(value);
    missing.sources[2]!.blocks.pop();
    expect(() => validateInventory(missing)).toThrow(/semantic blocks/);

    const misplaced = structuredClone(value);
    const semantic = misplaced.sources.flatMap((source) => source.blocks)
      .find((block) => block.authority === "community-instructions")!;
    semantic.targets = ["packages/context/src/indexerLayoutResolver.ts"];
    expect(() => validateInventory(misplaced)).toThrow(/community instruction target/);

    const reasonless = structuredClone(value);
    reasonless.sources[0]!.blocks[0]!.disposition = "retire-with-reason";
    expect(() => validateInventory(reasonless)).toThrow(/lacks reason or evidence/);
  });
});
