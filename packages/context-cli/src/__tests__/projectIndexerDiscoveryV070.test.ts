import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { invokeCliInDir, runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const INTEGRITY = `sha256:${"a".repeat(64)}`;
const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");

function requirement(readerGoals = ["understand"]) {
  return {
    id: "service-understanding",
    reader_goals: readerGoals,
    coverage_domains: { architecture: "required" as const },
    target_scope: {
      targets: [{ source_ref: "repo:20260827/service", module_refs: [] }],
    },
    evidence_source_scope: {
      targets: [{ source_ref: "repo:20260827/service", module_refs: [] }],
    },
  };
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "context-indexer-discovery-v070-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "indexer-discovery-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`);
  writeFileSync(join(root, "src", "indexers.yaml"), YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [requirement()],
    indexers: [],
  }));
  return root;
}

function selectionInput(requirements = [requirement()]) {
  return {
    protocol: "context.indexer.selection-proposal-input/v1",
    project_ref: "project:indexer-discovery-fixture",
    registry: {
      protocol: "context.indexer.registry/v1",
      requirements,
      indexers: [{
        id: "service-indexer",
        operations: ["main-index"],
        requirement_bindings: [{
          requirement_ref: "service-understanding",
          coverage_domains: ["architecture"],
          owned_scope: { ref: "requirement:service-understanding#target_scope" },
          role: "primary",
        }],
        read_scope: { refs: ["requirement:service-understanding#target_scope"] },
        profile: {
          primary: { id: "service", provider: "community" },
        },
        providers: [{
          id: "community",
          role: "primary",
          skill: "context-code-indexer",
          version: "0.7.0",
          integrity: INTEGRITY,
          distribution: {
            kind: "cli-bundled",
            locator: "cli-bundled://context/context-code-indexer",
          },
        }],
      }],
    },
  };
}

describe("0.7.0 Indexer discovery and static Provider selection", () => {
  test("CLI catalog is path-free, profile-free, and read-only outside a workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-indexer-catalog-v070-"));
    writeFileSync(join(root, "marker.txt"), "unchanged\n");
    const before = readdirSync(root);

    const catalog = JSON.parse(await runCliInDir(root, [
      "indexer", "catalog", "--format", "json",
    ]));
    expect(catalog.protocol).toBe("context.indexer.cli-bundled-catalog/v1");
    expect(catalog.bundles.map((entry: { skill: string }) => entry.skill)).toEqual([
      "context-code-indexer",
      "context-markdown-indexer",
    ]);
    expect(catalog.bundles.every((entry: { source_type: string }) =>
      entry.source_type === "cli-bundled"
    )).toBe(true);
    expect(JSON.stringify(catalog)).not.toContain("profiles");
    expect(JSON.stringify(catalog)).not.toContain("/Users/");
    expect(readdirSync(root)).toEqual(before);
    expect(readFileSync(join(root, "marker.txt"), "utf8")).toBe("unchanged\n");
  });

  test("statically validates a proposal without resolving Providers or writing project state", async () => {
    const root = project();
    const registryPath = join(root, "src", "indexers.yaml");
    const before = readFileSync(registryPath, "utf8");
    const inputPath = join(root, "selection.json");
    writeFileSync(inputPath, `${JSON.stringify(selectionInput(), null, 2)}\n`);

    const validation = JSON.parse(await runCliInDir(root, [
      "indexer", "validate-indexer-selection-proposal",
      "--input", inputPath, "--format", "json",
    ]));
    expect(validation.outcome).toBe("provider-resolution-required");
    expect(validation.next_provider_requests).toEqual([
      expect.objectContaining({
        skill: "context-code-indexer",
        version: "0.7.0",
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }),
    ]);
    expect(validation.proposal.requirement_set_digest)
      .toBe(validation.static_report.requirement_set_digest);
    expect(readFileSync(registryPath, "utf8")).toBe(before);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
  });

  test("rejects a proposal that changes the applied requirements", async () => {
    const root = project();
    const inputPath = join(root, "stale-selection.json");
    writeFileSync(inputPath, `${JSON.stringify(
      selectionInput([requirement(["operate", "understand"])]),
      null,
      2,
    )}\n`);
    const result = await invokeCliInDir(root, [
      "indexer", "validate-indexer-selection-proposal",
      "--input", inputPath, "--format", "json",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot modify or target stale requirements");
    expect(YAML.parse(readFileSync(join(root, "src", "indexers.yaml"), "utf8")).indexers)
      .toEqual([]);
  });

  test("canonical Context Skill requires conversational discovery before selection", () => {
    const skill = readFileSync(
      join(REPOSITORY_ROOT, "plugins", "context", "skills", "context", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("context indexer catalog --format json");
    expect(skill).toContain("together with every other Indexer\nSkill already visible");
    expect(skill).toContain("read only its YAML frontmatter and sibling `context-indexer.yaml`");
    expect(skill).toContain("Group observations with the same Skill name and exact version");
    expect(skill).toContain("is not a second\nProvider");
    expect(skill).toContain("Keep this discovery report only in the conversation");
    expect(skill).toContain("validate-indexer-selection-proposal");
    expect(skill).toContain("does not authorize materialization");
  });

  test("publishes a readable Provider version that matches the manifest authority", () => {
    for (const name of ["context-code-indexer", "context-markdown-indexer"]) {
      const root = join(REPOSITORY_ROOT, "plugins", "context", "skills", name);
      const skill = readFileSync(join(root, "SKILL.md"), "utf8");
      const frontmatterMatch = /^---\n([\s\S]*?)\n---\n?/u.exec(skill);
      if (frontmatterMatch?.[1] === undefined) throw new TypeError("expected Skill frontmatter");
      const frontmatter = YAML.parse(frontmatterMatch[1]) as {
        version?: string;
        metadata?: Record<string, string>;
      };
      const manifest = YAML.parse(readFileSync(join(root, "context-indexer.yaml"), "utf8")) as {
        version: string;
      };

      expect(frontmatter.version).toBeUndefined();
      expect(frontmatter.metadata?.["context-provider-version"]).toBe(manifest.version);
    }
  });
});
