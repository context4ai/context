import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserCoordinateMapping,
  buildIndexerParserRequirement,
  buildIndexerParserResolutionLock,
  indexerParserLockedDependency,
  indexerProtocolDigest,
  validateIndexerParserImport,
  validateIndexerParserResolutionLock,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function parserRequirement() {
  const abi = "context.extraction-plugin/v1";
  return buildIndexerParserRequirement({
    capability: "parser.typescript",
    abi,
    abi_digest: indexerProtocolDigest({ protocol: abi }),
    community_coordinate: {
      package: "@example/extract-typescript",
      export: "TypeScriptParser",
      version: "1.2.3",
    },
  });
}

describe("parser capability to actual package coordinate authority", () => {
  test("locks the actual direct coordinate and validates the runtime import", () => {
    const requirement = parserRequirement();
    const mapping = buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "direct",
      registry: "npm-public",
      actual_coordinate: requirement.community_coordinate,
      abi_digest: requirement.abi_digest,
    });
    const lock = buildIndexerParserResolutionLock({
      requirement,
      mapping,
      lock_integrity: "sha512-AAAA",
      resolved_content_digest: digest("a"),
    });
    expect(validateIndexerParserResolutionLock({ requirement, mapping, lock })).toEqual(lock);
    expect(validateIndexerParserImport({
      requirement,
      mapping,
      lock,
      parser_import: {
        capability: requirement.capability,
        ...lock.actual_coordinate,
        parser_lock_digest: lock.lock_digest,
      },
    })).toMatchObject({
      package: "@example/extract-typescript",
      export: "TypeScriptParser",
      version: "1.2.3",
    });
    expect(indexerParserLockedDependency(lock)).toEqual({
      package: "@example/extract-typescript",
      version: "1.2.3",
      lock_integrity: "sha512-AAAA",
      resolved_digest: digest("a"),
    });
  });

  test("allows an internal wrapper only when it preserves the exact parser ABI", () => {
    const requirement = parserRequirement();
    const mapping = buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "wrapper",
      registry: "configured-internal",
      actual_coordinate: {
        package: "@example-internal/extract-typescript-wrapper",
        export: "TypeScriptParser",
        version: "1.2.3-internal.1",
      },
      abi_digest: requirement.abi_digest,
    });
    const lock = buildIndexerParserResolutionLock({
      requirement,
      mapping,
      lock_integrity: "sha512-BBBB",
      resolved_content_digest: digest("b"),
    });
    expect(lock.actual_coordinate.package).toBe(
      "@example-internal/extract-typescript-wrapper",
    );

    expect(() => buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "wrapper",
      registry: "configured-internal",
      actual_coordinate: mapping.actual_coordinate,
      abi_digest: digest("c"),
    })).toThrow(/changes the required ABI/);
  });

  test("rejects aliases, forged locks, mismatched imports, and source-mirror proof", () => {
    const requirement = parserRequirement();
    expect(() => buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "direct",
      registry: "npm-public",
      actual_coordinate: {
        ...requirement.community_coordinate,
        package: "@example/another-parser",
      },
      abi_digest: requirement.abi_digest,
    })).toThrow(/preserve the community coordinate/);

    const mapping = buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "direct",
      registry: "npm-public",
      actual_coordinate: requirement.community_coordinate,
      abi_digest: requirement.abi_digest,
    });
    const lock = buildIndexerParserResolutionLock({
      requirement,
      mapping,
      lock_integrity: "sha512-CCCC",
      resolved_content_digest: digest("d"),
    });
    expect(() => validateIndexerParserResolutionLock({
      requirement,
      mapping,
      lock: { ...lock, source_mirror_path: "packages/extract-typescript" },
    })).toThrow();
    expect(() => validateIndexerParserResolutionLock({
      requirement,
      mapping,
      lock: { ...lock, resolved_content_digest: digest("e") },
    })).toThrow(/stale or forged/);
    expect(() => validateIndexerParserImport({
      requirement,
      mapping,
      lock,
      parser_import: {
        capability: requirement.capability,
        ...lock.actual_coordinate,
        package: "@example/another-parser",
        parser_lock_digest: lock.lock_digest,
      },
    })).toThrow(/actual resolution lock/);
  });
});
