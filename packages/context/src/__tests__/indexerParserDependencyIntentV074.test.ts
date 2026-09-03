import { describe, expect, test } from "bun:test";
import {
  authorizeIndexerDependencies,
  buildIndexerCommunityParserCoordinateMappings,
  buildIndexerParserCapabilityRequirements,
  buildIndexerParserCoordinateMapping,
  buildIndexerParserDependencyIntentSet,
  buildIndexerParserResolutionLocks,
  indexerProtocolDigest,
} from "../index.js";

const digest = (label: string) => indexerProtocolDigest({ label });

function resolution(
  capability: string,
  options: {
    resolution?: "direct" | "wrapper";
    actualVersion?: string;
  } = {},
) {
  const requirement = buildIndexerParserCapabilityRequirements("0.7.4")
    .find((candidate) => candidate.capability === capability)!;
  const mapping = buildIndexerParserCoordinateMapping({
    requirement,
    resolution: options.resolution ?? "direct",
    registry: options.resolution === "wrapper" ? "bnpm" : "npm",
    actual_coordinate: options.resolution === "wrapper"
      ? {
          package: "@tiktok-ttkb/extract-config-wrapper",
          export: requirement.community_coordinate.export,
          version: options.actualVersion ?? requirement.community_coordinate.version,
        }
      : requirement.community_coordinate,
    abi_digest: requirement.abi_digest,
  });
  return { requirement, mapping };
}

describe("0.7.4 parser dependency intent projection", () => {
  test("requests authorization before deriving exact locks for one shared package", () => {
    const selected = [
      resolution("parser.json"),
      resolution("parser.yaml"),
      resolution("parser.toml"),
    ];
    const requirements = selected.map((item) => item.requirement);
    const mappings = selected.map((item) => item.mapping);
    const preview = buildIndexerParserDependencyIntentSet({ requirements, mappings });

    expect(preview.intents).toEqual([expect.objectContaining({
      package: "@c4a/extract",
      state: "requires-authorization",
      install_scripts: false,
      importers: ["src/indexers.yaml"],
    })]);

    const authorized = authorizeIndexerDependencies({
      dependencies: preview,
      resolutions: [{
        package: "@c4a/extract",
        version: "0.7.4",
        lock_integrity: "sha512-cGFyc2VyLWRlcGVuZGVuY3k=",
        resolved_digest: digest("@c4a/extract@0.7.4"),
      }],
      authority_ref: "authority:fixture-installer",
      authority_scope_digest: digest("authority"),
    });
    const dependencies = buildIndexerParserDependencyIntentSet({
      requirements,
      mappings,
      authorization_receipt: authorized.receipt,
    });
    const locks = buildIndexerParserResolutionLocks({
      requirements,
      mappings,
      authorization_receipt: authorized.receipt,
    });

    expect(dependencies.intents).toEqual([expect.objectContaining({
      package: "@c4a/extract",
      state: "locked",
      resolved_digest: digest("@c4a/extract@0.7.4"),
    })]);
    expect(locks).toHaveLength(3);
    expect(new Set(locks.map((lock) => lock.resolved_content_digest))).toEqual(
      new Set([digest("@c4a/extract@0.7.4")]),
    );
  });

  test("projects community direct mappings and an explicit wrapper deterministically", () => {
    const directRequirements = [
      resolution("parser.typescript").requirement,
      resolution("parser.javascript").requirement,
    ];
    const direct = buildIndexerCommunityParserCoordinateMappings({
      requirements: directRequirements,
      registry: "npm",
    });
    expect(direct.map((mapping) => mapping.capability)).toEqual([
      "parser.javascript",
      "parser.typescript",
    ]);
    expect(direct.every((mapping) => mapping.resolution === "direct")).toBe(true);

    const wrapper = resolution("parser.json", { resolution: "wrapper" });
    const projection = buildIndexerParserDependencyIntentSet({
      requirements: [wrapper.requirement],
      mappings: [wrapper.mapping],
    });
    expect(projection.intents).toEqual([expect.objectContaining({
      package: "@tiktok-ttkb/extract-config-wrapper",
      version: "0.7.4",
      state: "requires-authorization",
    })]);
  });

  test("rejects shared wrapper capabilities that disagree on exact package version", () => {
    const json = resolution("parser.json", {
      resolution: "wrapper",
      actualVersion: "0.7.4",
    });
    const yaml = resolution("parser.yaml", {
      resolution: "wrapper",
      actualVersion: "0.7.5",
    });
    expect(() => buildIndexerParserDependencyIntentSet({
      requirements: [json.requirement, yaml.requirement],
      mappings: [json.mapping, yaml.mapping],
    })).toThrow(/disagree on package version/);
  });
});
