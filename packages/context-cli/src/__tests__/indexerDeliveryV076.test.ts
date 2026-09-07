import { expect, test } from "bun:test";
import { deliveryPageContentDigest, selectDeliveryPages, type DeliveryPage } from "../project/indexerDelivery.js";
import { artifactResult } from "../../../context/src/__tests__/indexerArtifactResultV070.fixture.js";

test("a peer Fact update does not redeliver an unchanged page, but its own source update does", () => {
  const result = artifactResult();
  const artifact = result.artifacts[0]!;
  const original = deliveryPageContentDigest(artifact, result);
  result.facts.push({ ...result.facts[0]!, fact_ref: "fact:unrelated", value: "unrelated change" });
  expect(deliveryPageContentDigest(artifact, result)).toBe(original);
  result.evidence_bindings[0]!.content_digest = `sha256:${"f".repeat(64)}`;
  expect(deliveryPageContentDigest(artifact, result)).not.toBe(original);
});

const pages = (count: number): DeliveryPage[] => Array.from({ length: count }, (_, index) => ({
  ref: `page:${index}`, artifact_id: `p${index}`, result_digest: "same-result",
  workset_digest: "same-workset", content_digest: `content:${index}`,
  priority: index, boundary: false,
}));
const delivered = { "previous-page": "previous-content" };

test("first delivery is small even when one accepted Result contains 73 pages", () => {
  expect(selectDeliveryPages({ pages: pages(73), delivered: {}, allAuthorsAccepted: false })).toHaveLength(3);
});
test("29 pages continue; a module boundary at 30 delivers; 50 forces a delivery", () => {
  expect(selectDeliveryPages({ pages: pages(29), delivered, allAuthorsAccepted: false })).toEqual([]);
  const module = pages(32);
  module[29]!.boundary = true;
  expect(selectDeliveryPages({ pages: module, delivered, allAuthorsAccepted: false })).toHaveLength(30);
  expect(selectDeliveryPages({ pages: pages(49), delivered, allAuthorsAccepted: false })).toEqual([]);
  expect(selectDeliveryPages({ pages: pages(51), delivered, allAuthorsAccepted: false })).toHaveLength(50);
});
test("successive slices preserve every page and never count retries twice", () => {
  const all = pages(124);
  const completed: Record<string, string> = {};
  const sizes: number[] = [];
  while (Object.keys(completed).length < all.length) {
    const batch = selectDeliveryPages({ pages: [...all, ...all], delivered: completed, allAuthorsAccepted: true });
    sizes.push(batch.length);
    for (const page of batch) completed[page.ref] = page.content_digest;
  }
  expect(sizes).toEqual([3, 50, 50, 21]);
  expect(selectDeliveryPages({ pages: all, delivered: completed, allAuthorsAccepted: true })).toEqual([]);
  const changed = { ...all[4]!, content_digest: "changed" };
  expect(selectDeliveryPages({ pages: [changed], delivered: completed, allAuthorsAccepted: true })).toEqual([changed]);
});
test("explicit early delivery and final tail may be smaller than 30", () => {
  expect(selectDeliveryPages({ pages: pages(12), delivered, allAuthorsAccepted: false, requestedEarly: true })).toHaveLength(12);
  expect(selectDeliveryPages({ pages: pages(12), delivered, allAuthorsAccepted: true })).toHaveLength(12);
});
