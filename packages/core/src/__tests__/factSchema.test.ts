import { describe, expect, test } from "bun:test";
import {
  FactConfidence,
  FactKind,
  FactSourceType,
  FactStatus,
} from "../types/fact.js";
import { factSchema } from "../schemas/factSchema.js";

const now = new Date().toISOString();

const baseFact = {
  id: "fact_1",
  anchor_id: "node_1",
  anchor_type: "node" as const,
  kind: FactKind.Description,
  content: "Short content",
  detail: null,
  source_type: FactSourceType.Doc,
  source_ref: "src_001#1:1",
  source_span: { start: 0, end: 10 },
  related_facts: null,
  valid_from: null,
  valid_until: null,
  status: FactStatus.Active,
  confidence: FactConfidence.Confirmed,
  workspace_id: null,
  source_id: null,
  created_at: now,
  updated_at: now,
};

describe("factSchema", () => {
  test("accepts all fact kinds", () => {
    for (const kind of Object.values(FactKind)) {
      const result = factSchema.safeParse({ ...baseFact, kind });
      expect(result.success).toBe(true);
    }
  });

  test("rejects content longer than 256 chars", () => {
    const invalid = {
      ...baseFact,
      content: "a".repeat(257),
    };

    const result = factSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects invalid status and confidence combinations", () => {
    const invalidActive = {
      ...baseFact,
      status: FactStatus.Active,
      confidence: FactConfidence.Speculative,
    };
    const invalidProposed = {
      ...baseFact,
      status: FactStatus.Proposed,
      confidence: FactConfidence.Verified,
    };

    expect(factSchema.safeParse(invalidActive).success).toBe(false);
    expect(factSchema.safeParse(invalidProposed).success).toBe(false);
  });
});
