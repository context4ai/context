import { describe, expect, test } from "bun:test";
import { DOC_MAINLINE_COLLECTIONS } from "@c4a/context";
import {
  okfPackagePathForKnowledgePath,
  okfRootForCollection,
  okfTypeForCollection,
  okfTypeForKnowledgePath,
} from "../project/okfTypes.js";

describe("OKF type mapping", () => {
  test("maps internal knowledge collections to approved Markdown type values", () => {
    const expected = {
      codegraph: "Wiki",
      business: "Wiki",
      product: "Wiki",
      architecture: "Guide",
      sop: "Guide",
      faq: "Guide",
      decision: "Guide",
      incident: "Guide",
      standards: "Rule",
      test: "Rule",
      feats: "Feature",
    } as const;
    for (const [collection, type] of Object.entries(expected)) {
      expect(okfTypeForCollection(collection as keyof typeof expected)).toBe(type);
    }
  });

  test("derives expected type from knowledge paths", () => {
    expect(okfTypeForKnowledgePath("knowledge/architecture/product/onboarding.md")).toBe("Guide");
    expect(okfTypeForKnowledgePath("sop/product/onboarding.md")).toBe("Guide");
    expect(okfTypeForKnowledgePath("unknown/product/onboarding.md")).toBeNull();
  });

  test("maps approved knowledge paths to package OKF paths", () => {
    expect(okfPackagePathForKnowledgePath("architecture/product/onboarding.md")).toBe("guides/architecture/product/onboarding.md");
    expect(okfPackagePathForKnowledgePath("knowledge/architecture/product/onboarding.md")).toBe("guides/architecture/product/onboarding.md");
    expect(okfPackagePathForKnowledgePath("knowledge/product/requirements/onboarding.md")).toBe("wikis/product/requirements/onboarding.md");
    expect(okfPackagePathForKnowledgePath("knowledge/faq/common/login.md")).toBe("guides/faq/common/login.md");
    expect(okfPackagePathForKnowledgePath("knowledge/decision/auth/session.md")).toBe("guides/decision/auth/session.md");
    expect(okfPackagePathForKnowledgePath("knowledge/sop/runbooks/deploy.md")).toBe("guides/sop/runbooks/deploy.md");
    expect(okfPackagePathForKnowledgePath("knowledge/business/domain/account.md")).toBe("wikis/business/domain/account.md");
    expect(okfPackagePathForKnowledgePath("knowledge/incident/service/outage.md")).toBe("guides/incident/service/outage.md");
    expect(okfPackagePathForKnowledgePath("knowledge/standards/api/http.md")).toBe("rules/standards/api/http.md");
    expect(okfPackagePathForKnowledgePath("knowledge/test/api/http.md")).toBe("rules/test/api/http.md");
    expect(okfPackagePathForKnowledgePath("knowledge/feats/search/query.md")).toBe("feats/search/query.md");
    expect(okfPackagePathForKnowledgePath("knowledge/structure.yaml")).toBe("knowledge/structure.yaml");
  });

  test("maps every document mainline collection to its package root", () => {
    expect(Object.fromEntries(DOC_MAINLINE_COLLECTIONS.map((collection) => [
      collection,
      okfRootForCollection(collection),
    ]))).toEqual({
      business: "wikis",
      product: "wikis",
      architecture: "guides",
      sop: "guides",
      faq: "guides",
      standards: "rules",
      decision: "guides",
      incident: "guides",
      test: "rules",
    });
  });
});
