import { describe, expect, test } from "bun:test";
import { validateIndexerProviderConfig } from "../project/indexerConfigSchema.js";

const SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["safe", "thorough"], minLength: 4 },
    retries: { type: "integer", minimum: 0, maximum: 3 },
    roots: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: ["mode", "roots"],
  additionalProperties: false,
};

describe("data-only Provider config schema", () => {
  test("accepts the closed deterministic JSON subset", () => {
    expect(() => validateIndexerProviderConfig(SCHEMA, {
      mode: "safe",
      retries: 2,
      roots: ["src", "examples"],
    })).not.toThrow();
  });

  test("rejects executable/open schema features and misplaced keywords", () => {
    expect(() => validateIndexerProviderConfig({
      ...SCHEMA,
      $ref: "https://example.invalid/schema.json",
    }, { mode: "safe", roots: ["src"] })).toThrow("unsupported keyword $ref");
    expect(() => validateIndexerProviderConfig({
      type: "object",
      properties: {},
    }, {})).toThrow("additionalProperties: false");
    expect(() => validateIndexerProviderConfig({
      type: "object",
      properties: { invalid: { type: "string", minimum: 1 } },
      additionalProperties: false,
    }, {})).toThrow("numeric keywords with type string");
  });

  test("rejects invalid instances and ambiguous enum declarations", () => {
    expect(() => validateIndexerProviderConfig(SCHEMA, {
      mode: "safe",
      retries: 4,
      roots: ["src"],
    })).toThrow("above maximum");
    expect(() => validateIndexerProviderConfig(SCHEMA, {
      mode: "safe",
      roots: ["src", "src"],
    })).toThrow("unique items");
    expect(() => validateIndexerProviderConfig({
      type: "object",
      properties: { mode: { type: "string", enum: ["safe", "safe"] } },
      additionalProperties: false,
    }, {})).toThrow("unique values");
  });
});
