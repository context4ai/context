import { describe, expect, test } from "bun:test";
import {
  assertIndexerOutputSafe,
  redactIndexerOutput,
} from "../indexerOutputRedaction.js";

describe("Indexer common output redaction", () => {
  test("keeps schema-owned secret metadata while blocking secret values", () => {
    const safe = {
      token_ref: "style:token/button-color",
      token_references: ["style:token/base-color"],
      secret_digest: `sha256:${"a".repeat(64)}`,
      credential_fingerprint: "sha256:fixture",
    };

    expect(assertIndexerOutputSafe({
      channel: "success-payload",
      value: safe,
    })).toEqual(safe);

    for (const value of [
      { token: "fixture-token" },
      { access_token: "fixture-access-token" },
      { credential_value: "fixture-credential" },
    ]) {
      expect(redactIndexerOutput({
        channel: "success-payload",
        value,
      }).redacted).toBe(true);
    }
  });

  test("distinguishes qualified token paths from text assignments", () => {
    const paths = [
      "style.scss#token:1:--button-color",
      "token-reference:2:--base-color",
    ];
    expect(redactIndexerOutput({
      channel: "audit-report",
      value: paths,
    })).toEqual({
      value: paths,
      redacted: false,
      replacement_count: 0,
    });

    for (const value of [
      "token=fixture-token",
      "token: fixture-token",
      '{"token":"fixture-token"}',
    ]) {
      expect(redactIndexerOutput({
        channel: "stdout",
        value,
      }).redacted).toBe(true);
    }
  });
});
