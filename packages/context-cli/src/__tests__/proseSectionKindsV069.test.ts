import { describe, expect, test } from "bun:test";
import {
  isKnownProseSectionKind,
  isProseSectionKindMountable,
  mountableProseSectionKinds,
  PROSE_SECTION_KIND_PRIORITY,
  PROSE_SECTION_KINDS,
} from "../project/proseSectionKinds.js";

describe("0.6.9 prose section kind canon", () => {
  test("section kind set has the current ten kinds only", () => {
    expect(PROSE_SECTION_KINDS).toEqual([
      "description",
      "principle",
      "decision",
      "spec",
      "warning",
      "comparison",
      "example",
      "faq",
      "incident",
      "changelog",
    ]);
    expect(PROSE_SECTION_KINDS).toHaveLength(10);
    expect(PROSE_SECTION_KINDS).not.toContain("usage" as never);
    expect(PROSE_SECTION_KINDS).not.toContain("relationship" as never);
    expect(PROSE_SECTION_KIND_PRIORITY).not.toContain("usage" as never);
    expect(PROSE_SECTION_KIND_PRIORITY).not.toContain("relationship" as never);
    expect(isKnownProseSectionKind("usage")).toBe(false);
    expect(isKnownProseSectionKind("relationship")).toBe(false);
  });

  test("mount matrix follows the shared classification canon", () => {
    expect(mountableProseSectionKinds("domain")).toEqual([
      "description",
      "warning",
      "principle",
      "decision",
      "faq",
    ]);
    expect(isProseSectionKindMountable("domain", "spec")).toBe(false);
    expect(isProseSectionKindMountable("domain", "relationship")).toBe(false);

    expect(isProseSectionKindMountable("entity", "comparison")).toBe(true);
    expect(isProseSectionKindMountable("entity", "changelog")).toBe(true);

    expect(mountableProseSectionKinds("action")).toEqual([
      "description",
      "decision",
      "spec",
      "warning",
      "faq",
      "incident",
    ]);
    expect(isProseSectionKindMountable("action", "principle")).toBe(false);
    expect(isProseSectionKindMountable("action", "example")).toBe(false);
    expect(isProseSectionKindMountable("action", "comparison")).toBe(false);
  });
});
