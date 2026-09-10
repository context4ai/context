import { describe, expect, test } from "bun:test";
import type { IndexerRegistry } from "@c4a/context";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "../project/indexerCurrentPrimaryAuthority.js";

describe("current Indexer primary Provider authority", () => {
  test("uses the installed bundled Provider without requiring the historical content pin", async () => {
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

    for (const version of [bundle.version, "0.0.1"]) {
      registry.indexers[0]!.providers[0]!.version = version;
      const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
        registry,
        indexer_id: "reader-guide",
      });
      expect(authority.provider).toMatchObject({ skill: bundle.skill, version: bundle.version, integrity: bundle.integrity });
      expect(authority.manifest.version).toBe(bundle.version);
      expect(registry.indexers[0]!.providers[0]!.integrity).toBe(requiredIntegrity);
    }
  });
});
