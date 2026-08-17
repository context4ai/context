import { describe, expect, test } from "bun:test";
import { EdgeSource, EdgeType } from "../types/edge.js";
import { Grounding } from "../types/node.js";
import { edgeSchema } from "../schemas/edgeSchema.js";

const now = new Date().toISOString();

const baseEdge = {
  id: "edge_1",
  from_id: "node_a",
  to_id: "node_b",
  grounding: Grounding.Code,
  source: EdgeSource.Ast,
  confidence: 0.9,
  valid_from: null,
  valid_until: null,
  created_at: now,
  updated_at: now,
};

describe("edgeSchema", () => {
  test("accepts all edge types", () => {
    for (const type of Object.values(EdgeType)) {
      const result = edgeSchema.safeParse({ ...baseEdge, type });
      expect(result.success).toBe(true);
    }
  });

  test("rejects confidence outside 0..1", () => {
    const invalid = {
      ...baseEdge,
      type: EdgeType.Contains,
      confidence: 1.5,
    };

    const result = edgeSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
