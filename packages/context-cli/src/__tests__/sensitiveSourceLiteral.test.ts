import { describe, expect, test } from "bun:test";
import { sensitiveSourceLiteralCandidates } from "../project/sensitiveSourceLiteral.js";

describe("sensitive source literal detection", () => {
  test("reports likely labeled credentials without returning their values", () => {
    const value = [
      "# Setup",
      "Access Key | AbCDef0123456789+/secret",
      "api_key=0123456789abcdef0123456789abcdef",
    ].join("\n");
    const candidates = sensitiveSourceLiteralCandidates(value);
    expect(candidates).toEqual([
      { line: 2, label: "access-key", value_length: 24 },
      { line: 3, label: "api-key", value_length: 32 },
    ]);
    expect(JSON.stringify(candidates)).not.toContain("AbCDef0123456789");
    expect(JSON.stringify(candidates)).not.toContain("0123456789abcdef");
  });

  test("allows explicit placeholders and ordinary prose", () => {
    expect(sensitiveSourceLiteralCandidates([
      "Access Key: <your-access-key>",
      "api_key=xxxxxxxxxxxxxxxx",
      "The access key is managed by the deployment environment.",
    ].join("\n"))).toEqual([]);
  });
});
