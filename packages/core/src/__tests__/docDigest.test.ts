import { describe, expect, test } from "bun:test";

import {
  docChunkResultSchema,
  docDigestSchema,
  paragraphAtomSchema,
} from "../types/docDigest.js";

describe("docDigest schema", () => {
  test("accepts valid DocDigest payload", () => {
    const result = docDigestSchema.safeParse({
      version: "1",
      sections: [
        {
          heading: "Intro",
          level: 1,
          paragraphs: [
            {
              text: "Hello",
              atoms: { entities: [{ name: "Order" }] },
            },
          ],
        },
      ],
      embeddings: [{ sectionIndex: 0, paragraphIndex: 0, vector: [0.1, 0.2] }],
      metadata: {
        sourceId: "src_1",
        hashId: "hash",
        sourcePath: "docs/readme.md",
        contentHash: "hash",
        chunkCount: 1,
        totalTokens: 10,
        llmCalls: 1,
        processedAt: new Date().toISOString(),
      },
    });

    expect(result.success).toBe(true);
  });

  test("rejects invalid DocDigest payload", () => {
    const result = docDigestSchema.safeParse({
      version: "1",
      sections: [],
      embeddings: [],
      metadata: {
        sourceId: "src_1",
        hashId: "hash",
        sourcePath: "docs/readme.md",
        contentHash: "hash",
        chunkCount: "invalid",
        totalTokens: 10,
        llmCalls: 1,
        processedAt: new Date().toISOString(),
      },
    });

    expect(result.success).toBe(false);
  });

  test("docChunkResultSchema validates paragraph tags", () => {
    const ok = docChunkResultSchema.safeParse({
      paragraphs: [{ tag: "P0", atoms: {} }],
    });
    const bad = docChunkResultSchema.safeParse({
      paragraphs: [{ tag: "X0", atoms: {} }],
    });

    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  test("paragraphAtomSchema excludes claims", () => {
    expect("claims" in paragraphAtomSchema.shape).toBe(false);
  });

  test("paragraphAtomSchema strips unknown keys like claims at runtime", () => {
    const input = {
      entities: [{ name: "Order" }],
      claims: [{ description: "should be stripped" }],
      typoKey: "should also be stripped",
    };
    const result = paragraphAtomSchema.safeParse(input);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ entities: [{ name: "Order" }] });
    expect("claims" in (result.data ?? {})).toBe(false);
    expect("typoKey" in (result.data ?? {})).toBe(false);
  });
});
