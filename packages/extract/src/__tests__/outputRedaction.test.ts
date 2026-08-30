import { describe, expect, test } from "bun:test";
import {
  INDEXER_OUTPUT_REDACTION_MARKER,
  assertIndexerOutputSafe,
  redactIndexerOutput,
  redactIndexerOutputText,
  type IndexerOutputChannel,
} from "../index.js";

const RAW_CONFIG_SCALAR = "west-internal-canary";
const SECRET = "fixture-secret-do-not-emit";

describe("common Indexer output redaction boundary", () => {
  test("uses the same filter for success, streams, exceptions, IPC, Review, and audit channels", () => {
    const channels: IndexerOutputChannel[] = [
      "success-payload",
      "stdout",
      "stderr",
      "exception-message",
      "ipc-envelope",
      "review-sample",
      "audit-report",
    ];
    for (const channel of channels) {
      const result = redactIndexerOutput({
        channel,
        value: {
          region: RAW_CONFIG_SCALAR,
          clientSecret: SECRET,
          nested: `region=${RAW_CONFIG_SCALAR} token=${SECRET}`,
        },
        policy: { blocked_scalars: [RAW_CONFIG_SCALAR] },
      });
      const serialized = JSON.stringify(result.value);
      expect(result.redacted).toBe(true);
      expect(result.replacement_count).toBeGreaterThanOrEqual(3);
      expect(serialized).not.toContain(RAW_CONFIG_SCALAR);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).toContain(INDEXER_OUTPUT_REDACTION_MARKER);
    }
  });

  test("redacts key/value logs, authorization headers, credential URLs, and private keys", () => {
    const text = [
      `password=${SECRET}`,
      `Authorization: Bearer ${SECRET}`,
      `https://user:${SECRET}@example.invalid/path`,
      `https://example.invalid/?access_token=${SECRET}`,
      `-----BEGIN PRIVATE KEY-----\n${SECRET}\n-----END PRIVATE KEY-----`,
    ].join("\n");
    const redacted = redactIndexerOutputText({ channel: "stderr", value: text });
    expect(redacted).not.toContain(SECRET);
    expect(redacted.match(/\[REDACTED:indexer-output\]/gu)?.length).toBeGreaterThanOrEqual(5);
  });

  test("rejects authenticated structured carriers instead of silently invalidating their digest", () => {
    for (const channel of ["success-payload", "ipc-envelope", "review-sample", "audit-report"] as const) {
      expect(() => assertIndexerOutputSafe({
        channel,
        value: { protocol: "fixture/v1", token: SECRET },
      })).toThrow(`Indexer ${channel} was blocked by the common output redaction boundary`);
    }
  });

  test("does not mistake authorization policy objects or token counts for secret values", () => {
    const value = {
      authorization: { level: "trusted-program", authority_digest: "sha256:abc" },
      token_count: 42,
      input_digest: "sha256:def",
    };
    expect(redactIndexerOutput({ channel: "success-payload", value })).toEqual({
      value,
      redacted: false,
      replacement_count: 0,
    });
  });
});
