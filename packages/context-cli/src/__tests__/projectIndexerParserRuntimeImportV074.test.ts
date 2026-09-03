import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserCoordinateMapping,
  buildIndexerParserRequirement,
  buildIndexerParserResolutionLock,
  indexerProtocolDigest,
} from "@c4a/context";
import { BUNDLED_INDEXER_PARSER_PACKAGE_VERSION } from
  "../project/indexerBaseContracts.js";
import { loadProjectIndexerParser } from "../project/indexerParserRuntimeImport.js";

const digest = (label: string) => indexerProtocolDigest({ label });

function resolution(input: {
  package?: string;
  exportName?: string;
  version?: string;
} = {}) {
  const packageName = input.package ?? "@c4a/extract";
  const exportName = input.exportName ?? "configSourcesToEvidenceAdapterMaterialization";
  const version = input.version ?? BUNDLED_INDEXER_PARSER_PACKAGE_VERSION;
  const requirement = buildIndexerParserRequirement({
    capability: "parser.fixture",
    abi: "context.indexer.evidence-adapter-result/v1",
    abi_digest: digest("abi"),
    community_coordinate: {
      package: packageName,
      export: exportName,
      version,
    },
  });
  const mapping = buildIndexerParserCoordinateMapping({
    requirement,
    resolution: "direct",
    registry: "npm",
    actual_coordinate: requirement.community_coordinate,
    abi_digest: requirement.abi_digest,
  });
  const lock = buildIndexerParserResolutionLock({
    requirement,
    mapping,
    lock_integrity: "sha512-Y29udGV4dC1maXh0dXJlLXBhcnNlcg==",
    resolved_content_digest: digest("installed-wrapper"),
  });
  return { requirement, mapping, lock };
}

describe("0.7.4 parser runtime import", () => {
  test("loads the exact named export from the CLI-owned parser dependency", async () => {
    const loaded = await loadProjectIndexerParser(resolution());

    expect(typeof loaded.adapter).toBe("function");
    expect(loaded.receipt).toMatchObject({
      protocol: "context.indexer.parser-import-receipt/v1",
      capability: "parser.fixture",
      package: "@c4a/extract",
      export: "configSourcesToEvidenceAdapterMaterialization",
      version: BUNDLED_INDEXER_PARSER_PACKAGE_VERSION,
    });
    expect(loaded.receipt.resolved_entry_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("fails closed when the CLI-owned module lacks the locked export", async () => {
    await expect(loadProjectIndexerParser(resolution({ exportName: "missingAdapter" })))
      .rejects.toThrow(/does not export missingAdapter/);
  });

  test("fails closed when the CLI-owned package version differs from the lock", async () => {
    await expect(loadProjectIndexerParser(resolution({ version: "0.0.0" })))
      .rejects.toThrow(/does not match lock 0.0.0/);
  });

  test("fails closed when the locked package is not a CLI dependency", async () => {
    await expect(loadProjectIndexerParser(resolution({ package: "@c4a/not-installed-parser" })))
      .rejects.toThrow(/locked parser package is not installed/);
  });
});
