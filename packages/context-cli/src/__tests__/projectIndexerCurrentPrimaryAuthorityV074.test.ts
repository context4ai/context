import { describe, expect, test } from "bun:test";
import type { IndexerRegistry } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "../project/indexerCurrentPrimaryAuthority.js";

describe("current Indexer primary Provider authority", () => {
  test("reports the required and available identities when a bundled Provider digest drifts", async () => {
    const bundle = (await listCliBundledIndexers()).bundles.find((candidate) =>
      candidate.skill === "context-code-indexer"
    );
    if (bundle === undefined) throw new Error("missing bundled context-code-indexer fixture");
    const requiredIntegrity = `sha256:${"0".repeat(64)}`;
    const registry: IndexerRegistry = {
      protocol: "context.indexer.registry/v1",
      requirements: [{
        id: "reader-guide",
        reader_goals: ["understand-public-api"],
        coverage_domains: { "public-api": "required" },
        target_scope: { targets: [{ source_ref: "repo:fixture/sample", module_refs: [] }] },
        evidence_source_scope: {
          targets: [{ source_ref: "repo:fixture/sample", module_refs: [] }],
        },
      }],
      indexers: [{
        id: "reader-guide",
        operations: ["main-index"],
        requirement_bindings: [{
          requirement_ref: "reader-guide",
          coverage_domains: ["public-api"],
          owned_scope: { ref: "requirement:reader-guide#target_scope" },
          role: "primary",
        }],
        read_scope: { refs: ["requirement:reader-guide#evidence_source_scope"] },
        profile: {
          primary: { id: "component-library", provider: "context-code-indexer" },
        },
        providers: [{
          id: "context-code-indexer",
          role: "primary",
          skill: bundle.skill,
          version: bundle.version,
          integrity: requiredIntegrity,
          distribution: bundle.distribution,
        }],
      }],
    };

    let caught: unknown;
    try {
      await resolveCurrentProjectIndexerPrimaryAuthority({
        registry,
        indexer_id: "reader-guide",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContextError);
    const failure = caught as ContextError;
    const message = failure.message;
    expect(message).toContain(
      `requires exact primary Provider context-code-indexer@${bundle.version} (integrity ${requiredIntegrity}`,
    );
    expect(message).toContain(
      `current CLI provides context-code-indexer@${bundle.version} (integrity ${bundle.integrity}`,
    );
    expect(message).toContain("bundle catalog has no exact identity match");
    expect(failure.detail?.category).toBe(ErrorCategory.ProviderIdentityMismatch);
    expect(failure.detail?.required_provider).toMatchObject({
      skill: "context-code-indexer",
      version: bundle.version,
      integrity: requiredIntegrity,
    });
    expect(failure.detail?.available_providers).toEqual([bundle]);
  });
});
