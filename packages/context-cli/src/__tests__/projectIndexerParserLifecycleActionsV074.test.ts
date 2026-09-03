import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import {
  buildIndexerParserCoordinateMapping,
  buildIndexerParserResolutionLock,
  indexerProtocolDigest,
} from "@c4a/context";
import { bundledIndexerProfileContract } from "../project/indexerBaseContracts.js";
import {
  buildProjectIndexerParserDependencyIntentsAction,
  buildProjectIndexerParserPlanAction,
} from "../project/indexerParserLifecycleActions.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const digest = (label: string) => indexerProtocolDigest({ label });
const contentDigest = (content: string) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-parser-lifecycle-"));
  roots.push(root);
  const repository = join(root, "sources", "repo", "20260901", "sample");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(repository, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "context-parser-lifecycle-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }));
  await writeFile(join(repository, "src", "index.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["init", "-q"], { cwd: repository });
  await execFileAsync("git", ["config", "user.email", "fixture@example.test"], { cwd: repository });
  await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: repository });
  await execFileAsync("git", ["add", "src/index.ts"], { cwd: repository });
  await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: repository });
  const { stdout: ref } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  });
  await mkdir(join(root, "sources", "repo"), { recursive: true });
  await writeFile(join(root, "sources", "repo", "index.yaml"), [
    "sources:",
    "  - name: '20260901'",
    "    modules:",
    "      - name: sample",
    "        git:",
    "          remote: https://example.test/sample.git",
    `          ref: ${ref.trim()}`,
    "",
  ].join("\n"));
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "web-knowledge",
      reader_goals: ["understand-web"],
      coverage_domains: { architecture: "required" },
      target_scope: {
        targets: [{
          source_ref: "repo:20260901/sample",
          module_refs: ["module:sample"],
        }],
      },
      evidence_source_scope: {
        targets: [{
          source_ref: "repo:20260901/sample",
          module_refs: ["module:sample"],
        }],
      },
    }],
    indexers: [{
      id: "web-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "web-knowledge",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:web-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:web-knowledge#target_scope"] },
      profile: { primary: { id: "web-application", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: digest("provider"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  }));
  return root;
}

function parserLock() {
  const requirement = bundledIndexerProfileContract().profiles.find((profile) =>
    profile.id === "web-application"
  )!.parser_requirements.find((candidate) => candidate.capability === "parser.typescript")!;
  const mapping = buildIndexerParserCoordinateMapping({
    requirement,
    resolution: "direct",
    registry: "npm",
    actual_coordinate: requirement.community_coordinate,
    abi_digest: requirement.abi_digest,
  });
  return buildIndexerParserResolutionLock({
    requirement,
    mapping,
    lock_integrity: "sha512-Y29udGV4dC10eXBlc2NyaXB0",
    resolved_content_digest: digest("extract-ts"),
  });
}

describe("0.7.4 parser lifecycle CLI actions", () => {
  test("derives applicable community dependency intents before lock authorization", async () => {
    const root = await projectRoot();
    const content = "export const value = 1;\n";
    const projection = await buildProjectIndexerParserDependencyIntentsAction({
      projectRoot: root,
      value: {
        protocol: "context.indexer.parser-dependency-intent-input/v1",
        indexer_id: "web-indexer",
        profile_id: "web-application",
        authorized_files: [{
          source_ref: "repo:20260901/sample",
          module_ref: "module:sample",
          normalized_path: "src/index.ts",
          content_digest: contentDigest(content),
        }],
        resolution: { kind: "community-direct", registry: "npm" },
      },
    });

    expect(projection.applicable_capabilities).toEqual(["parser.typescript"]);
    expect(projection.dependencies.intents).toEqual([expect.objectContaining({
      package: "@c4a/extract-ts",
      state: "requires-authorization",
    })]);
    expect(projection.mappings).toEqual([expect.objectContaining({
      capability: "parser.typescript",
      resolution: "direct",
      registry: "npm",
    })]);
    expect(projection.locks).toEqual([]);
  });

  test("derives source authority from the current registry instead of caller digest", async () => {
    const root = await projectRoot();
    const content = "export const value = 1;\n";
    const plan = await buildProjectIndexerParserPlanAction({
      projectRoot: root,
      value: {
        protocol: "context.indexer.parser-execution-plan-build-input/v1",
        indexer_id: "web-indexer",
        profile_id: "web-application",
        authorized_files: [{
          source_ref: "repo:20260901/sample",
          module_ref: "module:sample",
          normalized_path: "src/index.ts",
          content_digest: contentDigest(content),
        }],
        parser_locks: [parserLock()],
      },
    });

    expect(plan.entries.map((entry) => entry.capability)).toEqual(["parser.typescript"]);
    expect(plan.source_registry_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("derives files from the registered source instead of caller-supplied paths", async () => {
    const root = await projectRoot();
    const plan = await buildProjectIndexerParserPlanAction({
      projectRoot: root,
      value: {
        protocol: "context.indexer.parser-execution-plan-build-input/v1",
        indexer_id: "web-indexer",
        profile_id: "web-application",
        authorized_files: [{
          source_ref: "repo:20260901/other",
          module_ref: "module:other",
          normalized_path: "src/index.ts",
          content_digest: digest("source"),
        }],
        parser_locks: [parserLock()],
      },
    });

    expect(plan.entries.flatMap((entry) => entry.files.map((file) => file.normalized_path)))
      .toEqual(["src/index.ts"]);
  });
});
