import { describe, expect, test } from "bun:test";

import { encodeVersionLabel, isVersionVisible } from "../utils/version.js";

describe("encodeVersionLabel", () => {
  test("encodes stable releases", () => {
    expect(encodeVersionLabel("v1.0.0")).toBe(1_000_099);
    expect(encodeVersionLabel("2.3.4")).toBe(2_030_499);
  });

  test("encodes prerelease channels per design", () => {
    expect(encodeVersionLabel("v1.0.0-alpha.1")).toBe(1_000_001);
    expect(encodeVersionLabel("v1.0.0-beta.1")).toBe(1_000_031);
    expect(encodeVersionLabel("v1.0.0-rc.1")).toBe(1_000_061);
  });

  test("rejects unsupported labels", () => {
    expect(encodeVersionLabel("latest")).toBeNull();
    expect(encodeVersionLabel("v1.0")).toBeNull();
    expect(encodeVersionLabel("v1.0.0-beta.30")).toBeNull();
  });
});

describe("isVersionVisible", () => {
  test("treats null versionCode as always visible", () => {
    expect(isVersionVisible({ valid_from: 1_000_031, valid_until: 1_000_099 }, null)).toBe(true);
  });

  test("applies inclusive valid_from and exclusive valid_until", () => {
    const record = { valid_from: 1_000_031, valid_until: 1_000_099 };
    expect(isVersionVisible(record, 1_000_031)).toBe(true);
    expect(isVersionVisible(record, 1_000_061)).toBe(true);
    expect(isVersionVisible(record, 1_000_099)).toBe(false);
  });
});
