import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import YAML from "yaml";
import { INDEXER_CURRENT_FINALIZATION_PATH } from
  "../project/indexerCurrentFinalization.js";
import { projectCurrentIndexerWorkflowRoute } from
  "../project/indexerCurrentWorkflowRoute.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import type { ContextResolvedWorkflowRoute } from
  "../project/workflow/workflowTypes.js";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import { prepareIndexerReaderPaths } from "../project/indexerLayoutPathResolution.js";
import { readerLayoutProposal } from "./projectIndexerReaderPathsV075.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function outerIndexerRoute(): ContextResolvedWorkflowRoute {
  return {
    protocol: "context.workflow.route.v1",
    id: "run-indexer-lifecycle",
    revision: `sha256:${"a".repeat(64)}`,
    node: "run-indexer-lifecycle",
    reason_code: "route.indexer.lifecycle-required",
    availability: "immediate",
    commands: [],
    resources: { required: [], recommended: [] },
    after_action: { evaluate: true },
  };
}

describe("current Indexer layout Gate", () => {
  for (const collision of [false, true]) {
  test(`keeps ${collision ? "new page collision" : "destructive layout"} confirmation human-only in managed mode`, async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-layout-gate-"));
    roots.push(root);
    const revision = `sha256:${"b".repeat(64)}`;
    const bundle = (await listCliBundledIndexers()).bundles.find((candidate) =>
      candidate.skill === "context-markdown-indexer"
    );
    if (bundle === undefined) throw new Error("missing bundled Markdown Indexer");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify({
      protocol: "context.indexer.registry/v1",
      requirements: [{
        id: "documentation-knowledge",
        reader_goals: ["understand-documentation"],
        coverage_domains: { "business-semantics": "required" },
        target_scope: { targets: [{ source_ref: "file:fixture/docs", module_refs: [] }] },
        evidence_source_scope: {
          targets: [{ source_ref: "file:fixture/docs", module_refs: [] }],
        },
      }],
      indexers: [{
        id: "workspace-markdown",
        operations: ["main-index"],
        requirement_bindings: [{
          requirement_ref: "documentation-knowledge",
          coverage_domains: ["business-semantics"],
          owned_scope: { ref: "requirement:documentation-knowledge#target_scope" },
          role: "primary",
        }],
        read_scope: {
          refs: ["requirement:documentation-knowledge#evidence_source_scope"],
        },
        profile: { primary: { id: "documentation-site", provider: "community" } },
        providers: [{
          id: "community",
          role: "primary",
          skill: bundle.skill,
          version: bundle.version,
          integrity: bundle.integrity,
          distribution: bundle.distribution,
        }],
      }],
    }), "utf8");
    const path = join(root, INDEXER_CURRENT_FINALIZATION_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify({
      state: "layout-confirmation-required",
      revision,
      ...(collision ? { path_preparation: prepareIndexerReaderPaths({
        proposals: [readerLayoutProposal("guide/a"), readerLayoutProposal("guide-a")],
        base_projections: [], occupied_paths: [],
      }) } : {}),
      layout_transition: {
        change_reports: [{
          requires_confirmation: true,
          changes: [{ kind: "artifact-removed", confirmation_class: "destructive" }],
        }],
      },
      confirmations: [],
    })}\n`);

    const route = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root,
      route: outerIndexerRoute(),
      authorities: contextWorkflowAuthorities({ managed: true }),
      managed: true,
    });
    expect(route).toMatchObject({
      node: "confirm-current-indexer-layout",
      availability: "requires-user",
      gate: {
        delegatable: false,
        resolution: "user",
        resolution_action: {
          id: "resolve-current-indexer-gate",
          runner: "agent",
          effect: "write",
          input: {
            stage: "layout-confirmation",
          },
          output_schema: {
            id: "schema.resolve-current-indexer-gate.output",
          },
        },
      },
      commands: [{
        availability: "after-human-confirmation",
        managed_execution: "agent-required",
      }],
    });
    expect(route?.action).toBeUndefined();
    if (collision) {
      expect(route?.gate?.resolution_action?.input).toMatchObject({
        path_conflicts: [{
          output_path: "knowledge/codeindex/anonymous-package/shared-guide.md",
          occupied_by_approved_page: false,
        }],
      });
    }
    expect(route?.gate?.resolution_action?.skill?.path).toContain(
      "skills/resolve-current-indexer-gate/SKILL.md",
    );
  });
  }
});
