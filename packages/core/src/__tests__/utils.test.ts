import { describe, expect, test } from "bun:test";
import {
  contentHash,
  generateId,
  generateUUID,
  isPathSafe,
  parseYaml,
  serializeYaml,
} from "../utils/index.js";
import { C4AError } from "../errors/c4aError.js";
import { ErrorCode } from "../errors/errorCodes.js";

describe("generateId", () => {
  test("is deterministic and uses type prefix", () => {
    const id = generateId("component", "container_xxx", "UserService");
    const again = generateId("component", "container_xxx", "UserService");

    expect(id).toBe(again);
    expect(id.startsWith("component_")).toBe(true);
    expect(id.slice("component_".length)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("changes when parentId changes", () => {
    const idA = generateId("component", "container_a", "UserService");
    const idB = generateId("component", "container_b", "UserService");

    expect(idA).not.toBe(idB);
  });
});

describe("generateUUID", () => {
  test("returns a valid v4 UUID", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("contentHash", () => {
  test("is deterministic", () => {
    const hashA = contentHash("hello");
    const hashB = contentHash("hello");
    expect(hashA).toBe(hashB);
  });

  test("changes for different content", () => {
    const hashA = contentHash("hello");
    const hashB = contentHash("world");
    expect(hashA).not.toBe(hashB);
  });
});

describe("isPathSafe", () => {
  test("accepts normal relative paths", () => {
    expect(isPathSafe("data/config.yaml")).toBe(true);
  });

  test("rejects path traversal", () => {
    expect(isPathSafe("../secret.txt")).toBe(false);
  });

  test("rejects absolute paths", () => {
    expect(isPathSafe("/etc/passwd")).toBe(false);
    expect(isPathSafe("C:\\Windows\\system32")).toBe(false);
  });
});

describe("yaml helpers", () => {
  test("serialize and parse round trip", () => {
    const payload = { name: "C4A", nested: { value: 42 } };
    const serialized = serializeYaml(payload);
    const parsed = parseYaml(serialized) as typeof payload;

    expect(parsed).toEqual(payload);
  });

  test("invalid yaml throws C4AError", () => {
    try {
      parseYaml("invalid: [unclosed");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(C4AError);
      expect((error as C4AError).code).toBe(ErrorCode.PARSE_YAML);
    }
  });
});
