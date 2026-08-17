import { describe, expect, test } from "bun:test";
import {
  Grounding,
  NodeType,
  PackageKind,
  ProductKind,
  SymbolKind,
  Visibility,
} from "../types/node.js";
import { nodeSchema } from "../schemas/nodeSchema.js";

const now = new Date().toISOString();

const baseNode = {
  id: "node_1",
  grounding: Grounding.Code,
  name: "Sample",
  language: "typescript",
  visibility: Visibility.Exported,
  source_id: "src_001",
  valid_from: null,
  valid_until: null,
  created_at: now,
  updated_at: now,
};

describe("nodeSchema", () => {
  test("accepts product/package/symbol nodes", () => {
    const samples = [
      {
        ...baseNode,
        type: NodeType.Product,
        kind: ProductKind.Domain,
      },
      {
        ...baseNode,
        type: NodeType.Package,
        kind: PackageKind.Service,
      },
      {
        ...baseNode,
        type: NodeType.Symbol,
        kind: SymbolKind.Function,
      },
    ];

    for (const sample of samples) {
      const result = nodeSchema.safeParse(sample);
      expect(result.success).toBe(true);
    }
  });

  test("rejects mismatched type and kind", () => {
    const invalidSamples = [
      {
        ...baseNode,
        type: NodeType.Product,
        kind: PackageKind.Lib,
      },
      {
        ...baseNode,
        type: NodeType.Package,
        kind: SymbolKind.Class,
      },
      {
        ...baseNode,
        type: NodeType.Symbol,
        kind: ProductKind.Story,
      },
    ];

    for (const sample of invalidSamples) {
      const result = nodeSchema.safeParse(sample);
      expect(result.success).toBe(false);
    }
  });
});
