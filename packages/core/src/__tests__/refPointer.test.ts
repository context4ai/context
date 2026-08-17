import { describe, expect, test } from "bun:test";
import {
  buildRef,
  extractAllRefs,
  isRefPointer,
  parseRef,
} from "../types/refPointer.js";

describe("refPointer", () => {
  test("parseRef returns type and id", () => {
    expect(parseRef("ref:entity:ent_123")).toEqual({
      type: "entity",
      id: "ent_123",
    });
  });

  test("parseRef returns null for invalid input", () => {
    expect(parseRef("invalid")).toBeNull();
  });

  test("buildRef returns expected pointer", () => {
    expect(buildRef("relation", "rel_001")).toBe("ref:relation:rel_001");
  });

  test("isRefPointer detects pointers", () => {
    expect(isRefPointer("ref:content:sha256:abc"))
      .toBe(true);
    expect(isRefPointer("not-a-ref")).toBe(false);
  });

  test("extractAllRefs walks nested objects and arrays", () => {
    const data = {
      container_id: "ref:entity:ent_001",
      items: [
        { ref: "ref:relation:rel_001" },
        { ref: "not-ref" },
      ],
      nested: {
        content: "ref:content:sha256:abc",
      },
    };

    const refs = extractAllRefs(data);

    expect(refs).toEqual([
      { pointer: "ref:entity:ent_001", fieldPath: "container_id" },
      { pointer: "ref:relation:rel_001", fieldPath: "items[0].ref" },
      { pointer: "ref:content:sha256:abc", fieldPath: "nested.content" },
    ]);
  });
});
